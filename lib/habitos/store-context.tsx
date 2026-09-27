"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  crearEstadoInicial,
  cambiarEstadoTodos,
  corregirSuenoConJuego,
  deshacerConJuego,
  guardarHabit,
  normalizarEstado,
  eliminarHabit,
  actualizarSettings,
  registrarConJuego,
  registrarSuenoConJuego,
  STORAGE_KEY,
} from "./store";
import {
  emitirEventosJuego,
  fusionarJuego,
  juegoInicial,
  reclamarLogro,
  reconciliarJuego,
  type TipoEventoJuego,
} from "./juego";
import { publicarXpLiga } from "./liga";
import type { AppState, Habit, CompletionEvent, JuegoState, MarcaSueno, Settings } from "./types";
import { construirEventId } from "../core/event-id";
import { fusionarHidratacion, type RemoteCompletionRow, type RemoteHabitRow } from "./sync-merge";
import { getSupabase } from "../core/supabase";
import { todayKey, addDays, moverFecha, timestampLocal } from "./dates";
import { fechaParaMarcaSueno, nocheEstaCompleta, nochesSueno } from "./gamificacion";
import { habitosAnclaPendientes } from "./anclas";
import { useAuth } from "../../components/AuthGate";
import { logEvent, flushLog, type LogAction } from "../core/logger";
import { fijarSufijoNotificaciones } from "./notifications";
import {
  claveEstado,
  clavePendientes as clavePendientesAmbito,
  clavesDeDatos,
  sufijoDePerfil,
} from "../core/ambito";
import { asegurarSesion } from "../core/supabase";
import { crearColaSync, type ColaSync } from "../core/sync-queue";

/** Auditoría: cada evento de juego del dominio se refleja en el activity_log. */
const ACCION_POR_TIPO_EVENTO: Record<TipoEventoJuego, LogAction | null> = {
  "subida-nivel": "LEVEL_UP",
  logro: "ACHIEVEMENT_UNLOCKED",
  cofre: "CHEST_OPENED",
  desafio: "CHALLENGE_COMPLETED",
  "congelador-ganado": "FREEZER_EARNED",
  "congelador-usado": "FREEZER_USED",
  // Sueño: el tap ya queda auditado con SUENO_REGISTRADO (+ XP_GAINED/LOST).
  sueno: null,
  // El nudge de momentos anclados es un aviso de UI, no un evento de juego.
  "recordatorio-ancla": null,
};

/**
 * Auditoría de omisiones de sueño: reconciliarJuego es puro y descuenta en
 * silencio; aquí se emite SUENO_FALLO por cada marca recién penalizada.
 */
function auditarFallosSueno(previo: AppState, nuevo: AppState) {
  const antes = new Set(previo.juego?.suenoFallos ?? []);
  const sueno = nuevo.habits.find((h) => h.tipo === "sueno");
  for (const clave of nuevo.juego?.suenoFallos ?? []) {
    if (antes.has(clave)) continue;
    const [cual, fecha] = clave.split("|");
    logEvent("SUENO_FALLO", "juego", sueno?.id ?? null, { cual, fecha, xp: 10 });
  }
}

/** APP_OPENED se registra una sola vez por carga de página. */
let appOpenedLogged = false;

const PENDING_KEY_BASE = "habitos-pending-sync-v1";

/** P1.5: la cola offline se nombra por identidad (userId de la cuenta).
 *  Al cambiar de identidad se recarga desde la clave activa. */
function clavePendientes(sufijo: string | null): string {
  return sufijo ? clavePendientesAmbito(sufijo) : PENDING_KEY_BASE;
}

