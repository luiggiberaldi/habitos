// lib/core/hogar.ts — Hogar compartido de Senda (Fase 0).
//
// El hogar es la unidad de datos compartidos (Finanzas, Mercado). Un usuario
// pertenece a un solo hogar. Toda lectura/escritura pasa por los RPC
// SECURITY DEFINER de la migración 0016 (el cliente nunca toca las tablas).
// La invitación es por correo: si la cuenta existe entra directo; si no, la
// app ofrece crearla vía la Edge Function crear-usuario y reintenta.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MiembroHogar {
  user_id: string;
  email: string;
  rol: "admin" | "miembro";
  es_yo: boolean;
  creado: string;
}

export interface MiHogar {
  id: string;
  nombre: string;
  creado_por: string;
  soy_admin: boolean;
  miembros: MiembroHogar[];
}

/** Códigos de error que lanzan los RPC (raise exception 'codigo'). */
const CODIGOS: Record<string, string> = {
  no_autenticado: "Inicia sesión para gestionar tu hogar.",
  sin_hogar: "Aún no tienes un hogar creado.",
  ya_tiene_hogar: "Ya perteneces a un hogar.",
  no_admin: "Solo el administrador del hogar puede hacer eso.",
  nombre_invalido: "El nombre debe tener entre 1 y 60 caracteres.",
  correo_invalido: "Ese correo no parece válido.",
  cuenta_no_existe: "CUENTA_NO_EXISTE",
  eres_tu: "Ese eres tú.",
  ya_es_miembro: "Esa persona ya es miembro del hogar.",
  no_es_miembro: "Esa persona ya no es miembro del hogar.",
  no_expulsar_admin: "No puedes expulsar a otro administrador.",
  usa_salir: "Para salir tú usa «Salir del hogar».",
};

export function mensajeErrorHogar(error: unknown): string {
  const msg = (error as { message?: string } | null)?.message ?? "";
  for (const [codigo, texto] of Object.entries(CODIGOS)) {
    if (msg.includes(codigo)) return texto;
  }
  return "No se pudo completar la acción. Inténtalo de nuevo.";
}

/** true si el error fue cuenta_no_existe (para ofrecer crear la cuenta). */
export function esCuentaNoExiste(error: unknown): boolean {
  return ((error as { message?: string } | null)?.message ?? "").includes("cuenta_no_existe");
}

function exigirCliente(supabase: SupabaseClient | null): SupabaseClient {
  if (!supabase) throw new Error("Sin conexión con la nube.");
  return supabase;
}

export async function obtenerMiHogar(supabase: SupabaseClient | null): Promise<MiHogar | null> {
  const { data, error } = await exigirCliente(supabase).rpc("obtener_mi_hogar");
  if (error) throw new Error(mensajeErrorHogar(error));
  return (data as MiHogar | null) ?? null;
}

export async function crearHogar(supabase: SupabaseClient | null, nombre: string): Promise<string> {
  const { data, error } = await exigirCliente(supabase).rpc("crear_hogar", { p_nombre: nombre });
  if (error) throw new Error(mensajeErrorHogar(error));
  return data as string;
}

export async function renombrarHogar(supabase: SupabaseClient | null, nombre: string): Promise<void> {
  const { error } = await exigirCliente(supabase).rpc("renombrar_hogar", { p_nombre: nombre });
  if (error) throw new Error(mensajeErrorHogar(error));
}

export async function invitarAlHogar(
  supabase: SupabaseClient | null,
  email: string,
): Promise<{ user_id: string; email: string }> {
  const { data, error } = await exigirCliente(supabase).rpc("invitar_al_hogar", { p_email: email });
  if (error) {
    const e = new Error(mensajeErrorHogar(error));
    (e as { codigo?: string }).codigo = esCuentaNoExiste(error) ? "CUENTA_NO_EXISTE" : undefined;
    throw e;
  }
  return data as { user_id: string; email: string };
}

export async function expulsarDelHogar(supabase: SupabaseClient | null, userId: string): Promise<void> {
  const { error } = await exigirCliente(supabase).rpc("expulsar_del_hogar", { p_user_id: userId });
  if (error) throw new Error(mensajeErrorHogar(error));
}

export async function salirDelHogar(supabase: SupabaseClient | null): Promise<void> {
  const { error } = await exigirCliente(supabase).rpc("salir_del_hogar");
  if (error) throw new Error(mensajeErrorHogar(error));
}

/**
 * Crea una cuenta nube (solo admin, vía Edge Function crear-usuario).
 * Se usa en el flujo de invitación cuando el correo aún no tiene cuenta.
 */
export async function crearCuentaNube(
  supabase: SupabaseClient | null,
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const cliente = exigirCliente(supabase);
  const { data, error } = await cliente.functions.invoke("crear-usuario", {
    body: { accion: "crear", email, password },
  });
  if (error || !(data as { ok?: boolean })?.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (error as Error | null)?.message ?? "";
    throw new Error(msg || "No se pudo crear la cuenta.");
  }
  return { id: (data as { id: string }).id, email: (data as { email: string }).email };
}
