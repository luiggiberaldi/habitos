// lib/event-id.ts — ÚNICA fuente de verdad para los eventId de completions.
//
// Guardarraíl #1 del plan maestro: un evento = un id generado UNA SOLA VEZ.
// El mismo valor viaja al estado local, a Supabase y a la cola offline.
// Nunca derivar dos ids distintos para el mismo evento.

/**
 * Id determinista para hábitos por momento: `${habitId}|${momentId}|${fecha}`.
 * Al ser determinista, reintentar el mismo tap es idempotente (toggle).
 */
export function eventIdMomento(habitId: string, momentId: string, fecha: string): string {
  return `${habitId}|${momentId}|${fecha}`;
}

/**
 * Id único por marca para hábitos de cantidad.
 * Cada tap es un registro propio: `${habitId}|cantidad|${fecha}|${Date.now()}-${rand}`.
 * El sufijo `|cantidad|` (sin momentId) distingue el formato legacy colapsado
 * `${habitId}|cantidad|${fecha}` que generaba el bug P0.2: esos ids legacy se
 * reconocen por NO tener el sufijo de unicidad.
 */
export function eventIdCantidad(habitId: string, fecha: string): string {
  return `${habitId}|cantidad|${fecha}|${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Genera el eventId apropiado según el tipo de marca.
 * LLAMAR UNA SOLA VEZ POR EVENTO y reutilizar el valor en todos los destinos.
 */
export function construirEventId(habitId: string, momentId: string | undefined, fecha: string): string {
  return momentId ? eventIdMomento(habitId, momentId, fecha) : eventIdCantidad(habitId, fecha);
}

/**
 * Detecta un eventId legacy del bug P0.2: filas remotas `habitId|cantidad|fecha`
 * sin sufijo de unicidad (el upsert colapsaba todos los taps del día en una fila).
 * Solo aplica a hábitos tipo "cantidad"; un hábito por momento podría tener
 * legítimamente un momentId llamado "cantidad".
 */
export function esEventIdCantidadLegacy(eventId: string, habitId: string): boolean {
  const prefijo = `${habitId}|cantidad|`;
  if (!eventId.startsWith(prefijo)) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(eventId.slice(prefijo.length));
}
