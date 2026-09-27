import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Si faltan las variables de entorno, la app sigue funcionando en modo local
// (solo localStorage) sin lanzar errores ni conexiones a Supabase.
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

// Devuelve el usuario de la sesión activa (Supabase Auth) o null.
export async function getSessionUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Usuario de la sesión cacheada (no toca la red): permite arrancar la app
 * sin conexión (offline-first). Si el token venció, los writes se encolan y
 * `asegurarSesion()` lo refresca al volver la red.
 */
export async function getCachedUser(): Promise<User | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresca el token si venció o vence en <60s. Sin red falla en silencio:
 * las operaciones se encolan y se reintentan al volver la conexión.
 */
export async function asegurarSesion(): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const exp = data.session?.expires_at;
    if (data.session && exp && exp * 1000 < Date.now() + 60_000) {
      await supabase.auth.refreshSession();
    }
  } catch {
    /* sin red: nada que hacer */
  }
}
