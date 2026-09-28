/**
 * Recordatorios genéricos (Fase 0.5). CRUD directo sobre `recordatorios`
 * (RLS: cada usuario solo ve los suyos). El envío lo hace la Edge Function
 * push-notifications cada minuto.
 */
import { getSupabase } from "./supabase";

export type ReglaRecurrencia = "diaria" | "semanal" | "mensual";

export type Recordatorio = {
  id: string;
  user_id: string;
  hogar_id: string | null;
  modulo: string;
  titulo: string;
  cuerpo: string;
  programado_para: string;
  regla_recurrencia: ReglaRecurrencia | null;
  datos_json: Record<string, unknown>;
  estado: "pendiente" | "enviado" | "cancelado";
  creado_por: string | null;
  creado_en: string;
  enviado_en: string | null;
};

export type NuevoRecordatorio = {
  titulo: string;
  cuerpo?: string;
  /** ISO o Date: cuándo debe disparar. */
  programadoPara: string | Date;
  modulo?: string;
  reglaRecurrencia?: ReglaRecurrencia | null;
  datosJson?: Record<string, unknown>;
};

/** Crea un recordatorio pendiente para el usuario actual. */
export async function crearRecordatorio(
  input: NuevoRecordatorio,
): Promise<Recordatorio> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la nube");
  const { data: sesion } = await sb.auth.getSession();
  const userId = sesion.session?.user?.id;
  if (!userId) throw new Error("Sin sesión");
  const programado =
    input.programadoPara instanceof Date
      ? input.programadoPara.toISOString()
      : input.programadoPara;
  const { data, error } = await sb
    .from("recordatorios")
    .insert({
      user_id: userId,
      modulo: input.modulo ?? "sistema",
      titulo: input.titulo.trim(),
      cuerpo: input.cuerpo?.trim() ?? "",
      programado_para: programado,
      regla_recurrencia: input.reglaRecurrencia ?? null,
      datos_json: input.datosJson ?? {},
      creado_por: userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Recordatorio;
}

/** Recordatorios pendientes del usuario, ordenados por fecha. */
export async function listarPendientes(): Promise<Recordatorio[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("recordatorios")
    .select("*")
    .eq("estado", "pendiente")
    .order("programado_para", { ascending: true })
    .limit(50);
  if (error) return [];
  return (data ?? []) as Recordatorio[];
}

/** Cancela un recordatorio pendiente. */
export async function cancelarRecordatorio(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la nube");
  const { error } = await sb
    .from("recordatorios")
    .update({ estado: "cancelado" })
    .eq("id", id)
    .eq("estado", "pendiente");
  if (error) throw new Error(error.message);
}
