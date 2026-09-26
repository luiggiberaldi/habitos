"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  crearEstadoInicial,
  deshacerCumplimiento,
  guardarHabit,
  normalizarEstado,
  eliminarHabit,
  registrarCumplimiento,
  actualizarSettings,
  STORAGE_KEY,
} from "./store";
import type { AppState, Habit, CompletionEvent, Settings } from "./types";
import { construirEventId } from "./event-id";
import { fusionarHidratacion, type RemoteCompletionRow, type RemoteHabitRow } from "./sync-merge";
import { getSupabase } from "./supabase";
import { useAuth } from "../components/AuthGate";
import { logEvent } from "./logger";

const PENDING_KEY_BASE = "habitos-pending-sync-v1";

/** P1.5: la cola offline se nombra por usuario. Al cambiar de sesión se recarga
 *  desde la clave del usuario activo (y se vacía en memoria si no hay sesión). */
function clavePendientes(userId: string | undefined): string {
  return userId ? `${PENDING_KEY_BASE}:${userId}` : PENDING_KEY_BASE;
}

interface StoreContextValue {
  state: AppState;
  guardarHabit: (habit: Habit) => void;
  eliminarHabit: (id: string) => void;
  guardarSettings: (settings: Settings) => void;
  registrar: (habitId: string, momentId: string | undefined, fecha: string, subtareasCompletadas?: string[]) => void;
  deshacer: (event: CompletionEvent) => void;
  rehidratar: () => Promise<void>;
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
  | { kind: "delete_push"; endpoint: string }
  /** P2.6: tombstone de hábito borrado (para que el borrado viaje entre dispositivos). */
  | { kind: "upsert_tombstone"; payload: unknown };

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
  const { user } = useAuth();
  const userId = user?.id;
  const storageKey = userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;

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

