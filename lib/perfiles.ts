// lib/perfiles.ts — Perfiles locales tipo Netflix.
//
// Cada perfil es un silo de datos 100 % en el dispositivo: su estado, su cola
// de sincronización, su cola de auditoría y sus notificaciones enviadas viven
// bajo claves con el sufijo `perfil:<id>`. Dos perfiles nunca se tocan.
//
// El modo "cuenta" (Supabase) sigue intacto: usa el userId como sufijo, igual
// que antes. `sufijoAmbito` centraliza esa decisión.

export interface Perfil {
  id: string;
  nombre: string;
  /** Hex del color del avatar. */
  color: string;
  creadoEn: string;
  ultimoUso: string;
}

export type ModoAuth = "perfiles" | "cuenta";

const PERFILES_KEY = "habitos-perfiles-v1";
const PERFIL_ACTIVO_KEY = "habitos-perfil-activo-v1";
const MODO_AUTH_KEY = "habitos-modo-auth-v1";

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

/* ------------------------------ Persistencia ---------------------------- */

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

export function leerPerfiles(): Perfil[] {
  const lista = leer<Perfil[]>(PERFILES_KEY, []);
  return Array.isArray(lista) ? lista : [];
}

function guardarPerfiles(perfiles: Perfil[]): void {
  escribir(PERFILES_KEY, perfiles);
}

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

export function leerModoAuth(): ModoAuth | null {
  try {
    const v = window.localStorage.getItem(MODO_AUTH_KEY);
    return v === "perfiles" || v === "cuenta" ? v : null;
  } catch {
    return null;
  }
}

export function fijarModoAuth(modo: ModoAuth): void {
  try {
    window.localStorage.setItem(MODO_AUTH_KEY, modo);
  } catch {
    /* noop */
  }
}

/* --------------------------------- CRUD --------------------------------- */

function nuevoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function crearPerfil(nombre: string, color: string): Perfil | null {
  const limpio = nombre.trim().slice(0, 24);
  if (!limpio) return null;
  const perfiles = leerPerfiles();
  if (perfiles.length >= MAX_PERFILES) return null;
  const ahora = new Date().toISOString();
  const perfil: Perfil = { id: nuevoId(), nombre: limpio, color, creadoEn: ahora, ultimoUso: ahora };
  guardarPerfiles([...perfiles, perfil]);
  return perfil;
}

export function actualizarPerfil(id: string, cambios: { nombre?: string; color?: string }): Perfil | null {
  const perfiles = leerPerfiles();
  const i = perfiles.findIndex((p) => p.id === id);
  if (i === -1) return null;
  const nombre = cambios.nombre?.trim().slice(0, 24);
  const actualizado: Perfil = {
    ...perfiles[i],
    nombre: nombre || perfiles[i].nombre,
    color: cambios.color ?? perfiles[i].color,
  };
  perfiles[i] = actualizado;
  guardarPerfiles(perfiles);
  return actualizado;
}

export function marcarUsoPerfil(id: string): void {
  const perfiles = leerPerfiles();
  const p = perfiles.find((x) => x.id === id);
  if (!p) return;
  p.ultimoUso = new Date().toISOString();
  guardarPerfiles(perfiles);
}

/** Elimina el perfil y TODOS sus datos (estado, colas, notificaciones). */
export function eliminarPerfil(id: string): void {
  const sufijo = `perfil:${id}`;
  try {
    for (const clave of clavesDeDatos(sufijo)) window.localStorage.removeItem(clave);
  } catch {
    /* noop */
  }
  guardarPerfiles(leerPerfiles().filter((p) => p.id !== id));
  if (leerPerfilActivoId() === id) fijarPerfilActivo(null);
}

/* ------------------------- División de datos ---------------------------- */

/**
 * Sufijo que aísla los datos de una identidad.
 * - Perfil local → `perfil:<id>`
 * - Cuenta Supabase → `<userId>` (formato histórico, no se toca)
 * - Sin identidad → null
 */
export function sufijoAmbito(perfilId: string | null, userId: string | null): string | null {
  if (perfilId) return `perfil:${perfilId}`;
  if (userId) return userId;
  return null;
}

/** Clave del estado principal para un sufijo de ámbito. */
export function claveEstado(sufijo: string): string {
  return `habitos-app-v1:${sufijo}`;
}

/** Clave de la cola de sincronización pendiente para un sufijo. */
export function clavePendientes(sufijo: string): string {
  return `habitos-pending-sync-v1:${sufijo}`;
}

/** Clave de la cola de auditoría pendiente para un sufijo. */
export function claveColaLog(sufijo: string): string {
  return `habitos-log-queue-v1:${sufijo}`;
}

/** Clave de notificaciones ya enviadas para un sufijo. */
export function claveNotifEnviadas(sufijo: string): string {
  return `habitos-notificaciones-enviadas-v1:${sufijo}`;
}

/** Todas las claves de datos de un ámbito (para borrado acotado). */
export function clavesDeDatos(sufijo: string): string[] {
  return [claveEstado(sufijo), clavePendientes(sufijo), claveColaLog(sufijo), claveNotifEnviadas(sufijo)];
}
