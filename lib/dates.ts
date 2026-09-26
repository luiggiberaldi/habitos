import type { CompletionEvent, Habit } from "./types";

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Suma días a una fecha (año nuevo incluido). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const DIAS_SEMANA = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

export function esDescanso(habit: Habit, fechaKey: string): boolean {
  const d = new Date(fechaKey + "T00:00:00");
  return !habit.dias.includes(d.getDay());
}

/** Momentos que aplican a un hábito en una fecha dada. */
export function momentosDelDia(habit: Habit, fechaKey: string) {
  if (esDescanso(habit, fechaKey)) return [];
  return habit.momentos;
}

export function completadosPara(
  habit: Habit,
  fechaKey: string,
  completions: CompletionEvent[],
): Set<string> {
  const set = new Set<string>();
  for (const c of completions) {
    if (c.habitId === habit.id && c.fecha === fechaKey) {
      set.add(c.momentId);
    }
  }
  return set;
}

export function idiomaDeVentana(ventana?: string): string {
  switch (ventana) {
    case "manana":
      return "Durante la mañana";
    case "tarde":
      return "Durante la tarde";
    case "noche":
      return "Durante la noche";
    case "cualquier":
      return "En cualquier momento";
    default:
      return ventana || "En el día";
  }
}

export function formatHoraA12(hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