  // La carga desde localStorage se difiere (post-paint) para no ejecutar setState
  // síncrono dentro del efecto y para no romper la hidratación.
  useEffect(() => {
    let activo = true;
    const raf = requestAnimationFrame(() => {
      if (!activo) return;
      setState(cargarEstadoGuardado(storageKey));
      pendientesRef.current = leerPendientes(clavePendientes(userId)); // P1.5
      setEstadoCargado(true);
    });
    return () => {
      activo = false;
      cancelAnimationFrame(raf);
    };
  }, [storageKey, userId]);

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
        } else if (op.kind === "delete_push") {
          const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", op.endpoint);
          if (error) restantes.push(op);
        } else if (op.kind === "upsert_tombstone") {
          // P2.6
          const { error } = await supabase.from("deleted_habits").upsert(op.payload as { user_id: string; habit_id: string });
          if (error) restantes.push(op);
        }
      } catch {
        restantes.push(op);
      }
    }
    pendientesRef.current = restantes;
    guardarPendientes(clavePendientes(userId), restantes); // P1.5
    sincronizandoRef.current = false;
  }, [userId]);

  /**
   * Descarga los datos del usuario desde Supabase y hace merge bidireccional:
   *  - Los pendientes off-line se reenvían primero para no pisar cambios sin subir.
   *  - Los habits/completions del servidor se fusionan con los locales (por id / event_id).
   *
   * P0.1: useCallback con deps [userId, reenviarPendientes] — identidad estable, así
   * el efecto que la invoca no se re-dispara en loop. El merge vive dentro del updater
   * funcional (cierra la condición de carrera: un tap durante el SELECT no se pierde)
   * y solo actualiza el estado si hubo cambios reales.
   */
  const rehidratar = useCallback(async (): Promise<void> => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;

    // 1. Reenviar pendientes acumulados off-line antes de descargar.
    await reenviarPendientes();

    try {
      // P1.6: PostgREST pagina/trunca en 1000 filas por defecto; recorrer por páginas.
      const PAGE = 1000;
      const habitsRows: RemoteHabitRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("habits")
          .select("id, data, updated_at")
          .range(from, from + PAGE - 1);
        if (error) {
          if (!esErrorRed(error)) console.error("Error descargando habits:", error.message);
          return;
        }
        habitsRows.push(...((data ?? []) as RemoteHabitRow[]));
        if (!data || data.length < PAGE) break;
      }

      // 3. Traer completions del servidor (también paginado).
      const compRows: RemoteCompletionRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("completions")
          .select("event_id, habit_id, moment_id, fecha, subtareas_completadas, created_at")
          .range(from, from + PAGE - 1);
        if (error) {
          if (!esErrorRed(error)) console.error("Error descargando completions:", error.message);
          return;
        }
        compRows.push(...((data ?? []) as RemoteCompletionRow[]));
        if (!data || data.length < PAGE) break;
      }

      // 4. P2.6: tombstones de borrados (propagan deletes entre dispositivos).
      const borrados = new Set<string>();
      const { data: tombRows, error: tError } = await supabase.from("deleted_habits").select("habit_id");
      if (tError) {
        if (!esErrorRed(tError)) console.error("Error descargando borrados:", tError.message);
      } else {
        for (const t of tombRows ?? []) borrados.add((t as { habit_id: string }).habit_id);
      }

      setState((prev) =>
        fusionarHidratacion(
          prev,
          (habitsRows ?? []) as RemoteHabitRow[],
          (compRows ?? []) as RemoteCompletionRow[],
          borrados,
        ) ?? prev,
      );
    } catch (e) {
      if (esErrorRed(e)) return; // sin conexión: no romper
      console.error("Error durante la hidratación:", e);
    }
  }, [userId, reenviarPendientes]);

  /** Encola una operación para reintento cuando vuelva la conexión. */
  const encolar = useCallback((op: PendingOp): void => {
    pendientesRef.current = [...pendientesRef.current, op];
    guardarPendientes(clavePendientes(userId), pendientesRef.current); // P1.5
  }, [userId]);

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
        if (esErrorRed(e)) {
          encolar(op);
        } else {
          console.error(`Error sincronizando (${descripcion}):`, e);
          setErrorSync(descripcion);
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
    () => ({
      rehidratar: rehidratarFn,
      guardarHabit: (habit) => {
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
      },
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
      registrar: (habitId, momentId, fecha, subtareasCompletadas) => {
        const timestamp = new Date().toISOString();
        // P0.2: el eventId se genera UNA sola vez y viaja idéntico al estado
        // local y a Supabase (guardarraíl #1).
        const eventId = construirEventId(habitId, momentId, fecha);
        setState((s) => registrarCumplimiento(s, habitId, momentId, fecha, timestamp, subtareasCompletadas, eventId));
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
        }
        logEvent("COMPLETION_REGISTERED", "completion", eventId, { habitId, momentId, fecha, subtareasCompletadas });
      },
      deshacer: (event) => {
        setState((s) => deshacerCumplimiento(s, event.eventId));
        const supabase = getSupabase();
        if (supabase && userId) {
          void sincronizar(
            { kind: "delete_completion", event_id: event.eventId },
            () => supabase.from("completions").delete().eq("event_id", event.eventId).eq("user_id", userId).then((r) => ({ error: r.error })),
            "deshacer cumplimiento",
          );
        }
        logEvent("COMPLETION_UNDONE", "completion", event.eventId, { habitId: event.habitId, fecha: event.fecha });
      },
    }),
    [userId, sincronizar, rehidratarFn],
  );

  // Rehidratar al iniciar sesión (cambio de usuario) y al volver a estar online.
  useEffect(() => {
    if (!userId || !estadoCargado) return;
    // setTimeout corto para que el primer render local no parpadee.
    const t = setTimeout(() => void rehidratar(), 50);
    return () => clearTimeout(t);
  }, [userId, estadoCargado, rehidratar]);

  // Reenviar cola pendiente cuando vuelve la conexión.
  useEffect(() => {
    if (!userId) return;
    const onOnline = () => void reenviarPendientes();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
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
