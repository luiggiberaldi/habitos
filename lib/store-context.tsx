"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const [pendientesVersion, setPendientesVersion] = useState(0);

  /**
   * Descarga los datos del usuario desde Supabase y hace merge bidireccional:
   *  - Los habits/completions del servidor se fusionan con los locales (por id / event_id).
   *  - Los pendientes off-line se reenvían primero para no pisar cambios sin subir.
   */
  const rehidratar = useMemo(
    () => async (): Promise<void> => {
      const supabase = getSupabase();
      if (!supabase || !userId) return;

      // 1. Reenviar pendientes acumulados off-line antes de descargar.
      await reenviarPendientes();

      try {
        // 2. Traer habits del servidor.
        const { data: habitsRows, error: hError } = await supabase
          .from("habits")
          .select("id, data, updated_at");
        if (hError && !esErrorRed(hError)) console.error("Error descargando habits:", hError.message);
        if (hError) return;

        const remotosHabits = (habitsRows ?? []).filter((r: { data?: unknown }) => r.data).map((r: { id: string; data: Habit }) => r.data as Habit);
        const localesHabits = state.habits;
        const localById = new Map(localesHabits.map((h) => [h.id, h]));
        const mergedHabits = remotosHabits.map((r) => {
          const local = localById.get(r.id);
          // Gana la versión local si existe (el cliente es la fuente de verdad más reciente).
          return local ?? r;
        });
        for (const h of localesHabits) {
          if (!mergedHabits.some((m) => m.id === h.id)) mergedHabits.push(h);
        }

        // 3. Traer completions del servidor.
        const { data: compRows, error: cError } = await supabase
          .from("completions")
          .select("event_id, habit_id, moment_id, fecha, subtareas_completadas");
        if (cError && !esErrorRed(cError)) console.error("Error descargando completions:", cError.message);

        const remotosCompletions: CompletionEvent[] = (compRows ?? []).map((r: { event_id: string; habit_id: string; moment_id: string | null; fecha: string; subtareas_completadas: string[] | null }) => ({
          id: r.event_id,
          habitId: r.habit_id,
          momentId: r.moment_id ?? undefined,
          fecha: r.fecha,
          timestamp: "",
          eventId: r.event_id,
          subtareasCompletadas: r.subtareas_completadas ?? [],
        }));

        const localesCompletions = state.completions;
        const localByEvent = new Map(localesCompletions.map((c) => [c.eventId, c]));
        const mergedCompletions = remotosCompletions.filter((r) => !localByEvent.has(r.eventId));
        for (const c of localesCompletions) mergedCompletions.push(c);

        setState((s) =>
          normalizarEstado({
            ...s,
            habits: mergedHabits,
            completions: mergedCompletions,
          }),
        );
      } catch (e) {
        if (esErrorRed(e)) return; // sin conexión: no romper
        console.error("Error durante la hidratación:", e);
      }
    },
    [userId, state.habits, state.completions],
  );

  /** Reenvía la cola de operaciones pendientes (off-line queue) a Supabase. */
  const reenviarPendientes = useMemo(
    () => async (): Promise<void> => {
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
      setPendientesVersion((v) => v + 1);
    },
    [userId],
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
          supabase.from("habits").upsert(payload).then(() => {}, (e: unknown) => {
            if (esErrorRed(e)) {
              pendientesRef.current = [...pendientesRef.current, { kind: "upsert_habit", payload }];
              guardarPendientes(pendientesRef.current);
              setPendientesVersion((v) => v + 1);
            } else {
              console.error("Error sincronizando hábito:", e);
            }
          });
        }
        logEvent(esNuevo ? "HABIT_CREATED" : "HABIT_UPDATED", "habit", habit.id, { nombre: habit.nombre, categoria: habit.categoria });
      },
      eliminarHabit: (id) => {
        setState((s) => eliminarHabit(s, id));
        const supabase = getSupabase();
        if (supabase && userId) {
          // Filtra también por user_id para respetar Row Level Security.
          supabase.from("habits").delete().eq("id", id).eq("user_id", userId).then(() => {}, (e: unknown) => {
            if (esErrorRed(e)) {
              pendientesRef.current = [...pendientesRef.current, { kind: "delete_habit", id }];
              guardarPendientes(pendientesRef.current);
              setPendientesVersion((v) => v + 1);
            }
          });
        }
        logEvent("HABIT_DELETED", "habit", id, null);
      },
      guardarSettings: (settings) => {
        setState((s) => actualizarSettings(s, settings));
        logEvent("SETTINGS_UPDATED", "settings", null, settings as unknown as Record<string, unknown>);
      },
      registrar: (habitId, momentId, fecha, subtareasCompletadas) => {
        const timestamp = new Date().toISOString();
        setState((s) => registrarCumplimiento(s, habitId, momentId, fecha, timestamp));
        const eventId = `${habitId}|${momentId ?? "cantidad"}|${fecha}`;
        const supabase = getSupabase();
        if (supabase && userId) {
          const payload = {
            event_id: eventId,
            user_id: userId,
            habit_id: habitId,
            moment_id: momentId,
            fecha,
            subtareas_completadas: subtareasCompletadas ?? [],
          };
          supabase.from("completions").upsert(payload).then(() => {}, (e: unknown) => {
            if (esErrorRed(e)) {
              pendientesRef.current = [...pendientesRef.current, { kind: "upsert_completion", payload }];
              guardarPendientes(pendientesRef.current);
              setPendientesVersion((v) => v + 1);
            }
          });
        }
        logEvent("COMPLETION_REGISTERED", "completion", eventId, { habitId, momentId, fecha, subtareasCompletadas });
      },
      deshacer: (event) => {
        setState((s) => deshacerCumplimiento(s, event.eventId));
        const supabase = getSupabase();
        if (supabase && userId) {
          supabase.from("completions").delete().eq("event_id", event.eventId).eq("user_id", userId).then(() => {}, (e: unknown) => {
            if (esErrorRed(e)) {
              pendientesRef.current = [...pendientesRef.current, { kind: "delete_completion", event_id: event.eventId }];
              guardarPendientes(pendientesRef.current);
              setPendientesVersion((v) => v + 1);
            }
          });
        }
        logEvent("COMPLETION_UNDONE", "completion", event.eventId, { habitId: event.habitId, fecha: event.fecha });
      },
    }),
    [state, userId, rehidratar, reenviarPendientes, pendientesVersion],
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