interface StoreContextValue {
  state: AppState;
  guardarHabit: (habit: Habit) => void;
  eliminarHabit: (id: string) => void;
  guardarSettings: (settings: Settings) => void;
  registrar: (habitId: string, momentId: string | undefined, fecha: string, subtareasCompletadas?: string[]) => number;
  /**
   * Marca de sueño ("levantar" | "acostar") con su hora real.
   * Sin fechaForzada, atribuye la fecha según la regla de medianoche.
   * Si la marca ya existía para esa fecha, corrige la hora (revierte el XP
   * anterior y recalcula). Otorga XP por puntualidad (puede ser negativo).
   */
  registrarSueno: (habitId: string, cual: MarcaSueno, horaReal: string, fechaForzada?: string) => void;
  deshacer: (event: CompletionEvent) => void;
  /** Modo vacaciones: pausa o reanuda todos los hábitos no archivados de una vez. */
  cambiarEstadoTodos: (estado: "activo" | "pausado") => void;
  /** Aplaza un hábito para mañana (toggle: si ya está aplazado, lo devuelve a hoy). */
  posponerHabit: (id: string, motivo?: string) => void;
  /**
   * Reclama el premio de XP de un logro desbloqueado (tap en la sala de
   * trofeos). Devuelve el XP ganado y el nivel alcanzado si subió.
   */
  reclamarLogro: (logroId: string) => { xpGanado: number; nivel: { nivel: number; nombre: string } | null };
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

/**
 * Ejecutor de la cola offline (dominio Hábitos): cómo se sube cada operación
 * a Supabase. Devuelve `true` si se completó. La cola genérica
 * (`lib/core/sync-queue`) se encarga del orden, el tope y los reintentos.
 */
async function ejecutarOpSync(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  userId: string,
  perfilId: string,
  op: PendingOp,
): Promise<boolean> {
  const { error } = await (async () => {
    if (op.kind === "upsert_habit") {
      return await supabase.from("habits").upsert(op.payload as { id: string; user_id: string; data: Habit });
    } else if (op.kind === "delete_habit") {
      return await supabase.from("habits").delete().eq("id", op.id).eq("user_id", userId).eq("perfil_id", perfilId);
    } else if (op.kind === "upsert_completion") {
      return await supabase.from("completions").upsert(op.payload as { event_id: string; user_id: string });
    } else if (op.kind === "delete_completion") {
      return await supabase.from("completions").delete().eq("event_id", op.event_id).eq("user_id", userId).eq("perfil_id", perfilId);
    } else if (op.kind === "delete_completions_of_habit") {
      // D2: reintento del borrado en cascada (ver eliminarHabit).
      return await supabase.from("completions").delete().eq("habit_id", op.habit_id).eq("user_id", userId).eq("perfil_id", perfilId);
    } else if (op.kind === "delete_push") {
      // E4: filtrar por user_id además del endpoint.
      return await supabase.from("push_subscriptions").delete().eq("endpoint", op.endpoint).eq("user_id", userId).eq("perfil_id", perfilId);
    } else if (op.kind === "upsert_tombstone") {
      // P2.6
      return await supabase.from("deleted_habits").upsert(op.payload as { user_id: string; habit_id: string });
    } else {
      // Juego: progreso de gamificación (un registro por usuario, LWW).
      return await supabase.from("game_state").upsert(op.payload as { user_id: string; data: unknown });
    }
  })();
  return !error;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, perfilId } = useAuth();
  const userId = user?.id ?? null;
  // Identidad = cuenta + perfil activo. Todo (estado, colas, logs,
  // notificaciones, filas en la nube) se aísla por este sufijo.
  const sufijo = sufijoDePerfil(userId, perfilId);
  // Puerta de la nube: sin perfil activo no se escribe nada remoto.
  const nubeLista = !!userId && !!perfilId;
  const storageKey = sufijo ? claveEstado(sufijo) : STORAGE_KEY;

