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
import { getSupabase } from "./supabase";
import { useAuth } from "../components/AuthGate";
import { logEvent } from "./logger";

const PENDING_KEY = "habitos-pending-sync-v1";

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

const StoreContext = createContext<StoreContextValue | null>(null);

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
  | { kind: "delete_push"; endpoint: string };

function leerPendientes(): PendingOp[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function guardarPendientes(ops: PendingOp[]): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(ops.slice(-200)));
  } catch {
    /* almacenamiento no disponible */
  }
}

interface RemoteHabitRow {
  id: string;
  data: unknown;
}

interface RemoteCompletionRow {
  event_id: string;
  habit_id: string;
  moment_id: string | null;
  fecha: string;
  subtareas_completadas: string[] | null;
}

/**
 * Merge puro local+remoto. Devuelve el estado fusionado, o `null` si no hubo
 * ningún cambio — el caller conserva entonces la referencia anterior, lo que
 * evita re-renders y re-ejecuciones de efectos (clave para P0.1).
 *
 * Estrategia actual: gana la versión local si el hábito existe (P1.3 la cambiará
 * a last-write-wins con updated_at). Los completions se unen por eventId. Las
 * filas legacy colapsadas de cantidad (bug P0.2: `habitId|cantidad|fecha` sin
 * sufijo de unicidad) se conservan como un único registro: representan actividad
 * real de ese día; los ids nuevos nunca colisionan con ellas.
 */
function fusionarHidratacion(
  prev: AppState,
  habitsRows: RemoteHabitRow[],
  compRows: RemoteCompletionRow[],
): AppState | null {
  const remotosHabits = habitsRows.filter((r) => r.data).map((r) => r.data as Habit);
  const localById = new Map(prev.habits.map((h) => [h.id, h]));
  const mergedHabits = remotosHabits.map((r) => localById.get(r.id) ?? r);
  for (const h of prev.habits) {
    if (!mergedHabits.some((m) => m.id === h.id)) mergedHabits.push(h);
  }

  const remotosCompletions: CompletionEvent[] = compRows.map((r) => ({
    id: r.event_id,
    habitId: r.habit_id,
    momentId: r.moment_id ?? undefined,
    fecha: r.fecha,
    timestamp: "",
    eventId: r.event_id,
    subtareasCompletadas: r.subtareas_completadas ?? [],
  }));
  const localByEvent = new Map(prev.completions.map((c) => [c.eventId, c]));
  const mergedCompletions = remotosCompletions.filter((r) => !localByEvent.has(r.eventId));
  for (const c of prev.completions) mergedCompletions.push(c);

  // Sin cambios de contenido → conservar la referencia anterior.
  const mismosHabits =
    mergedHabits.length === prev.habits.length && mergedHabits.every((h) => localById.has(h.id));
  const mismosCompletions =
    mergedCompletions.length === prev.completions.length &&
    mergedCompletions.every((c) => localByEvent.has(c.eventId));
  if (mismosHabits && mismosCompletions) return null;

  return normalizarEstado({ ...prev, habits: mergedHabits, completions: mergedCompletions });
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

  // La carga desde localStorage se difiere (post-paint) para no ejecutar setState
  // síncrono dentro del efecto y para no romper la hidratación.
  useEffect(() => {
    let activo = true;
    const raf = requestAnimationFrame(() => {
      if (!activo) return;
      setState(cargarEstadoGuardado(storageKey));
      pendientesRef.current = leerPendientes();
      setEstadoCargado(true);
    });
    return () => {
      activo = false;
      cancelAnimationFrame(raf);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!estadoCargado) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* almacenamiento no disponible */
    }
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
        }
      } catch {
        restantes.push(op);
      }
    }
    pendientesRef.current = restantes;
    guardarPendientes(restantes);
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
      // 2. Traer habits del servidor (RLS confina al usuario).
      const { data: habitsRows, error: hError } = await supabase
        .from("habits")
        .select("id, data, updated_at");
      if (hError) {
        if (!esErrorRed(hError)) console.error("Error descargando habits:", hError.message);
        return;
      }

      // 3. Traer completions del servidor.
      const { data: compRows, error: cError } = await supabase
        .from("completions")
        .select("event_id, habit_id, moment_id, fecha, subtareas_completadas");
      if (cError) {
        if (!esErrorRed(cError)) console.error("Error descargando completions:", cError.message);
        return;
      }

      setState((prev) =>
        fusionarHidratacion(
          prev,
          (habitsRows ?? []) as RemoteHabitRow[],
          (compRows ?? []) as RemoteCompletionRow[],
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
    guardarPendientes(pendientesRef.current);
  }, []);

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

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      rehidratar,
      guardarHabit: (habit) => {
        const esNuevo = !state.habits.some((h) => h.id === habit.id);
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
      errorSync,
    }),
    [state, userId, rehidratar, sincronizar, errorSync],
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

  // Registro de satisfacción: rehidratar usa reenviarPendientes; exponer igual.
  const rehidratarFn = useMemo(() => async () => {
    await reenviarPendientes();
    await rehidratar();
  }, [reenviarPendientes, rehidratar]);

  return <StoreContext.Provider value={{ ...value, rehidratar: rehidratarFn }}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de <StoreProvider>");
  return ctx;
}
