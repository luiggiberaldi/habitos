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
  // Aplazamiento puntual: no aplica antes de la fecha destino, sí aplica ese día.
  if (habit.pospuestoHasta) {
    if (habit.pospuestoHasta === fechaKey) return false;
    if (habit.pospuestoHasta > fechaKey) return true;
  }
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
  const esCantidad = habit.tipo === "cantidad";
  for (const c of completions) {
    if (c.habitId === habit.id && c.fecha === fechaKey) {
      // Para cantidad cada registro es un evento único; para momentos el id por momento+fecha.
      set.add(esCantidad ? c.eventId : c.momentId ?? c.eventId);
    }
  }
  return set;
}

/** Lunes de la semana de una fecha (YYYY-MM-DD). Ligas y desafíos reinician los lunes. */
export function inicioSemana(fechaKey: string): string {
  const d = new Date(`${fechaKey}T12:00:00`);
  const diasDesdeLunes = (d.getDay() + 6) % 7; // getDay: 0=domingo
  return todayKey(addDays(d, -diasDesdeLunes));
}

export function idiomaDeVentana(ventana?: string): string {  switch (ventana) {
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

/** "HH:mm" (24h) en hora local para un Date. */
export function hhmmDeFecha(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "HH:mm" en hora local extraída de un timestamp ISO. */
export function hhmmDeTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "00:00";
  return hhmmDeFecha(d);
}

/**
 * Construye un timestamp ISO para una fecha (YYYY-MM-DD) + hora ("HH:mm")
 * interpretadas en la zona horaria local del dispositivo.
 */
export function timestampLocal(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).toISOString();
}

/** Mueve una fecha YYYY-MM-DD N días (negativo = hacia atrás). */
export function moverFecha(fechaKey: string, dias: number): string {
  return todayKey(addDays(new Date(`${fechaKey}T12:00:00`), dias));
}
