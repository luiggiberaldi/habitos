// lib/perfiles.ts — Perfiles en la nube, estilo Netflix.
//
// Una cuenta Supabase contiene varios perfiles. Cada perfil es un silo de
// datos completo en la nube (perfil_id en cada tabla) y en el dispositivo
// (claves `habitos-*-v1:<userId>:perfil:<id>`).
//
// Offline-first: la lista de perfiles se cachea en localStorage; crear,
// editar y entrar funcionan sin red y se sincronizan al volver la conexión.
// El PIN es una cerradura casual tipo Netflix: se guarda en la nube como
// hash SHA-256 con salt por perfil (pin_hash/pin_salt). Nunca viaja ni se
// guarda en claro. No es seguridad bancaria: 4 dígitos son fuerza bruta
// por definición; el hash solo evita exponerlo y lo hace portable.

import { getSupabase, getCachedUser } from "./supabase";
import {
  claveColaLog,
  claveEstado,
  claveNotifEnviadas,
  clavePendientes,
  clavesDeDatos,
  sufijoDePerfil,
} from "./ambito";
import { crearEstadoInicial } from "./store";
import { flushLog, logEvent } from "./logger";
import { habitoDesdePlantilla, type Plantilla } from "./plantillas";
import type { AppState } from "./types";

export interface Perfil {
  id: string;
  nombre: string;
  /** Hex del color del avatar. */
  color: string;
  /** Id de la galería de avatares (lib/avatares.ts); null = inicial con color. */
  avatar: string | null;
  /**
   * Foto personalizada (dataURL JPEG 256px, ver lib/foto.ts); null = sin foto.
   * Tiene prioridad sobre `avatar`: si hay foto, se muestra la foto.
   */
  foto: string | null;
  /**
   * Salt del PIN (hex). null = sin PIN.
   * Cerradura casual tipo Netflix, no seguridad real: es una cerradura doméstica.
   */
  pinSalt: string | null;
  /** SHA-256(salt:pin) en hex. El PIN en claro jamás se guarda ni se transmite. */
  pinHash: string | null;
  creadoEn: string;
  ultimoUso: string;
  /** true = creado sin red, pendiente de subir a la nube. */
  pendiente?: boolean;
}

export const MAX_PERFILES = 6;

/** Paleta para avatares de perfil (coherente con los colores de hábitos). */
export const COLORES_PERFIL = [
  "#F84818",
  "#F88808",
  "#F8B808",
  "#22C55E",
  "#0AA4F8",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
];

/** Filas legado sin adoptar (migración 0013). */
export const PERFIL_LEGADO = "00000000-0000-0000-0000-000000000000";

const PERFIL_ACTIVO_KEY = "habitos-perfil-activo-v1";
/** Clave vieja del PIN solo-dispositivo (se migra a la nube una sola vez). */
const PIN_KEY_VIEJO = (perfilId: string) => `habitos-pin:${perfilId}`;
const CACHE_KEY = (userId: string) => `habitos-perfiles-cache-v1:${userId}`;

/* ------------------------------ Utilidades ------------------------------ */

function leer<T>(clave: string, defecto: T): T {
  try {
    const raw = window.localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : defecto;
  } catch {
    return defecto;
  }
}

function escribir(clave: string, valor: unknown): void {
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* almacenamiento no disponible */
  }
}

function nuevoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Un PIN válido son exactamente 4 dígitos. */
export function esPinValido(pin: string | null | undefined): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/** Salt aleatorio de 16 bytes en hex. */
export function generarSaltPin(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** SHA-256(salt:pin) en hex. El PIN en claro nunca sale de este cálculo. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** ¿El perfil tiene PIN configurado? */
export function tienePin(p: Perfil): boolean {
  return !!(p.pinSalt && p.pinHash);
}

/** Verifica el intento contra el hash (sin PIN = entra directo). */
export async function verificarPin(perfil: Perfil, intento: string): Promise<boolean> {
  if (!tienePin(perfil)) return true;
  const h = await hashPin(intento, perfil.pinSalt as string);
  return h === perfil.pinHash;
}

/* --------------------------- Perfil activo y PIN -------------------------- */

export function leerPerfilActivoId(): string | null {
  try {
    return window.localStorage.getItem(PERFIL_ACTIVO_KEY);
  } catch {
    return null;
  }
}

export function fijarPerfilActivo(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PERFIL_ACTIVO_KEY, id);
    else window.localStorage.removeItem(PERFIL_ACTIVO_KEY);
  } catch {
    /* noop */
  }
}

