// lib/ambito.ts — Identidad única offline-first.
//
// La app tiene una sola identidad: la cuenta en la nube (userId de Supabase),
// cacheada en el dispositivo. Todo (estado, colas, logs, notificaciones) se
// aísla por este sufijo. Sin sesión, se usa el ámbito local "" (solo en
// desarrollo sin Supabase configurado).

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

/**
 * Sufijo de ámbito a partir del userId (o "" sin sesión). Los datos de la
 * nube ya existente usan el userId como sufijo, igual que antes.
 */
export function sufijoDeUsuario(userId: string | null): string {
  return userId ?? "";
}

/**
 * Sufijo de ámbito para un perfil en la nube: `<userId>:perfil:<perfilId>`.
 * Cada perfil es un silo completo (estado, colas, logs, notificaciones).
 * Sin perfil (cuenta sin perfiles o desarrollo local), se degrada al sufijo
 * de usuario para no romper nada.
 */
export function sufijoDePerfil(userId: string | null, perfilId: string | null): string {
  if (userId && perfilId) return `${userId}:perfil:${perfilId}`;
  return userId ?? "";
}