  // Siempre se arranca con el estado inicial por defecto para el render del servidor
  // y el primer render de hidratación (evita mismatch de hidratación).
  const [state, setState] = useState<AppState>(crearEstadoInicial);
  const [estadoCargado, setEstadoCargado] = useState(false);
  // E2: el aviso de cola llena vive aquí para que el alDesbordar de la cola
  // (definido debajo) pueda llamarlo sin violar el orden de declaración.
  const [errorSync, setErrorSync] = useState<string | null>(null);
  /**
   * Cola offline (núcleo genérico `lib/core/sync-queue` + ejecutor del dominio).
   * Se (re)crea por identidad: al cambiar de cuenta/perfil se lee la cola de
   * la clave activa, igual que antes con `leerPendientes`.
   */
  const colaRef = useRef<ColaSync<PendingOp> | null>(null);
  const obtenerCola = useCallback((): ColaSync<PendingOp> => {
    if (!colaRef.current) {
      colaRef.current = crearColaSync<PendingOp>({
        clave: clavePendientes(sufijo),
        tope: 200,
        puedeReenviar: () => Boolean(getSupabase() && userId && perfilId),
        antesDeReenviar: async () => {
          // Token fresco: si venció mientras estábamos offline, se refresca
          // aquí para que la cola no choque con 401 al volver la red.
          await asegurarSesion();
        },
        ejecutar: (op) => {
          const supabase = getSupabase();
          if (!supabase || !userId || !perfilId) return Promise.resolve(false);
          return ejecutarOpSync(supabase, userId, perfilId, op);
        },
        alDesbordar: () => {
          // E2: guardarPendientes recorta a 200 en silencio — si se descartó
          // la más antigua, que el usuario lo vea en vez de perderla sin rastro.
          setErrorSync("cola de sincronización llena: el cambio más antiguo se descartó");
        },
      });
    }
    return colaRef.current;
  }, [sufijo, userId, perfilId]);
  // P2.11: espejo del estado para que las acciones lean sin cerrar sobre `state`
  // y mantengan identidad estable entre renders.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Notificaciones: aislar "ya enviadas" por identidad (userId).
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
      const inicial = cargarEstadoGuardado(storageKey);
      const reconciliado = reconciliarJuego(inicial);
      auditarFallosSueno(inicial, reconciliado);
      setState(reconciliado);
      colaRef.current = null; // P1.5: la próxima obtención lee la cola de la identidad activa.
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

  // Cola offline (núcleo genérico): ver obtenerCola arriba.

  /** Reenvía la cola de operaciones pendientes (off-line queue) a Supabase. */
  const reenviarPendientes = useCallback(async (): Promise<void> => {
    await obtenerCola().reenviar();
  }, [obtenerCola]);

  /** Encola una operación para reintento cuando vuelva la conexión. */
  const encolar = useCallback((op: PendingOp): void => {
    obtenerCola().encolar(op);
  }, [obtenerCola]);

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
    if (!supabase || !userId || !perfilId) return;

    // 1. Reenviar pendientes acumulados off-line antes de descargar.
    await reenviarPendientes();