/* ------------------------------ Caché local ------------------------------ */

function leerCache(userId: string): Perfil[] {
  const lista = leer<Perfil[]>(CACHE_KEY(userId), []);
  return Array.isArray(lista) ? lista : [];
}

function guardarCache(userId: string, perfiles: Perfil[]): void {
  escribir(CACHE_KEY(userId), perfiles);
}

/**
 * La caché guarda el hash+salt del PIN (no el PIN): verificar offline usa el
 * hash cacheado. Ojo: un PIN de 4 dígitos es fuerza bruta por definición;
 * esto es una cerradura casual, no una bóveda.
 */
interface FilaPerfil {
  id: string;
  nombre: string;
  color: string;
  avatar: string | null;
  foto: string | null;
  pin_salt: string | null;
  pin_hash: string | null;
  creado_en: string;
  ultimo_uso: string;
}

function filaAPerfil(f: FilaPerfil): Perfil {
  return {
    id: f.id,
    nombre: f.nombre,
    color: f.color,
    avatar: f.avatar ?? null,
    foto: f.foto ?? null,
    pinSalt: f.pin_salt ?? null,
    pinHash: f.pin_hash ?? null,
    creadoEn: f.creado_en,
    ultimoUso: f.ultimo_uso,
  };
}

/** El perfil puente de la migración 0014 nunca se muestra en la app. */
function sinPuente(lista: Perfil[]): Perfil[] {
  return lista.filter((p) => p.id !== PERFIL_LEGADO);
}

/**
 * Migra PINs viejos de localStorage a la nube (una sola vez por perfil):
 * si hay un PIN local válido y la nube no tiene hash, lo sube hasheado y
 * borra la clave vieja del dispositivo.
 */
async function migrarPinLocal(userId: string, perfiles: Perfil[]): Promise<void> {
  const supabase = getSupabase();
  let cambios = false;
  for (const p of perfiles) {
    if (tienePin(p) || p.pendiente) continue;
    let local: string | null = null;
    try {
      const v = window.localStorage.getItem(PIN_KEY_VIEJO(p.id));
      if (esPinValido(v)) local = v;
    } catch {
      /* noop */
    }
    if (!local) continue;
    const salt = generarSaltPin();
    const hash = await hashPin(local, salt).catch(() => null);
    if (!hash) continue;
    p.pinSalt = salt;
    p.pinHash = hash;
    cambios = true;
    try {
      window.localStorage.removeItem(PIN_KEY_VIEJO(p.id));
    } catch {
      /* noop */
    }
    if (supabase) {
      try {
        const { error } = await supabase
          .from("perfiles")
          .update({ pin_salt: salt, pin_hash: hash })
          .eq("id", p.id)
          .eq("user_id", userId);
        if (error) throw error;
      } catch (e) {
        if (!esErrorRed(e)) console.error("Error migrando PIN a la nube:", (e as Error).message);
      }
    }
  }
  if (cambios) guardarCache(userId, perfiles);
}

/* --------------------------------- Lectura -------------------------------- */

function esErrorRed(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? "";
  return m.includes("Failed to fetch") || m.includes("Network") || m.includes("fetch");
}

/**
 * Carga los perfiles de la nube; sin red (o sin sesión) usa la caché local.
 * Marca `pendiente` los creados offline que aún no subieron.
 */
