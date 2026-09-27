import type { AnclaSueno, CompletionEvent, Habit } from "./types";
import { formatHoraA12, hhmmDeTimestamp } from "./dates";

/**
 * Momentos anclados al sueño: un momento de tipo "ancla" no tiene hora fija,
 * sigue la hora real de levantarse/acostarse del hábito Sueño.
 *
 * Resolución de la hora efectiva ("HH:mm"):
 * 1. La hora REAL marcada ese día (si ya se marcó levantar/acostar).
 * 2. Si no, la hora objetivo configurada en el hábito Sueño.
 * null si no hay hábito Sueño activo.
 */
export function habitoSueno(habits: Habit[]): Habit | undefined {
  return habits.find((h) => h.tipo === "sueno" && h.estado === "activo");
}

export function horaAncla(
  habits: Habit[],
  completions: CompletionEvent[],
  ancla: AnclaSueno,
  fecha: string,
): string | null {
  const sueno = habitoSueno(habits);
  if (!sueno) return null;
  const marca = completions.find(
    (c) => c.habitId === sueno.id && c.momentId === ancla && c.fecha === fecha,
  );
  if (marca) return hhmmDeTimestamp(marca.timestamp);
  return ancla === "levantar"
    ? (sueno.horaLevantar ?? "06:00")
    : (sueno.horaAcostar ?? "22:00");
}

/** Etiqueta para la tarjeta: "Al levantarte · 6:40" (o sin hora si no hay dato). */
export function etiquetaAncla(ancla: AnclaSueno, hora: string | null): string {
  const base = ancla === "levantar" ? "Al levantarte" : "Al acostarte";
  return hora ? `${base} · ${formatHoraA12(hora)}` : base;
}

/**
 * Hábitos activos de tipo "momento" con al menos un momento anclado a `ancla`
 * que aún NO se marcó en `fecha`. Para el nudge al marcar sueño.
 */
export function habitosAnclaPendientes(
  habits: Habit[],
  completions: CompletionEvent[],
  ancla: AnclaSueno,
  fecha: string,
): Habit[] {
  return habits.filter(
    (h) =>
      h.tipo === "momento" &&
      h.estado === "activo" &&
      h.momentos.some(
        (m) =>
          m.tipo === "ancla" &&
          m.ancla === ancla &&
          !completions.some((c) => c.eventId === `${h.id}|${m.id}|${fecha}`),
      ),
  );
}
