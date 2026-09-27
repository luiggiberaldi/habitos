import { getSupabase, getSessionUser } from "./supabase";

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
  | "XP_REVERTED"
  | "LEVEL_UP"
  | "ACHIEVEMENT_UNLOCKED"
  | "CHEST_OPENED"
  | "FREEZER_EARNED"
  | "FREEZER_USED"
  | "CHALLENGE_COMPLETED"
  // Liga
  | "LEAGUE_CREATED"
  | "LEAGUE_JOINED"
  | "LEAGUE_LEFT"
  // Push
  | "PUSH_SUBSCRIBED"
  | "PUSH_UNSUBSCRIBED"
  // Ajustes / app
  | "SETTINGS_UPDATED"
  | "APP_OPENED"
  | "APP_RESET"
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
 *   localStorage (`habitos-log-queue-v1:<userId>`, tope 500, se descarta lo
 *   más antiguo) y `flushLog` intenta subirla. El flush se dispara en cada
 *   evento, al abrir la app y al recuperar conexión. Sin sesión no hay a quién
 *   atribuir el evento: se descarta (la app exige login de todos modos).
 * - Telemetría, no estado: si algún día el log se vuelve crítico, hay que
 *   encolarlo como PendingOp en vez de tragar el error aquí.
 */

const LOG_QUEUE_KEY_BASE = "habitos-log-queue-v1";
const MAX_QUEUE = 500;

function claveCola(userId: string): string {
  return `${LOG_QUEUE_KEY_BASE}:${userId}`;
}

function leerCola(userId: string): LogRow[] {
  try {
    const raw = window.localStorage.getItem(claveCola(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LogRow[]) : [];
  } catch {
    return [];
  }
}

function guardarCola(userId: string, rows: LogRow[]): void {
  try {
    window.localStorage.setItem(claveCola(userId), JSON.stringify(rows.slice(-MAX_QUEUE)));
  } catch {
    /* almacenamiento no disponible: el evento se pierde, la app sigue */
  }
}

export function logEvent(
  action: LogAction,
  entityType: LogEntityType,
  entityId: string | null,
  payload: Record<string, unknown> | null,
): void {
  // Fire-and-forget: nunca bloquear ni romper al caller.
  void (async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      const user = await getSessionUser();
      if (!user) return;
      const cola = leerCola(user.id);
      cola.push({ action, entity_type: entityType, entity_id: entityId, payload, ts: Date.now() });
      guardarCola(user.id, cola);
      await flushLog();
    } catch {
      /* silencioso: el log no debe romper la app */
    }
  })();
}

let flushing = false;

/** Sube la cola pendiente de eventos. Se llama en cada evento, al abrir la app y al volver la conexión. */
export async function flushLog(): Promise<void> {
  if (flushing || typeof window === "undefined") return;
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
        window.localStorage.removeItem(claveCola(user.id));
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
