"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  crearEstadoInicial,
  cambiarEstadoTodos,
  deshacerConJuego,
  guardarHabit,
  normalizarEstado,
  eliminarHabit,
  actualizarSettings,
  registrarConJuego,
  STORAGE_KEY,
} from "./store";
import {
  emitirEventosJuego,
  fusionarJuego,
  juegoInicial,
  reconciliarJuego,
  type TipoEventoJuego,
} from "./juego";
import { publicarXpLiga } from "./liga";
import type { AppState, Habit, CompletionEvent, JuegoState, Settings } from "./types";
import { construirEventId } from "./event-id";
import { fusionarHidratacion, type RemoteCompletionRow, type RemoteHabitRow } from "./sync-merge";
import { getSupabase } from "./supabase";
import { todayKey, addDays } from "./dates";
import { useAuth } from "../components/AuthGate";
import { logEvent, flushLog, type LogAction } from "./logger";
import { fijarSufijoNotificaciones } from "./notifications";
import {
  claveEstado,
  clavePendientes as clavePendientesAmbito,
  clavesDeDatos,
  sufijoAmbito,
} from "./perfiles";

/** Auditoría: cada evento de juego del dominio se refleja en el activity_log. */
const ACCION_POR_TIPO_EVENTO: Record<TipoEventoJuego, LogAction> = {
  "subida-nivel": "LEVEL_UP",
  logro: "ACHIEVEMENT_UNLOCKED",
  cofre: "CHEST_OPENED",
  desafio: "CHALLENGE_COMPLETED",
  "congelador-ganado": "FREEZER_EARNED",
  "congelador-usado": "FREEZER_USED",
};

/** APP_OPENED se registra una sola vez por carga de página. */
let appOpenedLogged = false;

const PENDING_KEY_BASE = "habitos-pending-sync-v1";

/** P1.5: la cola offline se nombra por identidad (perfil local o usuario nube).
 *  Al cambiar de identidad se recarga desde la clave activa. */
function clavePendientes(sufijo: string | null): string {
  return sufijo ? clavePendientesAmbito(sufijo) : PENDING_KEY_BASE;
}

interface StoreContextValue {
  state: AppState;
  guardarHabit: (habit: Habit) => void;
  eliminarHabit: (id: string) => void;
  guardarSettings: (settings: Settings) => void;
  registrar: (habitId: string, momentId: string | undefined, fecha: string, subtareasCompletadas?: string[]) => void;
  deshacer: (event: CompletionEvent) => void;
  /** Modo vacaciones: pausa o reanuda todos los hábitos no archivados de una vez. */
  cambiarEstadoTodos: (estado: "activo" | "pausado") => void;
  /** Aplaza un hábito para mañana (toggle: si ya está aplazado, lo devuelve a hoy). */
  posponerHabit: (id: string) => void;
  /** Actualiza campos del estado de juego (p. ej. nombre visible en la liga). */
  actualizarJuego: (parcial: Partial<JuegoState>) => void;
  rehidratar: () => Promise<void>;
  /** Borra todos los datos (local + nube) y deja la app en cero. */
  reiniciarTodo: () => Promise<void>;
  /** E3: reenvía la cola pendiente ahora (p. ej. antes de cerrar sesión). */
  sincronizarAhora: () => Promise<void>;
  /** Descripción del último error de sincronización no-red, o null si todo está al día. */
  errorSync: string | null;
}

/**
 * P2.11: contexto dividido en dos para rendimiento.
 * - StoreStateContext: cambia en cada acción (solo lo consumen vistas).
 * - StoreActionsContext: identidad estable (no re-renderiza al cambiar el estado).
 */
const StoreStateContext = createContext<{ state: AppState; errorSync: string | null } | null>(null);
const StoreActionsContext = createContext<Omit<StoreContextValue, "state" | "errorSync"> | null>(null);

function cargarEstadoGuardado(storageKey: string): AppState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? normalizarEstado(JSON.parse(raw)) : crearEstadoInicial();
  } catch {
    return crearEstadoInicial();
  }
}

