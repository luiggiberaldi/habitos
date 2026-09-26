import type { AppState, CompletionEvent, Habit } from "./types";
import { normalizarEstado } from "./store";

export interface RemoteHabitRow {
  id: string;
  data: unknown;
  /** P1.3: updated_at de la fila para last-write-wins. */
  updated_at: string | null;
}

export interface RemoteCompletionRow {
  event_id: string;
  habit_id: string;
  moment_id: string | null;
  fecha: string;
  subtareas_completadas: string[] | null;
  /** P2.4: created_at del servidor → timestamp del evento local. */
  created_at: string | null;
}

/**
 * Merge puro local+remoto. Devuelve el estado fusionado, o `null` si no hubo
 * ningún cambio — el caller conserva entonces la referencia anterior, lo que
 * evita re-renders y re-ejecuciones de efectos (clave para P0.1).
 *
 * Estrategia de conflictos (P1.3): last-write-wins por timestamp. Gana la versión
 * con `updated_at` (remoto) o `actualizadoEn` (local) mayor; en empate gana local.
 * Los completions se unen por eventId. Las filas legacy colapsadas de cantidad
 * (bug P0.2: `habitId|cantidad|fecha` sin sufijo de unicidad) se conservan como un
 * único registro: representan actividad real de ese día; los ids nuevos nunca
 * colisionan con ellas.
 * P2.6: los ids con tombstone en `borrados` ni se agregan del remoto ni se
 * conservan en local (purga del borrado hecho en otro dispositivo).
 */
export function fusionarHidratacion(
  prev: AppState,
  habitsRows: RemoteHabitRow[],
  compRows: RemoteCompletionRow[],
  borrados: Set<string> = new Set(),
): AppState | null {
  const remotosHabits = habitsRows
    .filter((r) => r.data && !borrados.has(r.id))
    .map((r) => r.data as Habit);
  const remoteTsById = new Map(habitsRows.map((r) => [r.id, r.updated_at ?? ""]));
  const localById = new Map(prev.habits.map((h) => [h.id, h]));
  const mergedHabits = remotosHabits.map((r) => {
    const local = localById.get(r.id);
    if (!local) return r;
    // P1.3 last-write-wins: compara ISO strings (orden lexicográfico = cronológico).
    const remoteTs = remoteTsById.get(r.id) ?? "";
    const localTs = local.actualizadoEn ?? local.creadoEn ?? "";
    if (remoteTs > localTs) {
      // D4: ganó el remoto — refrescar la marca LWW local desde updated_at del
      // servidor para no mezclar relojes (cliente vs servidor) en la próxima ronda.
      return { ...r, actualizadoEn: remoteTs };
    }
    return local;
  });
  for (const h of prev.habits) {
    if (borrados.has(h.id)) continue; // P2.6: purga local del borrado en otro dispositivo.
    if (!mergedHabits.some((m) => m.id === h.id)) mergedHabits.push(h);
  }

  // D2: las completions cuyo hábito ya no existe (borrado en otro dispositivo
  // o filas huérfanas de borrados viejos) no reaparecen.
  const habitIds = new Set(mergedHabits.map((h) => h.id));
  const remotosCompletions: CompletionEvent[] = compRows
    .filter((r) => habitIds.has(r.habit_id))
    .map((r) => ({
      id: r.event_id,
      habitId: r.habit_id,
      momentId: r.moment_id ?? undefined,
      fecha: r.fecha,
      timestamp: r.created_at ?? "", // P2.4
      eventId: r.event_id,
      subtareasCompletadas: r.subtareas_completadas ?? [],
    }));
  const localByEvent = new Map(prev.completions.map((c) => [c.eventId, c]));
  const mergedCompletions = remotosCompletions.filter((r) => !localByEvent.has(r.eventId));
  // D6: purga local de completions huérfanas — su hábito ya no existe en el
  // estado fusionado (borrado en otro dispositivo o demo duplicado podado).
  // Sin esto, los registros de demos eliminados quedan flotando en el
  // localStorage para siempre (no suman XP porque puntosTotalesParaFecha
  // filtra por hábitos existentes, pero ensucian el estado).
  for (const c of prev.completions) {
    if (habitIds.has(c.habitId)) mergedCompletions.push(c);
  }

  // Sin cambios de contenido → conservar la referencia anterior.
  // P1.3: comparar por IDENTIDAD (===), no por id — con last-write-wins el
  // remoto puede ganar con el mismo id y el contenido sí cambió.
  const mismosHabits =
    mergedHabits.length === prev.habits.length && mergedHabits.every((h) => localById.get(h.id) === h);
  const mismosCompletions =
    mergedCompletions.length === prev.completions.length &&
    mergedCompletions.every((c) => localByEvent.has(c.eventId));
  if (mismosHabits && mismosCompletions) return null;

  return normalizarEstado({ ...prev, habits: mergedHabits, completions: mergedCompletions });
}
