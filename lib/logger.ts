import { getSupabase, getSessionUser } from "./supabase";

export type LogAction =
  | "HABIT_CREATED"
  | "HABIT_UPDATED"
  | "HABIT_DELETED"
  | "COMPLETION_REGISTERED"
  | "COMPLETION_UNDONE"
  | "SUBTASK_CHECKED"
  | "SETTINGS_UPDATED";

export type LogEntityType = "habit" | "completion" | "settings" | "subtask";

/**
 * E5 (decisión de diseño, antes P3.7): logEvent es fire-and-forget a propósito.
 * El activity_log es telemetría, no estado: si el insert falla (red, RLS), la
 * acción del usuario ya ocurrió y no se reintenta ni se surfacea. Los callers lo
 * invocan sin await. Si algún día el log se vuelve crítico, hay que encolarlo
 * como PendingOp en vez de tragar el error aquí.
 */
export async function logEvent(
  action: LogAction,
  entityType: LogEntityType,
  entityId: string | null,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const user = await getSessionUser();
    if (!user) return;
    await supabase.from("activity_log").insert({
      user_id: user.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      payload,
    });
  } catch {
    // Silencioso: el log no debe romper la app
  }
}