export async function cargarPerfiles(userId: string): Promise<Perfil[]> {
  const supabase = getSupabase();
  const cache = sinPuente(leerCache(userId));
  if (!supabase) return cache;
  try {
    const { data, error } = await supabase
      .from("perfiles")
      .select("id, nombre, color, avatar, foto, pin_salt, pin_hash, creado_en, ultimo_uso")
      .eq("user_id", userId)
      .order("creado_en", { ascending: true });
    if (error) throw error;
    const nube = sinPuente(((data ?? []) as FilaPerfil[]).map(filaAPerfil));
    // Conserva los creados offline que la nube aún no conoce.
    const idsNube = new Set(nube.map((p) => p.id));
    const pendientes = cache.filter((p) => p.pendiente && !idsNube.has(p.id));
    const todos = [...nube, ...pendientes];
    await migrarPinLocal(userId, todos);
    guardarCache(userId, todos);
    return todos;
  } catch (e) {
    if (!esErrorRed(e)) console.error("Error cargando perfiles:", (e as Error).message);
    return cache;
  }
}

/**
 * Reintenta subir los perfiles creados sin red. Se llama al volver la
 * conexión y al rehidratar.
 */
export async function sincronizarPerfilesPendientes(userId: string): Promise<Perfil[]> {
  const supabase = getSupabase();
  if (!supabase) return sinPuente(leerCache(userId));
  const cache = sinPuente(leerCache(userId));
  const pendientes = cache.filter((p) => p.pendiente);
  if (pendientes.length === 0) return cache;
  let ok = true;
  for (const p of pendientes) {
    try {
      const { error } = await supabase.from("perfiles").insert({
        id: p.id,
        user_id: userId,
        nombre: p.nombre,
        color: p.color,
        avatar: p.avatar,
        foto: p.foto,
        pin_salt: p.pinSalt,
        pin_hash: p.pinHash,
      });
      if (error) throw error;
      p.pendiente = false;
    } catch (e) {
      if (!esErrorRed(e)) console.error("Error subiendo perfil pendiente:", (e as Error).message);
      ok = false;
    }
  }
  if (ok) {
    for (const p of cache) delete p.pendiente;
    guardarCache(userId, cache);
  }
  return cache;
}

/* ---------------------------------- CRUD ---------------------------------- */

export interface DatosPerfil {
  nombre: string;
  color: string;
  avatar?: string | null;
  foto?: string | null;
  pin?: string | null;
}

export async function crearPerfil(userId: string, datos: DatosPerfil): Promise<Perfil | null> {
  const nombre = datos.nombre.trim().slice(0, 24);
  if (!nombre) return null;
  const cache = leerCache(userId);
  if (cache.length >= MAX_PERFILES) return null;
  const ahora = new Date().toISOString();
  let pinSalt: string | null = null;
  let pinHash: string | null = null;
  if (esPinValido(datos.pin)) {
    pinSalt = generarSaltPin();
    pinHash = await hashPin(datos.pin!, pinSalt).catch(() => null);
    if (!pinHash) pinSalt = null;
  }
  const perfil: Perfil = {
    id: nuevoId(),
    nombre,
    color: datos.color,
    avatar: datos.avatar ?? null,
    foto: datos.foto ?? null,
    pinSalt,
    pinHash,
    creadoEn: ahora,
    ultimoUso: ahora,
  };
  const supabase = getSupabase();
  let pendiente = false;
  if (supabase) {
    try {
      const { error } = await supabase.from("perfiles").insert({
        id: perfil.id,
        user_id: userId,
        nombre: perfil.nombre,
        color: perfil.color,
        avatar: perfil.avatar,
        foto: perfil.foto,
        pin_salt: perfil.pinSalt,
        pin_hash: perfil.pinHash,
      });
      if (error) throw error;
    } catch (e) {
      // Sin red: queda pendiente y se sube al volver la conexión.
      if (!esErrorRed(e)) console.error("Error creando perfil en la nube:", (e as Error).message);
      pendiente = true;
    }
  }
  const guardado = { ...perfil, pendiente: pendiente || undefined };
  guardarCache(userId, [...cache, guardado]);
  logEvent("PERFIL_CREATED", "perfil", perfil.id, { nombre: perfil.nombre }, sufijoDePerfil(userId, perfil.id));
  return guardado;
}

