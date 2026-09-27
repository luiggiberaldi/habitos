import { getSupabase, getSessionUser } from "./supabase";
import { claveColaLog, leerPerfilActivoId } from "./perfiles";

export type LogAction =
  // Hábitos
  | "HABIT_CREATED"
  | "HABIT_UPDATED"
  | "HABIT_DELETED"
  | "HABIT_SNOOZED"
  | "HABIT_UNSNOOZED"
  | "HABITS_PAUSED"
  | "HABITS_RESUMED"
  // Cumplimientos
  | "COMPLETION_REGISTERED"
  | "COMPLETION_UNDONE"
  | "SUBTASK_CHECKED"
  // Juego
  | "XP_GAINED"
  | "XP_LOST"
  | "XP_REVERTED"
  | "LEVEL_UP"
  | "ACHIEVEMENT_UNLOCKED"
  | "ACHIEVEMENT_CLAIMED"
  | "CHEST_OPENED"
  | "FREEZER_EARNED"
  | "FREEZER_USED"
  | "CHALLENGE_COMPLETED"
  // Sueño
  | "SUENO_REGISTRADO"
  | "SUENO_FALLO"
  | "SUENO_NOCHE_COMPLETA"
  // Liga
  | "LEAGUE_CREATED"
  | "LEAGUE_JOINED"
  | "LEAGUE_LEFT"
  // Push
  | "PUSH_SUBSCRIBED"
  | "PUSH_UNSUBSCRIBED"
  // Perfiles locales
  | "PERFIL_CREATED"
  | "PERFIL_ACTIVADO"
  | "PERFIL_ACTUALIZADO"
  | "PERFIL_ELIMINADO"
  | "MODO_CAMBIADO"
  // Ajustes / app
  | "SETTINGS_UPDATED"
  | "APP_OPENED"
  | "APP_RESET"
  | "APP_UPDATED"
  | "ONLINE"
  | "OFFLINE"
  // Navegación
  | "PAGE_VIEWED"
  // Sincronización
  | "SYNC_COMPLETED"
  | "SYNC_ERROR";

export type LogEntityType =
  | "habit"
  | "completion"
  | "settings"
  | "subtask"
  | "juego"
  | "liga"
  | "push"
  | "perfil"
  | "navegacion"
  | "sync"
  | "app";

interface LogRow {
  action: LogAction;
  entity_type: LogEntityType;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  /** Marca local para ordenar; no viaja a la tabla. */
  ts: number;
}

/**
 * Auditoría milimétrica de la app.
 *
 * Diseño:
 * - `logEvent` es fire-and-forget a propósito: la acción del usuario ya
 *   ocurrió; si el insert falla (red, RLS) no se reintenta en caliente ni se
 *   surfacea. Los callers lo invocan sin await.
 * - PERO nada se pierde: cada evento se añade primero a una cola en
 *   localStorage (tope 500, se descarta lo más antiguo) y `flushLog` intenta
 *   subirla. El flush se dispara en cada evento, al abrir la app y al
 *   recuperar conexión.
 * - División por identidad: con perfil local activo, la cola es
 *   `habitos-log-queue-v1:perfil:<id>` y NO se sube a la nube (los datos del
 *   perfil viven solo en el dispositivo); con cuenta Supabase, la cola es por
 *   userId y sí se inserta en `activity_log`.
 * - Telemetría, no estado: si algún día el log se vuelve crítico, hay que
 *   encolarlo como PendingOp en vez de tragar el error aquí.
 */

const MAX_QUEUE = 500;

/** Sufijo de ámbito para la cola: perfil local o userId de la nube. */
async function sufijoCola(): Promise<{ sufijo: string; nubeUserId: string | null } | null> {
  if (typeof window === "undefined") return null;
  const perfilId = leerPerfilActivoId();
  if (perfilId) return { sufijo: `perfil:${perfilId}`, nubeUserId: null };
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await getSessionUser().catch(() => null);
  if (!user) return null;
  return { sufijo: user.id, nubeUserId: user.id };
}

function leerCola(sufijo: string): LogRow[] {
  try {
    const raw = window.localStorage.getItem(claveColaLog(sufijo));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LogRow[]) : [];
  } catch {
    return [];
  }
}

function guardarCola(sufijo: string, rows: LogRow[]): void {
  try {
    window.localStorage.setItem(claveColaLog(sufijo), JSON.stringify(rows.slice(-MAX_QUEUE)));
  } catch {
    /* almacenamiento no disponible: el evento se pierde, la app sigue */
  }
}

export function logEvent(
  action: LogAction,
  entityType: LogEntityType,
  entityId: string | null,
  payload: Record<string, unknown> | null,
  /** Sufijo de ámbito explícito (p. ej. `perfil:<id>`); si se omite se resuelve la identidad activa. */
  ambitoForzado?: string,
): void {
  // Fire-and-forget: nunca bloquear ni romper al caller.
  void (async () => {
    try {
      const id = ambitoForzado
        ? { sufijo: ambitoForzado, nubeUserId: null as string | null }
        : await sufijoCola();
      if (!id) return;
      const cola = leerCola(id.sufijo);
      cola.push({ action, entity_type: entityType, entity_id: entityId, payload, ts: Date.now() });
      guardarCola(id.sufijo, cola);
      // Solo la nube sube al activity_log; el perfil local queda en el dispositivo.
      if (id.nubeUserId) await flushLog();
    } catch {
      /* silencioso: el log no debe romper la app */
    }
  })();
}

let flushing = false;

/** Sube la cola pendiente de eventos (solo modo cuenta). Se llama en cada evento, al abrir la app y al volver la conexión. */
export async function flushLog(): Promise<void> {
  if (flushing || typeof window === "undefined") return;
  // En modo perfil local no hay a dónde subir: la cola queda en el dispositivo.
  if (leerPerfilActivoId()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  flushing = true;
  try {
    const user = await getSessionUser().catch(() => null);
    if (!user) return;
    const cola = leerCola(user.id);
    if (cola.length === 0) return;
    // Orden cronológico; la tabla pone created_at, el orden de inserción
    // preserva la secuencia dentro del lote.
    cola.sort((a, b) => a.ts - b.ts);
    const { error } = await supabase.from("activity_log").insert(
      cola.map((r) => ({
        user_id: user.id,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        payload: r.payload,
      })),
    );
    if (!error) {
      try {
        window.localStorage.removeItem(claveColaLog(user.id));
      } catch {
        /* noop */
      }
    }
    // Si falló, la cola queda intacta para el próximo flush.
  } catch {
    /* silencioso */
  } finally {
    flushing = false;
  }
}
