// lib/liga.ts — Liga semanal opt-in.
//
// Grupos pequeños de gente real que compiten por XP semanal. La evidencia
// (Stanford HCI 2021) muestra que las ligas por niveles con reinicio semanal
// superan al ranking global, que desmotiva a la mitad de abajo. Aquí cada liga
// es un grupo cerrado con código para unirse; el ranking se reinicia cada lunes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioSemana, todayKey } from "./dates";
import type { JuegoState } from "./types";

export interface MiembroLiga {
  userId: string;
  nombreVisible: string;
  /** XP de la semana en curso (0 si su dato es de una semana vieja). */
  xpSemanal: number;
  esYo: boolean;
}

export interface LigaVista {
  id: string;
  nombre: string;
  codigo: string;
  miembros: MiembroLiga[]; // ordenados por xpSemanal desc
}

/** Código de 6 caracteres sin los confusos (0/O/1/I). */
export function generarCodigoLiga(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const rand = crypto.getRandomValues(new Uint8Array(6));
  let codigo = "";
  for (const b of rand) codigo += chars[b % chars.length];
  return codigo;
}

function nombreCorto(nombre: string, defecto: string): string {
  const limpio = nombre.trim().slice(0, 30);
  return limpio || defecto;
}

async function obtenerLiga(supabase: SupabaseClient, userId: string, ligaId: string): Promise<LigaVista> {
  const semana = inicioSemana(todayKey());
  const { data: liga, error: eLiga } = await supabase
    .from("ligas")
    .select("id, nombre, codigo")
    .eq("id", ligaId)
    .single();
  if (eLiga || !liga) throw new Error("No se encontró la liga.");
  const { data: miembros } = await supabase
    .from("liga_miembros")
    .select("user_id, nombre_visible, xp_semanal, semana")
    .eq("liga_id", ligaId);
  const lista: MiembroLiga[] = ((miembros ?? []) as {
    user_id: string;
    nombre_visible: string;
    xp_semanal: number;
    semana: string;
  }[])
    .map((m) => ({
      userId: m.user_id,
      nombreVisible: m.nombre_visible,
      xpSemanal: m.semana === semana ? m.xp_semanal : 0,
      esYo: m.user_id === userId,
    }))
    .sort((a, b) => b.xpSemanal - a.xpSemanal);
  return { id: liga.id, nombre: liga.nombre, codigo: liga.codigo, miembros: lista };
}

export async function obtenerMisLigas(supabase: SupabaseClient, userId: string): Promise<LigaVista[]> {
  const { data, error } = await supabase.from("liga_miembros").select("liga_id").eq("user_id", userId);
  if (error || !data || data.length === 0) return [];
  const vistas: LigaVista[] = [];
  for (const m of data as { liga_id: string }[]) {
    vistas.push(await obtenerLiga(supabase, userId, m.liga_id));
  }
  return vistas;
}

/** Crea una liga y mete al creador como primer miembro. Reintenta el código si colisiona. */
export async function crearLiga(
  supabase: SupabaseClient,
  userId: string,
  nombre: string,
  nombreVisible: string,
): Promise<LigaVista> {
  const nombreLiga = nombreCorto(nombre, "Mi liga");
  const visible = nombreCorto(nombreVisible, "Jugador");
  for (let intento = 0; intento < 3; intento++) {
    const codigo = generarCodigoLiga();
    const { data, error } = await supabase
      .from("ligas")
      .insert({ nombre: nombreLiga, codigo, creada_por: userId })
      .select("id")
      .single();
    if (!error && data) {
      const { error: eMiembro } = await supabase
        .from("liga_miembros")
        .insert({ liga_id: (data as { id: string }).id, user_id: userId, nombre_visible: visible });
      if (eMiembro) throw new Error("No se pudo crear la liga.");
      return obtenerLiga(supabase, userId, (data as { id: string }).id);
    }
    // 23505 = código duplicado: reintentar con otro. Otro error: abortar.
    if (!error || (error as { code?: string }).code !== "23505") {
      throw new Error("No se pudo crear la liga.");
    }
  }
  throw new Error("No se pudo crear la liga.");
}

/**
 * Unirse con código vía RPC `unirse_a_liga` (security definer): así no hace
 * falta exponer el catálogo de ligas a todos los usuarios autenticados.
 */
export async function unirseALiga(
  supabase: SupabaseClient,
  userId: string,
  codigo: string,
  nombreVisible: string,
): Promise<LigaVista> {
  const limpio = codigo.trim().toUpperCase();
  if (!limpio) throw new Error("Escribe el código de la liga.");
  const { data, error } = await supabase.rpc("unirse_a_liga", {
    p_codigo: limpio,
    p_nombre: nombreCorto(nombreVisible, "Jugador"),
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "";
    throw new Error(msg.includes("codigo_invalido") ? "Código inválido." : "No se pudo unir a la liga.");
  }
  return obtenerLiga(supabase, userId, data as string);
}

export async function salirDeLiga(supabase: SupabaseClient, userId: string, ligaId: string): Promise<void> {
  const { error } = await supabase.from("liga_miembros").delete().eq("liga_id", ligaId).eq("user_id", userId);
  if (error) throw new Error("No se pudo salir de la liga.");
}

/**
 * Publica el XP semanal del usuario en todas sus ligas. No crítico: si falla,
 * se reintenta la próxima vez (al registrar o al abrir la página de liga).
 */
export async function publicarXpLiga(
  supabase: SupabaseClient,
  userId: string,
  juego: JuegoState,
): Promise<void> {
  try {
    const semana = inicioSemana(todayKey());
    const { data } = await supabase.from("liga_miembros").select("liga_id").eq("user_id", userId);
    if (!data || data.length === 0) return;
    for (const m of data as { liga_id: string }[]) {
      await supabase
        .from("liga_miembros")
        .update({ xp_semanal: juego.xpSemanal, semana, updated_at: new Date().toISOString() })
        .eq("liga_id", m.liga_id)
        .eq("user_id", userId);
    }
  } catch {
    /* la próxima vez será */
  }
}