function esErrorRed(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return Boolean(e?.code === "NETWORK_ERROR" || e?.message?.includes("Failed to fetch") || e?.message?.includes("Network"));
}

/** Tipo de operación pendiente que reenviaremos cuando haya conexión. */
type PendingOp =
  | { kind: "upsert_habit"; payload: unknown }
  | { kind: "delete_habit"; id: string }
  | { kind: "upsert_completion"; payload: unknown }
  | { kind: "delete_completion"; event_id: string }
  /** D2: borrado en cascada de las completions de un hábito eliminado. */
  | { kind: "delete_completions_of_habit"; habit_id: string }
  | { kind: "delete_push"; endpoint: string }
  /** P2.6: tombstone de hábito borrado (para que el borrado viaje entre dispositivos). */
  | { kind: "upsert_tombstone"; payload: unknown }
  /** Juego: progreso de gamificación (XP, logros, congeladores) por usuario. */
  | { kind: "upsert_game"; payload: unknown };

function leerPendientes(clave: string): PendingOp[] {
  try {
    const raw = window.localStorage.getItem(clave);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function guardarPendientes(clave: string, ops: PendingOp[]): void {
  try {
    window.localStorage.setItem(clave, JSON.stringify(ops.slice(-200)));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, perfil } = useAuth();
  const userId = user?.id ?? null;
  // Identidad de datos: perfil local (`perfil:<id>`) o cuenta nube (`<userId>`).
  // Todo (estado, colas, logs, notificaciones) se aísla por este sufijo.
  const sufijo = sufijoAmbito(perfil?.id ?? null, userId);
  const storageKey = sufijo ? claveEstado(sufijo) : STORAGE_KEY;

  // Siempre se arranca con el estado inicial por defecto para el render del servidor
  // y el primer render de hidratación (evita mismatch de hidratación).
  const [state, setState] = useState<AppState>(crearEstadoInicial);
  const [estadoCargado, setEstadoCargado] = useState(false);
  const pendientesRef = useRef<PendingOp[]>([]);
  const sincronizandoRef = useRef(false);
  // P2.11: espejo del estado para que las acciones lean sin cerrar sobre `state`
  // y mantengan identidad estable entre renders.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Notificaciones: aislar "ya enviadas" por identidad (perfil o cuenta).
  useEffect(() => {
    fijarSufijoNotificaciones(sufijo);
  }, [sufijo]);

  // La carga desde localStorage se difiere (post-paint) para no ejecutar setState
  // síncrono dentro del efecto y para no romper la hidratación.
  useEffect(() => {
    let activo = true;
    const raf = requestAnimationFrame(() => {
      if (!activo) return;
      // Juego: backfill idempotente de XP/logros/desafíos sobre datos existentes.
      setState(reconciliarJuego(cargarEstadoGuardado(storageKey)));
      pendientesRef.current = leerPendientes(clavePendientes(sufijo)); // P1.5
      setEstadoCargado(true);
      // Auditoría: apertura de la app + subir eventos que quedaron en cola.
      if (!appOpenedLogged) {
        appOpenedLogged = true;
        logEvent("APP_OPENED", "app", null, { ruta: window.location.pathname });
      }
      void flushLog();
    });
    return () => {
      activo = false;
      cancelAnimationFrame(raf);
    };
  }, [storageKey, sufijo]);

  // P2.11: persistencia con debounce (~500 ms) para no serializar el estado
  // completo en cada tap; flush en pagehide para no perder el último cambio.
  useEffect(() => {
    if (!estadoCargado) return;
    const guardar = () => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(stateRef.current));
      } catch {
        /* almacenamiento no disponible */
      }
    };
    const t = setTimeout(guardar, 500);
    window.addEventListener("pagehide", guardar);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", guardar);
    };
  }, [state, estadoCargado, storageKey]);

  // Cola offline persistida en localStorage (reactiva al cambiar pendientes).
  const [errorSync, setErrorSync] = useState<string | null>(null);

  /** Reenvía la cola de operaciones pendientes (off-line queue) a Supabase. */
  const reenviarPendientes = useCallback(async (): Promise<void> => {
    const supabase = getSupabase();
    if (!supabase || !userId || sincronizandoRef.current) return;
    const ops = pendientesRef.current;
    if (ops.length === 0) return;

    sincronizandoRef.current = true;
    const restantes: PendingOp[] = [];
    for (const op of ops) {
      try {
        if (op.kind === "upsert_habit") {
          const { error } = await supabase.from("habits").upsert(op.payload as { id: string; user_id: string; data: Habit });
          if (error) restantes.push(op);
        } else if (op.kind === "delete_habit") {
          const { error } = await supabase.from("habits").delete().eq("id", op.id).eq("user_id", userId);
          if (error) restantes.push(op);
        } else if (op.kind === "upsert_completion") {
          const { error } = await supabase.from("completions").upsert(op.payload as { event_id: string; user_id: string });
          if (error) restantes.push(op);
        } else if (op.kind === "delete_completion") {
          const { error } = await supabase.from("completions").delete().eq("event_id", op.event_id).eq("user_id", userId);
          if (error) restantes.push(op);
        } else if (op.kind === "delete_completions_of_habit") {
          // D2: reintento del borrado en cascada (ver eliminarHabit).
          const { error } = await supabase.from("completions").delete().eq("habit_id", op.habit_id).eq("user_id", userId);
          if (error) restantes.push(op);
        } else if (op.kind === "delete_push") {
          // E4: filtrar por user_id además del endpoint.
          const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", op.endpoint).eq("user_id", userId);
          if (error) restantes.push(op);
        } else if (op.kind === "upsert_tombstone") {
          // P2.6
          const { error } = await supabase.from("deleted_habits").upsert(op.payload as { user_id: string; habit_id: string });
          if (error) restantes.push(op);
        } else if (op.kind === "upsert_game") {
          // Juego: progreso de gamificación (un registro por usuario, LWW).
          const { error } = await supabase.from("game_state").upsert(op.payload as { user_id: string; data: unknown });
          if (error) restantes.push(op);
        }
      } catch {
        restantes.push(op);
      }
    }
    pendientesRef.current = restantes;
    guardarPendientes(clavePendientes(sufijo), restantes); // P1.5
    sincronizandoRef.current = false;
  }, [userId, sufijo]);

  /** Encola una operación para reintento cuando vuelva la conexión. */
  const encolar = useCallback((op: PendingOp): void => {
    const previos = pendientesRef.current;
    pendientesRef.current = [...previos, op];
    guardarPendientes(clavePendientes(sufijo), pendientesRef.current);
    // E2: guardarPendientes recorta a 200 en silencio — si se descartó la más
    // antigua, que el usuario lo vea en vez de perderla sin rastro.
    if (previos.length >= 200) {
      setErrorSync("cola de sincronización llena: el cambio más antiguo se descartó");
    }
  }, [sufijo]);

  /**
   * Descarga los datos del usuario desde Supabase y hace merge bidireccional:
   *  - Los pendientes off-line se reenvían primero para no pisar cambios sin subir.
   *  - D3: el diff local (hábitos que el servidor no tiene o que son más nuevos
   *    en local) se sube ANTES de descargar — antes, un hábito creado en local
   *    nunca llegaba a la nube porque el rehydrate solo vaciaba la cola.
   *  - Los habits/completions del servidor se fusionan con los locales (por id / event_id).
   *
   * P0.1: useCallback con identidad estable; el merge vive dentro del updater
   * funcional y solo actualiza el estado si hubo cambios reales.
   * D5: si falla la descarga de tombstones se aborta — seguir sin ellos
   * resucitaría hábitos borrados en otro dispositivo.
   */
  const rehidratar = useCallback(async (): Promise<void> => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;

    // 1. Reenviar pendientes acumulados off-line antes de descargar.
    await reenviarPendientes();

    try {
      // 2. Tombstones primero: D5 aborta si fallan; D3 los necesita para no
      // resucitar borrados de otro dispositivo.
      const borrados = new Set<string>();
      {
        const { data: tombRows, error: tError } = await supabase.from("deleted_habits").select("habit_id");
        if (tError) {
          if (!esErrorRed(tError)) console.error("Error descargando borrados:", tError.message);
          logEvent("SYNC_ERROR", "sync", null, { fase: "tombstones", error: tError.message });
          return;
        }
        for (const t of tombRows ?? []) borrados.add((t as { habit_id: string }).habit_id);
      }

      // 3. Descargar habits (paginado: PostgREST trunca en 1000 filas).
      const PAGE = 1000;
      const habitsRows: RemoteHabitRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("habits")
          .select("id, data, updated_at")
          .range(from, from + PAGE - 1);
        if (error) {
          if (!esErrorRed(error)) console.error("Error descargando habits:", error.message);
          logEvent("SYNC_ERROR", "sync", null, { fase: "habits", error: error.message });
          return;
        }
        habitsRows.push(...((data ?? []) as RemoteHabitRow[]));
        if (!data || data.length < PAGE) break;
      }

      // 3.5 D6: no duplicar hábitos demo entre instalaciones. crearEstadoInicial()
      // siembra 3 demos con ids aleatorios cada vez que el localStorage está
      // vacío (dispositivo nuevo, datos borrados); si el servidor ya tiene
      // hábitos, esos demos recién sembrados son redundantes — el merge por id
      // no puede conciliarlos y se acumulan como filas repetidas. Se descartan
      // los demos prístinos (sin registros de hoy: solo traen la semilla del
      // pasado) antes de subir el diff; si el usuario ya los usó hoy se
      // conservan porque pasaron a ser suyos.
      const demosPristinos = new Set<string>();
      if (habitsRows.length > 0) {
        const hoyKey = todayKey(new Date());
        const conTapsHoy = new Set(
          stateRef.current.completions.filter((c) => c.fecha >= hoyKey).map((c) => c.habitId),
        );
        for (const h of stateRef.current.habits) {
          if (h.id.startsWith("demo-") && !conTapsHoy.has(h.id)) demosPristinos.add(h.id);
        }
        if (demosPristinos.size > 0) {
          setState((prev) => ({
            ...prev,
            habits: prev.habits.filter((h) => !demosPristinos.has(h.id)),
            completions: prev.completions.filter((c) => !demosPristinos.has(c.habitId)),
          }));
        }
      }

      // 4. D3: subir el diff local antes de fusionar.
      {
        const remoteTsById = new Map(habitsRows.map((r) => [r.id, r.updated_at ?? ""]));
        const paraSubir = stateRef.current.habits.filter((h) => {
          if (demosPristinos.has(h.id)) return false; // D6: demo redundante, no subir
          if (borrados.has(h.id)) return false; // no resucitar borrados ajenos
          const remoteTs = remoteTsById.get(h.id);
          if (remoteTs === undefined) return true; // no existe en remoto
          const localTs = h.actualizadoEn ?? h.creadoEn ?? "";
          return localTs >= remoteTs; // empate o más nuevo: el local gana el LWW
        });
        for (const h of paraSubir) {
          const payload = { id: h.id, user_id: userId, data: h };
          const { error } = await supabase.from("habits").upsert(payload);
          if (error) {
            if (esErrorRed(error)) {
              encolar({ kind: "upsert_habit", payload });
            } else {
              console.error("Error subiendo hábito local:", error.message);
              setErrorSync("subir cambios locales");
              logEvent("SYNC_ERROR", "sync", null, { fase: "subir-diff", error: error.message });
            }
          }
        }
      }

      // 5. Traer completions del servidor (también paginado).
      const compRows: RemoteCompletionRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("completions")
          .select("event_id, habit_id, moment_id, fecha, subtareas_completadas, created_at")
          .range(from, from + PAGE - 1);
        if (error) {
          if (!esErrorRed(error)) console.error("Error descargando completions:", error.message);
          logEvent("SYNC_ERROR", "sync", null, { fase: "completions", error: error.message });
          return;
        }
        compRows.push(...((data ?? []) as RemoteCompletionRow[]));
        if (!data || data.length < PAGE) break;
      }

      setState((prev) =>
        fusionarHidratacion(
          prev,
          (habitsRows ?? []) as RemoteHabitRow[],
          (compRows ?? []) as RemoteCompletionRow[],
          borrados,
        ) ?? prev,
      );

      // 6. Estado de juego: merge por máximos/unión (converge entre
      // dispositivos) y subida del combinado. Si la tabla aún no existe
      // (migración pendiente), se ignora sin romper la hidratación.
      try {
        const { data: gsRow, error: gsError } = await supabase
          .from("game_state")
          .select("data")
          .eq("user_id", userId)
          .maybeSingle();
        if (!gsError) {
          const remoto = (gsRow as { data?: unknown } | null)?.data as JuegoState | undefined ?? null;
          const combinado = fusionarJuego(stateRef.current.juego ?? juegoInicial(), remoto);
          setState((prev) => ({ ...prev, juego: combinado }));
          const payload = { user_id: userId, data: combinado, updated_at: new Date().toISOString() };
          const { error: upError } = await supabase.from("game_state").upsert(payload);
          if (upError) {
            if (esErrorRed(upError)) encolar({ kind: "upsert_game", payload });
            else console.error("Error subiendo estado de juego:", upError.message);
          }
        }
      } catch (e) {
        if (!esErrorRed(e)) console.error("Error sincronizando juego:", e);
      }

      // 7. Reconciliar juego tras el merge (rachas máximas, desafíos, logros).
      setState((prev) => reconciliarJuego(prev));

      // Auditoría: la sincronización completó (aunque algún paso no crítico fallara).
      logEvent("SYNC_COMPLETED", "sync", null, { habits: habitsRows.length, completions: compRows.length });
    } catch (e) {
      if (esErrorRed(e)) return; // sin conexión: no romper
      console.error("Error durante la hidratación:", e);
      logEvent("SYNC_ERROR", "sync", null, { fase: "rehidratar", error: (e as { message?: string })?.message ?? String(e) });
    }
  }, [userId, reenviarPendientes, encolar]);

  /**
   * P0.3 (guardarraíl #2): ejecuta un write remoto inspeccionando SIEMPRE el
   * resultado. En supabase-js los errores de RLS/constraints resuelven como
   * `{ error }` en vez de rechazar — el `.then(() => {})` anterior los tragaba
   * en silencio y la "Fase 0" no garantizaba persistencia real.
   * - Error de red → se encola para reintento.
   * - Otro error → se surfacea en `errorSync` (la UI puede mostrar "sin sincronizar").
   */
  const sincronizar = useCallback(
    async (op: PendingOp, req: () => PromiseLike<{ error: unknown }>, descripcion: string): Promise<void> => {
      const supabase = getSupabase();
      if (!supabase || !userId) return;
      const manejarFallo = (e: unknown): void => {
        const mensaje = (e as { message?: string })?.message ?? String(e);
        if (esErrorRed(e)) {
          encolar(op);
          logEvent("SYNC_ERROR", "sync", null, { descripcion, tipo: "red", error: mensaje });
        } else {
          console.error(`Error sincronizando (${descripcion}):`, e);
          setErrorSync(descripcion);
          logEvent("SYNC_ERROR", "sync", null, { descripcion, tipo: "servidor", error: mensaje });
        }
      };
      try {
        const { error } = await req();
        if (error) manejarFallo(error);
        else setErrorSync(null);
      } catch (e) {
        manejarFallo(e);
      }
    },
    [userId, encolar],
  );

  // Registro de satisfacción: rehidratar usa reenviarPendientes; exponer igual.
  const rehidratarFn = useMemo(() => async () => {
    await reenviarPendientes();
    await rehidratar();
  }, [reenviarPendientes, rehidratar]);

  // P2.11: acciones con identidad estable — solo dependen de callbacks estables
  // y de stateRef, nunca del `state` del render.
  const actions = useMemo<Omit<StoreContextValue, "state" | "errorSync">>(
    () => {
      const guardar = (habit: Habit) => {
        const esNuevo = !stateRef.current.habits.some((h) => h.id === habit.id);
        setState((s) => guardarHabit(s, habit));
        const supabase = getSupabase();
        if (supabase && userId) {
          const payload = { id: habit.id, user_id: userId, data: habit };
          void sincronizar(
            { kind: "upsert_habit", payload },
            () => supabase.from("habits").upsert(payload).then((r) => ({ error: r.error })),
            esNuevo ? "crear hábito" : "actualizar hábito",
          );
        }
        logEvent(esNuevo ? "HABIT_CREATED" : "HABIT_UPDATED", "habit", habit.id, { nombre: habit.nombre, categoria: habit.categoria });
      };
      return {
      rehidratar: rehidratarFn,
      // E3: exponer el flush para que el cierre de sesión no deje la cola huérfana.
      sincronizarAhora: reenviarPendientes,
      guardarHabit: guardar,
      eliminarHabit: (id) => {
        setState((s) => eliminarHabit(s, id));
        const supabase = getSupabase();
        if (supabase && userId) {
          // Filtra también por user_id para respetar Row Level Security.
          void sincronizar(
            { kind: "delete_habit", id },
            () => supabase.from("habits").delete().eq("id", id).eq("user_id", userId).then((r) => ({ error: r.error })),
            "eliminar hábito",
          );
          // D2: borrar también sus completions remotas — si no, quedan huérfanas
          // y el merge las filtraba, pero seguían ocupando la tabla.
          void sincronizar(
            { kind: "delete_completions_of_habit", habit_id: id },
            () =>
              supabase
                .from("completions")
                .delete()
                .eq("habit_id", id)
                .eq("user_id", userId)
                .then((r) => ({ error: r.error })),
            "eliminar cumplimientos del hábito",
          );
          // P2.6: tombstone para que el borrado se propague a otros dispositivos
          // (el rehydrate de otro dispositivo ya no lo re-agregará).
          const tombstone = { user_id: userId, habit_id: id, deleted_at: new Date().toISOString() };
          void sincronizar(
            { kind: "upsert_tombstone", payload: tombstone },
            () => supabase.from("deleted_habits").upsert(tombstone).then((r) => ({ error: r.error })),
            "registrar borrado",
          );
        }
        logEvent("HABIT_DELETED", "habit", id, null);
      },
      guardarSettings: (settings) => {
        setState((s) => actualizarSettings(s, settings));
        logEvent("SETTINGS_UPDATED", "settings", null, settings as unknown as Record<string, unknown>);
      },
      actualizarJuego: (parcial) => {
        const nuevo = {
          ...stateRef.current.juego,
          ...parcial,
          actualizadoEn: new Date().toISOString(),
        };
        setState((s) => ({ ...s, juego: { ...s.juego, ...parcial, actualizadoEn: nuevo.actualizadoEn } }));
        const supabase = getSupabase();
        if (supabase && userId) {
          const payload = { user_id: userId, data: nuevo, updated_at: nuevo.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload },
            () => supabase.from("game_state").upsert(payload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
        }
      },
      registrar: (habitId, momentId, fecha, subtareasCompletadas) => {
        const timestamp = new Date().toISOString();
        // P0.2: el eventId se genera UNA sola vez y viaja idéntico al estado
        // local y a Supabase (guardarraíl #1).
        const eventId = construirEventId(habitId, momentId, fecha);
        // Juego: registra el cumplimiento y aplica XP/niveles/logros/etc.
        // Si el evento ya existía (tap duplicado), no hay recompensa.
        const xpAntes = stateRef.current.juego?.xpTotal ?? 0;
        const { state: nuevo, eventos } = registrarConJuego(
          stateRef.current, habitId, momentId, fecha, timestamp, subtareasCompletadas, eventId,
        );
        setState(nuevo);
        if (eventos.length > 0) emitirEventosJuego(eventos);
        // Auditoría milimétrica del juego: XP ganado + cada evento de dominio.
        const xpGanado = (nuevo.juego?.xpTotal ?? 0) - xpAntes;
        if (xpGanado > 0) {
          logEvent("XP_GAINED", "juego", null, { xp: xpGanado, habitId, fecha });
        }
        for (const e of eventos) {
          const accion = ACCION_POR_TIPO_EVENTO[e.tipo];
          if (accion) logEvent(accion, "juego", e.dato ?? null, { titulo: e.titulo, detalle: e.detalle });
        }
        const supabase = getSupabase();
        if (supabase && userId) {
          const payload = {
            event_id: eventId,
            user_id: userId,
            habit_id: habitId,
            moment_id: momentId ?? null,
            fecha,
            subtareas_completadas: subtareasCompletadas ?? [],
          };
          void sincronizar(
            { kind: "upsert_completion", payload },
            () => supabase.from("completions").upsert(payload).then((r) => ({ error: r.error })),
            "registrar cumplimiento",
          );
          // Juego: subir el progreso (un registro por usuario).
          const juegoPayload = { user_id: userId, data: nuevo.juego, updated_at: nuevo.juego.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload: juegoPayload },
            () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
          // Liga: publicar el XP semanal (no crítico, sin errorSync).
          void publicarXpLiga(supabase, userId, nuevo.juego);
        }
        logEvent("COMPLETION_REGISTERED", "completion", eventId, { habitId, momentId, fecha, subtareasCompletadas });
      },
      deshacer: (event) => {
        const xpAntes = stateRef.current.juego?.xpTotal ?? 0;
        const nuevo = deshacerConJuego(stateRef.current, event.eventId);
        setState(nuevo);
        const xpDevuelto = xpAntes - (nuevo.juego?.xpTotal ?? 0);
        if (xpDevuelto > 0) {
          logEvent("XP_REVERTED", "juego", null, { xp: xpDevuelto, habitId: event.habitId, fecha: event.fecha });
        }
        const supabase = getSupabase();
        if (supabase && userId) {
          void sincronizar(
            { kind: "delete_completion", event_id: event.eventId },
            () => supabase.from("completions").delete().eq("event_id", event.eventId).eq("user_id", userId).then((r) => ({ error: r.error })),
            "deshacer cumplimiento",
          );
          // Juego: subir el progreso revertido (un registro por usuario).
          const juegoPayload = { user_id: userId, data: nuevo.juego, updated_at: nuevo.juego.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload: juegoPayload },
            () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
          // Liga: republicar el XP semanal (pudo haber bajado).
          void publicarXpLiga(supabase, userId, nuevo.juego);
        }
        logEvent("COMPLETION_UNDONE", "completion", event.eventId, { habitId: event.habitId, fecha: event.fecha });
      },
      cambiarEstadoTodos: (estado) => {
        const afectados = stateRef.current.habits.filter((h) => h.estado !== "archivado" && h.estado !== estado);
        if (afectados.length === 0) return;
        setState((s) => cambiarEstadoTodos(s, estado));
        logEvent(estado === "pausado" ? "HABITS_PAUSED" : "HABITS_RESUMED", "habit", null, { cantidad: afectados.length });
        const supabase = getSupabase();
        if (supabase && userId) {
          for (const h of afectados) {
            const habit = { ...h, estado, actualizadoEn: new Date().toISOString() };
            const payload = { id: habit.id, user_id: userId, data: habit };
            void sincronizar(
              { kind: "upsert_habit", payload },
              () => supabase.from("habits").upsert(payload).then((r) => ({ error: r.error })),
              "actualizar hábito",
            );
          }
        }
      },
      reiniciarTodo: async () => {
        // 1. Nube primero (si hay sesión): borra todas las filas del usuario.
        //    Si falla, se aborta sin tocar lo local para no dejar estados a medias.
        const supabase = getSupabase();
        if (supabase && userId) {
          for (const tabla of ["completions", "deleted_habits", "habits", "game_state"] as const) {
            const { error } = await supabase.from(tabla).delete().eq("user_id", userId);
            if (error) throw new Error(`No se pudo borrar tus datos en la nube (${tabla}). Revisa tu conexión e inténtalo de nuevo.`);
          }
        }
        // 2. Limpia el almacenamiento local DE ESTA IDENTIDAD (perfil o cuenta).
        //    Acotado al sufijo: jamás toca los datos de otros perfiles ni el
        //    registro de perfiles. Sin sufijo (modo local heredado), limpieza amplia.
        try {
          if (sufijo) {
            for (const k of clavesDeDatos(sufijo)) window.localStorage.removeItem(k);
          } else {
            const borrar: string[] = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const k = window.localStorage.key(i);
              if (k && k.startsWith("habitos-")) borrar.push(k);
            }
            for (const k of borrar) window.localStorage.removeItem(k);
          }
        } catch {
          /* almacenamiento no disponible */
        }
        pendientesRef.current = [];
        // 3. Estado vacío real, sin demos: empezar desde 0.
        const vacio: AppState = { ...crearEstadoInicial(), habits: [], completions: [], juego: juegoInicial() };
        setState(vacio);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(vacio));
        } catch {
          /* almacenamiento no disponible */
        }
        logEvent("APP_RESET", "app", null, null);
      },
      posponerHabit: (id) => {
        const h = stateRef.current.habits.find((x) => x.id === id);
        if (!h || h.estado !== "activo") return;
        const manana = todayKey(addDays(new Date(), 1));
        // Toggle: si ya está aplazado para mañana, se devuelve a hoy.
        const pospuestoHasta = h.pospuestoHasta === manana ? undefined : manana;
        guardar({ ...h, pospuestoHasta });
        logEvent(pospuestoHasta ? "HABIT_SNOOZED" : "HABIT_UNSNOOZED", "habit", id, { pospuestoHasta: pospuestoHasta ?? null });
      },
    }
    },
    [userId, sincronizar, rehidratarFn, reenviarPendientes, storageKey, sufijo],
  );

  // Rehidratar al iniciar sesión (cambio de usuario) y al volver a estar online.
  useEffect(() => {
    if (!userId || !estadoCargado) return;
    // setTimeout corto para que el primer render local no parpadee.
    const t = setTimeout(() => void rehidratar(), 50);
    return () => clearTimeout(t);
  }, [userId, estadoCargado, rehidratar]);

  // Reenviar cola pendiente cuando vuelve la conexión (y auditar el cambio de red).
  useEffect(() => {
    if (!userId) return;
    const onOnline = () => {
      logEvent("ONLINE", "app", null, null);
      void flushLog();
      void reenviarPendientes();
    };
    const onOffline = () => logEvent("OFFLINE", "app", null, null);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [userId, reenviarPendientes]);

  const stateValue = useMemo(() => ({ state, errorSync }), [state, errorSync]);

  return (
    <StoreStateContext.Provider value={stateValue}>
      <StoreActionsContext.Provider value={actions}>{children}</StoreActionsContext.Provider>
    </StoreStateContext.Provider>
  );
}

export function useStoreState(): { state: AppState; errorSync: string | null } {
  const ctx = useContext(StoreStateContext);
  if (!ctx) throw new Error("useStoreState debe usarse dentro de <StoreProvider>");
  return ctx;
}

export function useStoreActions(): Omit<StoreContextValue, "state" | "errorSync"> {
  const ctx = useContext(StoreActionsContext);
  if (!ctx) throw new Error("useStoreActions debe usarse dentro de <StoreProvider>");
  return ctx;
}

/** Compatibilidad: combina estado + acciones (prefiere los hooks granulares). */
export function useStore(): StoreContextValue {
  const { state, errorSync } = useStoreState();
  return { state, errorSync, ...useStoreActions() };
}