    try {
      // 2. Tombstones primero: D5 aborta si fallan; D3 los necesita para no
      // resucitar borrados de otro dispositivo.
      const borrados = new Set<string>();
      {
        const { data: tombRows, error: tError } = await supabase.from("deleted_habits").select("habit_id").eq("user_id", userId).eq("perfil_id", perfilId);
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
          .eq("user_id", userId)
          .eq("perfil_id", perfilId)
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
          const payload = { id: h.id, user_id: userId, perfil_id: perfilId, data: h };
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
          .eq("user_id", userId)
          .eq("perfil_id", perfilId)
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
          .eq("perfil_id", perfilId)
          .maybeSingle();
        if (!gsError) {
          const remoto = (gsRow as { data?: unknown } | null)?.data as JuegoState | undefined ?? null;
          const combinado = fusionarJuego(stateRef.current.juego ?? juegoInicial(), remoto);
          setState((prev) => ({ ...prev, juego: combinado }));
          const payload = { user_id: userId, perfil_id: perfilId, data: combinado, updated_at: new Date().toISOString() };
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
      // Las omisiones de sueño recién penalizadas se auditan (SUENO_FALLO).
      const previoMerge = stateRef.current;
      const trasReconciliar = reconciliarJuego(previoMerge);
      auditarFallosSueno(previoMerge, trasReconciliar);
      setState(trasReconciliar);

      // Auditoría: la sincronización completó (aunque algún paso no crítico fallara).
      logEvent("SYNC_COMPLETED", "sync", null, { habits: habitsRows.length, completions: compRows.length });
    } catch (e) {
      if (esErrorRed(e)) return; // sin conexión: no romper
      console.error("Error durante la hidratación:", e);
      logEvent("SYNC_ERROR", "sync", null, { fase: "rehidratar", error: (e as { message?: string })?.message ?? String(e) });
    }
  }, [userId, perfilId, reenviarPendientes, encolar]);

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
      if (!supabase || !userId || !perfilId) return;
      // Sesión fresca antes de escribir (lectura local; solo toca la red si
      // el token venció). Evita 401 en taps hechos tras volver la conexión.
      await asegurarSesion();
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
    [userId, perfilId, encolar],
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
        if (supabase && nubeLista) {
          const payload = { id: habit.id, user_id: userId, perfil_id: perfilId, data: habit };
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
        if (supabase && nubeLista) {
          // Filtra también por user_id para respetar Row Level Security.
          void sincronizar(
            { kind: "delete_habit", id },
            () => supabase.from("habits").delete().eq("id", id).eq("user_id", userId).eq("perfil_id", perfilId).then((r) => ({ error: r.error })),
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
                .eq("perfil_id", perfilId)
                .then((r) => ({ error: r.error })),
            "eliminar cumplimientos del hábito",
          );
          // P2.6: tombstone para que el borrado se propague a otros dispositivos
          // (el rehydrate de otro dispositivo ya no lo re-agregará).
          const tombstone = { user_id: userId, perfil_id: perfilId, habit_id: id, deleted_at: new Date().toISOString() };
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
        if (supabase && nubeLista) {
          const payload = { user_id: userId, perfil_id: perfilId, data: nuevo, updated_at: nuevo.actualizadoEn };
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
        if (supabase && nubeLista) {
          const payload = {
            event_id: eventId,
            user_id: userId,
            perfil_id: perfilId,
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
          const juegoPayload = { user_id: userId, perfil_id: perfilId, data: nuevo.juego, updated_at: nuevo.juego.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload: juegoPayload },
            () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
          // Liga: publicar el XP semanal (no crítico, sin errorSync).
          void publicarXpLiga(supabase, userId, perfilId, nuevo.juego);
        }
        logEvent("COMPLETION_REGISTERED", "completion", eventId, { habitId, momentId, fecha, subtareasCompletadas });
        return xpGanado;
      },
      registrarSueno: (habitId, cual, horaReal, fechaForzada) => {
        const previo = stateRef.current;
        const habit = previo.habits.find((h) => h.id === habitId);
        if (!habit || habit.tipo !== "sueno" || habit.estado !== "activo") return;
        if (!/^\d{2}:\d{2}$/.test(horaReal)) return;
        // Fecha según la regla de medianoche (acostarse de madrugada = noche anterior).
        const fecha = fechaForzada ?? fechaParaMarcaSueno(cual, horaReal, new Date());
        const timestamp = timestampLocal(fecha, horaReal);
        // Mismo esquema de eventId que el registro normal: idempotente por marca+fecha.
        const eventId = `${habitId}|${cual}|${fecha}`;
        const existe = previo.completions.some((c) => c.eventId === eventId);
        const xpAntes = previo.juego?.xpTotal ?? 0;
        // Si la marca ya existía, se corrige: revierte el XP anterior y recalcula.
        const { state: nuevo, eventos } = existe
          ? corregirSuenoConJuego(previo, habitId, cual, fecha, timestamp)
          : registrarSuenoConJuego(previo, habitId, cual, fecha, timestamp, eventId);
        setState(nuevo);
        // Nudge: si hay hábitos con momento anclado a esta marca (levantar/
        // acostar) aún sin marcar hoy, se avisa en la UI (solo marcas nuevas,
        // no correcciones: no naggear).
        if (!existe) {
          const pendientes = habitosAnclaPendientes(nuevo.habits, nuevo.completions, cual, fecha);
          if (pendientes.length > 0) {
            eventos.push({
              tipo: "recordatorio-ancla",
              titulo:
                pendientes.length === 1
                  ? `¿Ya hiciste "${pendientes[0].nombre}"?`
                  : `¿Ya hiciste tus hábitos de ${cual === "levantar" ? "al levantarte" : "al acostarte"}?`,
              detalle: pendientes.map((h) => h.nombre).join(", "),
              dato: cual,
            });
          }
        }
        if (eventos.length > 0) emitirEventosJuego(eventos);
        // Auditoría: el XP por puntualidad puede ser negativo.
        const xpDelta = (nuevo.juego?.xpTotal ?? 0) - xpAntes;
        if (xpDelta !== 0) {
          logEvent(xpDelta > 0 ? "XP_GAINED" : "XP_LOST", "juego", null, {
            xp: Math.abs(xpDelta),
            habitId,
            fecha,
            sueno: cual,
          });
        }
        logEvent("SUENO_REGISTRADO", "juego", habitId, {
          cual,
          fecha,
          horaReal,
          correccion: existe,
          xpDelta,
        });
        for (const e of eventos) {
          const accion = ACCION_POR_TIPO_EVENTO[e.tipo];
          if (accion) logEvent(accion, "juego", e.dato ?? null, { titulo: e.titulo, detalle: e.detalle });
        }
        // Noche completa → log invisible de horas dormidas (solo marcas nuevas).
        if (!existe) {
          const noche = cual === "levantar" ? moverFecha(fecha, -1) : fecha;
          if (
            !nocheEstaCompleta(habit, previo.completions, noche) &&
            nocheEstaCompleta(habit, nuevo.completions, noche)
          ) {
            const info = nochesSueno(habit, nuevo.completions).find((n) => n.noche === noche);
            if (info) {
              logEvent("SUENO_NOCHE_COMPLETA", "juego", habitId, {
                noche,
                horas: info.horas,
                acostadoEn: info.acostadoEn,
                levantadoEn: info.levantadoEn,
                objetivoHoras: habit.objetivoHoras ?? 8,
              });
            }
          }
        }
        const supabase = getSupabase();
        if (supabase && nubeLista) {
          const payload = {
            event_id: eventId,
            user_id: userId,
            perfil_id: perfilId,
            habit_id: habitId,
            moment_id: cual,
            fecha,
            // La hora REAL de la marca (puede corregirse después): sin esto,
            // la hidratación usaría la hora del tap y el puntaje/log nocturno
            // divergirían entre dispositivos.
            created_at: timestamp,
            subtareas_completadas: [],
          };
          void sincronizar(
            { kind: "upsert_completion", payload },
            () => supabase.from("completions").upsert(payload).then((r) => ({ error: r.error })),
            "registrar sueño",
          );
          const juegoPayload = { user_id: userId, perfil_id: perfilId, data: nuevo.juego, updated_at: nuevo.juego.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload: juegoPayload },
            () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
          void publicarXpLiga(supabase, userId, perfilId, nuevo.juego);
        }
      },
      reclamarLogro: (logroId) => {
        const res = reclamarLogro(stateRef.current, logroId);
        if (res.xpGanado > 0) {
          setState(res.state);
          logEvent("XP_GAINED", "juego", logroId, { xp: res.xpGanado, logro: logroId });
          logEvent("ACHIEVEMENT_CLAIMED", "juego", logroId, { xp: res.xpGanado });
          if (res.subioNivel) {
            logEvent("LEVEL_UP", "juego", String(res.subioNivel.nivel), { nombre: res.subioNivel.nombre });
          }
          const supabase = getSupabase();
          if (supabase && nubeLista) {
            const juego = res.state.juego!;
            const juegoPayload = { user_id: userId, perfil_id: perfilId, data: juego, updated_at: juego.actualizadoEn };
            void sincronizar(
              { kind: "upsert_game", payload: juegoPayload },
              () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
              "reclamar premio de logro",
            );
            // Liga: publicar el XP semanal (no crítico, sin errorSync).
            void publicarXpLiga(supabase, userId, perfilId, juego);
          }
        }
        return {
          xpGanado: res.xpGanado,
          nivel: res.subioNivel ? { nivel: res.subioNivel.nivel, nombre: res.subioNivel.nombre } : null,
        };
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
        if (supabase && nubeLista) {
          void sincronizar(
            { kind: "delete_completion", event_id: event.eventId },
            () => supabase.from("completions").delete().eq("event_id", event.eventId).eq("user_id", userId).eq("perfil_id", perfilId).then((r) => ({ error: r.error })),
            "deshacer cumplimiento",
          );
          // Juego: subir el progreso revertido (un registro por usuario).
          const juegoPayload = { user_id: userId, perfil_id: perfilId, data: nuevo.juego, updated_at: nuevo.juego.actualizadoEn };
          void sincronizar(
            { kind: "upsert_game", payload: juegoPayload },
            () => supabase.from("game_state").upsert(juegoPayload).then((r) => ({ error: r.error })),
            "guardar progreso de juego",
          );
          // Liga: republicar el XP semanal (pudo haber bajado).
          void publicarXpLiga(supabase, userId, perfilId, nuevo.juego);
        }
        logEvent("COMPLETION_UNDONE", "completion", event.eventId, { habitId: event.habitId, fecha: event.fecha });
      },
      cambiarEstadoTodos: (estado) => {
        const afectados = stateRef.current.habits.filter((h) => h.estado !== "archivado" && h.estado !== estado);
        if (afectados.length === 0) return;
        setState((s) => cambiarEstadoTodos(s, estado));
        logEvent(estado === "pausado" ? "HABITS_PAUSED" : "HABITS_RESUMED", "habit", null, { cantidad: afectados.length });
        const supabase = getSupabase();
        if (supabase && nubeLista) {
          for (const h of afectados) {
            const habit = { ...h, estado, actualizadoEn: new Date().toISOString() };
            const payload = { id: habit.id, user_id: userId, perfil_id: perfilId, data: habit };
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
        if (supabase && nubeLista) {
          // Acotado al perfil activo: jamás toca los otros perfiles de la cuenta.
          for (const tabla of ["completions", "deleted_habits", "habits", "game_state"] as const) {
            const { error } = await supabase.from(tabla).delete().eq("user_id", userId).eq("perfil_id", perfilId);
            if (error) throw new Error(`No se pudo borrar tus datos en la nube (${tabla}). Revisa tu conexión e inténtalo de nuevo.`);
          }
        }
        // 2. Limpia el almacenamiento local DE ESTA IDENTIDAD (userId).
        //    Acotado al sufijo: jamás toca los datos de otros usuarios.
        //    Sin sufijo (modo local heredado), limpieza amplia.
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
        obtenerCola().vaciar();
        // 3. Estado vacío real, sin demos: empezar desde 0.
        //    El sueño es permanente: sobrevive al reinicio (nace de nuevo).
        const base = crearEstadoInicial();
        const sueno = base.habits.find((h) => h.tipo === "sueno");
        const vacio: AppState = { ...base, habits: sueno ? [sueno] : [], completions: [], juego: juegoInicial() };
        setState(vacio);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(vacio));
        } catch {
          /* almacenamiento no disponible */
        }
        logEvent("APP_RESET", "app", null, null);
      },
      posponerHabit: (id, motivo) => {
        const h = stateRef.current.habits.find((x) => x.id === id);
        if (!h || h.estado !== "activo") return;
        const manana = todayKey(addDays(new Date(), 1));
        // Toggle: si ya está aplazado para mañana, se devuelve a hoy.
        const pospuestoHasta = h.pospuestoHasta === manana ? undefined : manana;
        const pospuestoMotivo = pospuestoHasta ? (motivo?.trim() || undefined) : undefined;
        guardar({ ...h, pospuestoHasta, pospuestoMotivo });
        logEvent(pospuestoHasta ? "HABIT_SNOOZED" : "HABIT_UNSNOOZED", "habit", id, {
          pospuestoHasta: pospuestoHasta ?? null,
          motivo: pospuestoMotivo ?? null,
        });
      },
    }
    },
    [userId, perfilId, nubeLista, sincronizar, rehidratarFn, reenviarPendientes, storageKey, sufijo, obtenerCola],
  );

  // Rehidratar al iniciar sesión (cambio de usuario) y al volver a estar online.
  useEffect(() => {
    if (!userId || !perfilId || !estadoCargado) return;
    // setTimeout corto para que el primer render local no parpadee.
    const t = setTimeout(() => void rehidratar(), 50);
    return () => clearTimeout(t);
  }, [userId, perfilId, estadoCargado, rehidratar]);

  // Reenviar cola pendiente cuando vuelve la conexión (y auditar el cambio de red).
  useEffect(() => {
    if (!userId || !perfilId) return;
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
  }, [userId, perfilId, reenviarPendientes]);

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
