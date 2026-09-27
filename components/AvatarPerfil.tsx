"use client";

import type { Perfil } from "../lib/habitos/perfiles";
import { avatarPorId } from "../lib/habitos/avatares";

interface Props {
  perfil: Perfil;
  className?: string;
}

/**
 * Avatar circular de un perfil: la foto personalizada si la hay, la imagen
 * elegida de la galería, o la inicial con el color del perfil.
 */
export default function AvatarPerfil({ perfil, className = "" }: Props) {
  if (perfil.foto) {
    return (
      <img
        src={perfil.foto}
        alt={`Foto de ${perfil.nombre}`}
        className={`rounded-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }
  const avatar = avatarPorId(perfil.avatar);
  if (avatar) {
    return (
      <img
        src={avatar.src}
        alt={`Avatar de ${perfil.nombre}`}
        className={`rounded-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }
  const inicial = (perfil.nombre.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ backgroundColor: perfil.color }}
      aria-hidden="true"
    >
      {inicial}
    </span>
  );
}
