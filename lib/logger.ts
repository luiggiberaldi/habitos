import { supabase, getAnonUserId } from "./supabase";

export type LogAction =
  | "HABIT_CREATED"
  | "HABIT_UPDATED"
  | "HABIT_DELETED"
  | "COMPLETION_REGISTERED"
  | "COMPLETION_UNDONE"
  | "SUBTASK_CHECKED"
  | "SETTINGS_UPDATED";

export type LogEntityType = "habit" | "completion" | "settings" | "subtask";

export async function logEvent(
  action: LogAction,
  entityType: LogEntityType,
  entityId: string | null,
  payload: Record<string, unknown> | null,
): Promise<void> {
  try {
    const userId = getAnonUserId();
    await supabase.from("activity_log").insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      payload,
    });
  } catch {
    // Silencioso: el log no debe romper la app
  }
}
