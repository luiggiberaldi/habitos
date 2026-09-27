import { getSupabase, getCachedUser, asegurarSesion } from "./supabase";
import { claveColaLog, sufijoDePerfil } from "./ambito";

/**
 * Id del perfil activo. Se lee directo de localStorage (no se importa de
 * ./perfiles para no crear un ciclo: perfiles.ts importa logEvent de aquí).
 * La clave es el contrato de lib/habitos/perfiles.ts (PERFIL_ACTIVO_KEY).
 */
function leerPerfilActivoId(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem("habitos-perfil-activo-v1");
  } catch {
    return null;
  }
}

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
  // Ajustes / app
  | "SETTINGS_UPDATED"
  | "APP_OPENED"
  | "APP_RESET"
  | "APP_UPDATED"
  | "ONLINE"
  | "OFFLINE"
  // Perfiles
  | "PERFIL_CREATED"
  | "PERFIL_UPDATED"
  | "PERFIL_DELETED"
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
  /** Perfil activo al registrar el evento (null = legado / sin perfil). */
  perfil_id: string | null;
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
 * - División por identidad: la cola es `habitos-log-queue-v1:<userId>:perfil:<perfilId>`
 *   y cada fila lleva su `perfil_id`, que se inserta en `activity_log`.
 *   flushLog barre todas las colas del usuario (incluida la legada sin perfil).
 * - Telemetría, no estado: si algún día el log se vuelve crítico, hay que
 *   encolarlo como PendingOp en vez de tragar el error aquí.
 */

const MAX_QUEUE = 500;

/** Sufijo de ámbito para la cola: userId + perfil activo (offline-first). */
async function sufijoCola(): Promise<{ sufijo: string; nubeUserId: string | null; perfilId: string | null } | null> {
  if (typeof window === "undefined") return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await getCachedUser().catch(() => null);
  if (!user) return null;
  const perfilId = leerPerfilActivoId();
  return { sufijo: sufijoDePerfil(user.id, perfilId), nubeUserId: user.id, perfilId };
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
  /** Sufijo de ámbito explícito (userId); si se omite se resuelve la identidad activa. */
  ambitoForzado?: string,
): void {
  // Fire-and-forget: nunca bloquear ni romper al caller.
  void (async () => {
    try {
      // El sufijo forzado ya codifica el perfil (`<userId>:perfil:<perfilId>`);
      // se deriva para que la fila lleve su perfil_id aunque no haya perfil activo.
      const perfilForzado = ambitoForzado?.includes(":perfil:")
        ? (ambitoForzado.split(":perfil:")[1] || null)
        : null;
      const id = ambitoForzado
        ? { sufijo: ambitoForzado, nubeUserId: null as string | null, perfilId: perfilForzado }
        : await sufijoCola();
      if (!id) return;
      const cola = leerCola(id.sufijo);
      cola.push({ action, entity_type: entityType, entity_id: entityId, payload, perfil_id: id.perfilId, ts: Date.now() });
      guardarCola(id.sufijo, cola);
      // La cola siempre pertenece a la identidad única y se sube al activity_log.
      if (id.nubeUserId) await flushLog();
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
    // Token fresco antes de subir (si venció offline, se refresca aquí).
    await asegurarSesion();
    const user = await getCachedUser().catch(() => null);
    if (!user) return;
    // Barrer todas las colas del usuario: la del perfil activo, las de otros
    // perfiles del mismo aparato y la legada (sufijo = userId, sin perfil).
    const prefijo = `habitos-log-queue-v1:${user.id}`;
    const sufijos = new Set<string>();
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefijo)) sufijos.add(k.slice("habitos-log-queue-v1:".length));
      }
    } catch {
      /* noop */
    }
    for (const sufijo of sufijos) {
      const cola = leerCola(sufijo);
      if (cola.length === 0) continue;
      // Orden cronológico; la tabla pone created_at, el orden de inserción
      // preserva la secuencia dentro del lote.
      cola.sort((a, b) => a.ts - b.ts);
      const { error } = await supabase.from("activity_log").insert(
        cola.map((r) => ({
          user_id: user.id,
          perfil_id: r.perfil_id,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          payload: r.payload,
        })),
      );
      if (!error) {
        try {
          window.localStorage.removeItem(claveColaLog(sufijo));
        } catch {
          /* noop */
        }
      }
      // Si falló, la cola queda intacta para el próximo flush.
    }
  } catch {
    /* silencioso */
  } finally {
    flushing = false;
  }
}
