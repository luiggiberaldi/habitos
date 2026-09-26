"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { supabase, getAnonUserId } from "./supabase";
import { logEvent } from "./logger";

interface StoreContextValue {
  state: AppState;
  guardarHabit: (habit: Habit) => void;
  eliminarHabit: (id: string) => void;
  guardarSettings: (settings: Settings) => void;
  registrar: (habitId: string, momentId: string, fecha: string, subtareasCompletadas?: string[]) => void;
  deshacer: (event: CompletionEvent) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function cargarEstadoGuardado(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizarEstado(JSON.parse(raw)) : crearEstadoInicial();
  } catch {
    return crearEstadoInicial();
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(crearEstadoInicial);
  const [estadoCargado, setEstadoCargado] = useState(false);

  useEffect(() => {
    setState(cargarEstadoGuardado());
    setEstadoCargado(true);
  }, []);

  useEffect(() => {
    if (!estadoCargado) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [state, estadoCargado]);

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      guardarHabit: (habit) => {
        const esNuevo = !state.habits.some((h) => h.id === habit.id);
        setState((s) => guardarHabit(s, habit));
        // Sync a Supabase
        const userId = getAnonUserId();
        supabase.from("habits").upsert({ id: habit.id, user_id: userId, data: habit }).then(() => {});
        // Log
        logEvent(esNuevo ? "HABIT_CREATED" : "HABIT_UPDATED", "habit", habit.id, { nombre: habit.nombre, categoria: habit.categoria });
      },
      eliminarHabit: (id) => {
        setState((s) => eliminarHabit(s, id));
        const userId = getAnonUserId();
        supabase.from("habits").delete().eq("id", id).then(() => {});
        logEvent("HABIT_DELETED", "habit", id, null);
      },
      guardarSettings: (settings) => {
        setState((s) => actualizarSettings(s, settings));
        logEvent("SETTINGS_UPDATED", "settings", null, settings as unknown as Record<string, unknown>);
      },
      registrar: (habitId, momentId, fecha, subtareasCompletadas) => {
        setState((s) => registrarCumplimiento(s, habitId, momentId, fecha));
        const eventId = `${habitId}|${momentId}|${fecha}`;
        const userId = getAnonUserId();
        supabase.from("completions").upsert({
          event_id: eventId,
          user_id: userId,
          habit_id: habitId,
          moment_id: momentId,
          fecha,
          subtareas_completadas: subtareasCompletadas ?? [],
        }).then(() => {});
        logEvent("COMPLETION_REGISTERED", "completion", eventId, { habitId, momentId, fecha, subtareasCompletadas });
      },
      deshacer: (event) => {
        setState((s) => deshacerCumplimiento(s, event.eventId));
        supabase.from("completions").delete().eq("event_id", event.eventId).then(() => {});
        logEvent("COMPLETION_UNDONE", "completion", event.eventId, { habitId: event.habitId, fecha: event.fecha });
      },
    }),
    [state],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de <StoreProvider>");
  return ctx;
}