export async function actualizarPerfil(
  userId: string,
  id: string,
  cambios: {
    nombre?: string;
    color?: string;
    avatar?: string | null;
    foto?: string | null;
    /** undefined = no tocar; null = quitar; 4 dígitos = nuevo PIN. */
    pin?: string | null;
  },
): Promise<Perfil | null> {
  const cache = sinPuente(leerCache(userId));
  const i = cache.findIndex((p) => p.id === id);
  if (i === -1) return null;
  const nombre = cambios.nombre?.trim().slice(0, 24);
  let pinSalt = cache[i].pinSalt;
  let pinHash = cache[i].pinHash;
  if (cambios.pin !== undefined) {
    if (esPinValido(cambios.pin)) {
      pinSalt = generarSaltPin();
      pinHash = (await hashPin(cambios.pin!, pinSalt).catch(() => null)) ?? null;
      if (!pinHash) pinSalt = null;
    } else {
      pinSalt = null;
      pinHash = null;
    }
  }
  const actualizado: Perfil = {
    ...cache[i],
    nombre: nombre || cache[i].nombre,
    color: cambios.color ?? cache[i].color,
    avatar: cambios.avatar !== undefined ? cambios.avatar : cache[i].avatar,
    foto: cambios.foto !== undefined ? cambios.foto : cache[i].foto,
    pinSalt,
    pinHash,
  };
  const supabase = getSupabase();
  if (supabase && !actualizado.pendiente) {
    try {
      const { error } = await supabase
        .from("perfiles")
        .update({
          nombre: actualizado.nombre,
          color: actualizado.color,
          avatar: actualizado.avatar,
          foto: actualizado.foto,
          pin_salt: actualizado.pinSalt,
          pin_hash: actualizado.pinHash,
          ultimo_uso: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
    } catch (e) {
      if (!esErrorRed(e)) console.error("Error actualizando perfil en la nube:", (e as Error).message);
    }
  }
  cache[i] = actualizado;
  guardarCache(userId, cache);
  logEvent("PERFIL_UPDATED", "perfil", id, { nombre: actualizado.nombre }, sufijoDePerfil(userId, id));
  return actualizado;
}

export async function marcarUsoPerfil(userId: string, id: string): Promise<void> {
  const cache = leerCache(userId);
  const p = cache.find((x) => x.id === id);
  if (p) {
    p.ultimoUso = new Date().toISOString();
    guardarCache(userId, cache);
  }
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("perfiles").update({ ultimo_uso: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
  } catch {
    /* no crítico */
  }
}

/**
 * Elimina el perfil y TODOS sus datos: filas en la nube con su perfil_id,
 * claves locales del ámbito y su PIN. Nunca toca otros perfiles.
 */
export async function eliminarPerfil(userId: string, id: string): Promise<void> {
  const nombre = leerCache(userId).find((x) => x.id === id)?.nombre ?? null;
  // Auditoría: se encola en el propio ámbito del perfil y se intenta subir
  // ANTES de borrar la cola local (si no hay red, el evento se pierde con ella).
  logEvent("PERFIL_DELETED", "perfil", id, nombre ? { nombre } : null, sufijoDePerfil(userId, id));
  try {
    await flushLog();
  } catch {
    /* noop */
  }
  const supabase = getSupabase();
  if (supabase) {
    try {
      for (const tabla of ["completions", "deleted_habits", "habits", "game_state", "push_subscriptions", "liga_miembros", "activity_log"] as const) {
        const { error } = await supabase.from(tabla).delete().eq("user_id", userId).eq("perfil_id", id);
        if (error && !esErrorRed(error)) console.error(`Error borrando ${tabla} del perfil:`, error.message);
      }
      const { error } = await supabase.from("perfiles").delete().eq("id", id).eq("user_id", userId);
      if (error && !esErrorRed(error)) console.error("Error borrando perfil:", error.message);
    } catch (e) {
      if (!esErrorRed(e)) console.error("Error eliminando perfil:", (e as Error).message);
    }
  }
  // Limpieza local acotada al ámbito del perfil.
  try {
    const sufijo = sufijoDePerfil(userId, id);
    for (const k of clavesDeDatos(sufijo)) window.localStorage.removeItem(k);
    window.localStorage.removeItem(PIN_KEY_VIEJO(id));
  } catch {
    /* noop */
  }
  guardarCache(userId, leerCache(userId).filter((p) => p.id !== id));
  if (leerPerfilActivoId() === id) fijarPerfilActivo(null);
}

/* ------------------------- Siembra de estado ------------------------ */

/**
 * Escribe el estado inicial de un perfil nuevo: las plantillas elegidas en
 * el asistente más el hábito Sueño (siempre activo, no se puede borrar).
 * No pisa un estado que ya exista para ese perfil.
 */
export function sembrarEstadoPerfil(userId: string, perfilId: string, plantillas: Plantilla[]): void {
  const clave = claveEstado(sufijoDePerfil(userId, perfilId));
  try {
    if (window.localStorage.getItem(clave)) return;
    const base = crearEstadoInicial();
    // crearEstadoInicial ya trae Sueño (siempre activo): no duplicarlo.
    const suenoBase = base.habits.find((h) => h.tipo === "sueno");
    const elegidos = plantillas.map(habitoDesdePlantilla).filter((h) => h.tipo !== "sueno");
    const estado: AppState = {
      ...base,
      habits: [...elegidos, ...(suenoBase ? [suenoBase] : [])],
      completions: [],
    };
    window.localStorage.setItem(clave, JSON.stringify(estado));
  } catch {
    /* si el almacenamiento falla, el perfil entra igual con el estado inicial */
  }
}

/**
 * Suma plantillas al estado existente de un perfil (sin duplicar por nombre).
 * Se usa al crear el primer perfil: adopta los datos legado y agrega los
 * hábitos elegidos en el asistente que aún no existan.
 */
export function agregarPlantillasAEstado(userId: string, perfilId: string, plantillas: Plantilla[]): void {
  if (plantillas.length === 0) return;
  const clave = claveEstado(sufijoDePerfil(userId, perfilId));
  try {
    const raw = window.localStorage.getItem(clave);
    if (!raw) return;
    const estado = JSON.parse(raw) as AppState;
    const nombres = new Set(estado.habits.map((h) => h.nombre.trim().toLowerCase()));
    const nuevos = plantillas
      .filter((p) => !nombres.has(p.nombre.trim().toLowerCase()))
      .map(habitoDesdePlantilla);
    if (nuevos.length === 0) return;
    window.localStorage.setItem(clave, JSON.stringify({ ...estado, habits: [...estado.habits, ...nuevos] }));
  } catch {
    /* no crítico */
  }
}

export interface DatosPerfilNuevo extends DatosPerfil {
  plantillas: Plantilla[];
}

/**
 * Crea el PRIMER perfil de la cuenta: crea la fila en la nube, adopta los
 * datos legado (local + nube) y suma las plantillas elegidas en el asistente.
 */
export async function crearPrimerPerfil(userId: string, datos: DatosPerfilNuevo): Promise<Perfil | null> {
  const p = await crearPerfil(userId, datos);
  if (!p) return null;
  await adoptarDatosLegado(userId, p.id);
  agregarPlantillasAEstado(userId, p.id, datos.plantillas);
  return p;
}

/**
 * Crea un perfil ADICIONAL: crea la fila en la nube y siembra su estado con
 * las plantillas elegidas + Sueño (empieza de cero, sin datos legado).
 */
export async function crearPerfilAdicional(userId: string, datos: DatosPerfilNuevo): Promise<Perfil | null> {
  const p = await crearPerfil(userId, datos);
  if (!p) return null;
  sembrarEstadoPerfil(userId, p.id, datos.plantillas);
  return p;
}

/* ------------------------- Adopción de datos legado ------------------------ */

/**
 * Adopta los datos existentes (de cuando no había perfiles) al primer perfil.
 * - Local: copia las claves `<userId>` a `<userId>:perfil:<id>` y estampa
 *   perfil_id en las operaciones pendientes.
 * - Nube: asigna perfil_id a las filas con NULL o uuid cero.
 * Idempotente: si ya se adoptó, no hace nada.
 */
export async function adoptarDatosLegado(userId: string, perfilId: string): Promise<void> {
  const sufijoViejo = userId;
  const sufijoNuevo = sufijoDePerfil(userId, perfilId);
  try {
    // 1. Copiar estado y colas locales (sin borrar las viejas: sirven de respaldo).
    const copias: Array<[string, string]> = [
      [claveEstado(sufijoViejo), claveEstado(sufijoNuevo)],
      [clavePendientes(sufijoViejo), clavePendientes(sufijoNuevo)],
      [claveColaLog(sufijoViejo), claveColaLog(sufijoNuevo)],
      [claveNotifEnviadas(sufijoViejo), claveNotifEnviadas(sufijoNuevo)],
    ];
    for (const [origen, destino] of copias) {
      try {
        const raw = window.localStorage.getItem(origen);
        if (raw && !window.localStorage.getItem(destino)) {
          if (origen === clavePendientes(sufijoViejo)) {
            // Estampar perfil_id en las operaciones pendientes heredadas.
            const ops = JSON.parse(raw) as Array<{ kind: string; payload?: Record<string, unknown> }>;
            for (const op of ops) {
              if (op.payload && typeof op.payload === "object" && !("perfil_id" in op.payload)) {
                op.payload.perfil_id = perfilId;
              }
            }
            window.localStorage.setItem(destino, JSON.stringify(ops));
          } else {
            window.localStorage.setItem(destino, raw);
          }
        }
      } catch {
        /* clave individual */
      }
    }
    try {
      window.localStorage.setItem("habitos-adopcion-perfil-v1", perfilId);
    } catch {
      /* noop */
    }
  } catch {
    /* almacenamiento no disponible */
  }

  // 2. Adoptar filas en la nube.
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    for (const tabla of ["habits", "completions", "push_subscriptions", "activity_log"] as const) {
      await supabase.from(tabla).update({ perfil_id: perfilId }).eq("user_id", userId).is("perfil_id", null);
    }
    for (const tabla of ["game_state", "deleted_habits", "liga_miembros"] as const) {
      await supabase.from(tabla).update({ perfil_id: perfilId }).eq("user_id", userId).eq("perfil_id", PERFIL_LEGADO);
    }
    // 3. El perfil puente de la migración 0014 ya cumplió: se elimina para que
    //    nunca aparezca en la lista (la app además lo filtra por si acaso).
    await supabase.from("perfiles").delete().eq("id", PERFIL_LEGADO).eq("user_id", userId);
    guardarCache(userId, sinPuente(leerCache(userId)));
  } catch (e) {
    if (!esErrorRed(e)) console.error("Error adoptando datos legado:", (e as Error).message);
  }
}

/** ¿Ya se adoptaron los datos legado a algún perfil? */
export function adopcionHecha(): string | null {
  try {
    return window.localStorage.getItem("habitos-adopcion-perfil-v1");
  } catch {
    return null;
  }
}

/** Identidad activa (cuenta + perfil) para módulos fuera de React. */
export async function identidadActiva(): Promise<{ userId: string; perfilId: string | null; sufijo: string } | null> {
  if (typeof window === "undefined") return null;
  const user = await getCachedUser().catch(() => null);
  if (!user) return null;
  const perfilId = leerPerfilActivoId();
  return { userId: user.id, perfilId, sufijo: sufijoDePerfil(user.id, perfilId) };
}
