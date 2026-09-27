// lib/habitos/avatares.ts — Galería de avatares elegibles para perfiles.
//
// Retratos estilo videojuego (render 3D estilizado) con dirección de arte
// cohesiva: luz cinematográfica y fondo en los tonos brasa de la marca.
// Viven en `public/avatares/` (WebP 512px, ~37 KB c/u).

export interface AvatarDef {
  /** Id estable que se guarda en `Perfil.avatar`. */
  id: string;
  nombre: string;
  src: string;
}

export const AVATARES: AvatarDef[] = [
  { id: "explorador", nombre: "Explorador", src: "/avatares/avatar-01-explorador.webp" },
  { id: "robot", nombre: "Robot", src: "/avatares/avatar-02-robot.webp" },
  { id: "semilla", nombre: "Semilla", src: "/avatares/avatar-03-semilla.webp" },
  { id: "guardian", nombre: "Guardián", src: "/avatares/avatar-04-guardian.webp" },
  { id: "futuro", nombre: "Yo del futuro", src: "/avatares/avatar-05-futuro.webp" },
  { id: "mascota", nombre: "Mascota", src: "/avatares/avatar-06-mascota.webp" },
  { id: "heroe", nombre: "Héroe", src: "/avatares/avatar-07-heroe.webp" },
  { id: "astronauta", nombre: "Astronauta", src: "/avatares/avatar-08-astronauta.webp" },
  { id: "espiritu", nombre: "Espíritu", src: "/avatares/avatar-09-espiritu.webp" },
  { id: "geometrico", nombre: "Geométrico", src: "/avatares/avatar-10-geometrico.webp" },
];

/** Busca un avatar por id; null si no existe (o no se eligió ninguno). */
export function avatarPorId(id: string | null | undefined): AvatarDef | null {
  if (!id) return null;
  return AVATARES.find((a) => a.id === id) ?? null;
}
