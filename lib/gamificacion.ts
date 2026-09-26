import type { CompletionEvent, Habit } from "./types";
import { completadosPara, esDescanso, todayKey } from "./dates";

export const PUNTOS_POR_REGISTRO = 10;
export const PUNTOS_OBJETIVO_DIARIO = 5;

export interface PuntosDiarios {
  habitId: string;
  fecha: string;
  puntos: number;
  registros: number;
}

/** Objetivo vigente en una fecha; el historial registra cortes efectivos inclusivos. */
export function objetivoEnFecha(habit: Habit, fecha: string): number {
  const cambios = [...(habit.historialObjetivos ?? [])].sort((a, b) => a.desde.localeCompare(b.desde));
  let objetivo = cambios[0]?.objetivo ?? habit.objetivo;
  for (const cambio of cambios) {
    if (cambio.desde <= fecha) objetivo = cambio.objetivo;
    else break;
  }
  return objetivo;
}

export function puntosParaFecha(habit: Habit, fecha: string, completions: CompletionEvent[]): number {
  if (esDescanso(habit, fecha)) return 0;
  const eventos = completions.filter((c) => c.habitId === habit.id && c.fecha === fecha);
  // Para cantidad cada registro cuenta individualmente; para momentos se cuentan momentos únicos.
  const ids = new Set(habit.tipo === "cantidad" ? eventos.map((c) => c.eventId) : eventos.map((c) => c.momentId));
  const objetivo = objetivoEnFecha(habit, fecha);
  return ids.size * PUNTOS_POR_REGISTRO + (objetivo > 0 && ids.size >= objetivo ? PUNTOS_OBJETIVO_DIARIO : 0);
}

export function puntosTotalesParaFecha(habits: Habit[], fecha: string, completions: CompletionEvent[]): number {
  return habits.reduce((sum, habit) => sum + puntosParaFecha(habit, fecha, completions), 0);
}

export function puntosEnRango(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): number {
  const fechas = new Set(completions.filter((c) => c.fecha >= inicio && c.fecha <= fin).map((c) => c.fecha));
  return [...fechas].reduce((sum, fecha) => sum + puntosTotalesParaFecha(habits, fecha, completions), 0);
}

export function registrosEnRango(habit: Habit, inicio: string, fin: string, completions: CompletionEvent[]): number {
  return new Set(completions.filter((c) => c.habitId === habit.id && c.fecha >= inicio && c.fecha <= fin).map((c) => c.eventId)).size;
}

export function consistenciaEnRango(habit: Habit, inicio: string, fin: string, completions: CompletionEvent[]): number {
  let programados = 0;
  let completos = 0;
  const date = new Date(`${inicio}T12:00:00`);
  const end = new Date(`${fin}T12:00:00`);
  while (date <= end) {
    const key = todayKey(date);
    if (!esDescanso(habit, key)) {
      programados++;
      if (completadosPara(habit, key, completions).size >= objetivoEnFecha(habit, key)) completos++;
    }
    date.setDate(date.getDate() + 1);
  }
  return programados ? Math.round((completos / programados) * 100) : 0;
}

export function diasActivosEnRango(_habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): string[] {
  return [...new Set(completions.filter((c) => c.fecha >= inicio && c.fecha <= fin).map((c) => c.fecha))].sort();
}

/** Días en que un hábito debería haberse completado dentro del rango (sin descansos). */
export function diasPrevistosEnRango(habit: Habit, inicio: string, fin: string): string[] {
  const dias: string[] = [];
  const date = new Date(`${inicio}T12:00:00`);
  const end = new Date(`${fin}T12:00:00`);
  while (date <= end) {
    const key = todayKey(date);
    if (!esDescanso(habit, key)) dias.push(key);
    date.setDate(date.getDate() + 1);
  }
  return dias;
}

/** Resumen semanal de registros realizados frente a la suma de objetivos diarios. */
export function resumenSemanal(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): {
  habit: Habit;
  previstos: number;
  completados: number;
}[] {
  return habits
    .filter((h) => h.estado === "activo")
    .map((habit) => {
      const fechasPrevistas = diasPrevistosEnRango(habit, inicio, fin);
      const previstos = fechasPrevistas.reduce((total, fecha) => total + objetivoEnFecha(habit, fecha), 0);
      const completados = new Set(completions
        .filter((c) => c.habitId === habit.id && c.fecha >= inicio && c.fecha <= fin)
        .map((c) => c.eventId)).size;
      return { habit, previstos, completados };
    })
    .sort((a, b) => b.completados - a.completados);
}

export interface EstadisticasHabit {
  habit: Habit;
  totalRegistros: number;
  consistencia: number;
}

export function estadisticasPorHabit(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): EstadisticasHabit[] {
  return habits.map((habit) => ({
    habit,
    totalRegistros: registrosEnRango(habit, inicio, fin, completions),
    consistencia: consistenciaEnRango(habit, inicio, fin, completions),
  })).sort((a, b) => b.consistencia - a.consistencia);
}
