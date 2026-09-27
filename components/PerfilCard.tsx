"use client";

import { useState, type CSSProperties } from "react";
import type { Perfil } from "../lib/perfiles";
import { tienePin } from "../lib/perfiles";
import AvatarPerfil from "./AvatarPerfil";
import { IconBorrar, IconCandado, IconEditar, IconFlechaAtras } from "../lib/icons";

interface Props {
  perfil: Perfil;
  numHabitos: number;
  onEntrar: () => void;
  onEditar: () => void;
  onEliminar: () => void;
}

/**
 * Ficha de perfil con giro 3D (efecto adaptado de Uiverse).
 * - El original giraba con hover; aquí es por toque (en móvil no hay hover).
 * - Frente: avatar (imagen elegida o inicial) y el nombre. Dorso: datos y acciones.
 * - Respeta `prefers-reduced-motion` (el giro se desactiva en globals.css).
 */
export default function PerfilCard({ perfil, numHabitos, onEntrar, onEditar, onEliminar }: Props) {
  const [volteado, setVolteado] = useState(false);

  return (
    <div
      className={`perfil-flip aspect-[5/6] w-full select-none ${volteado ? "volteado" : ""}`}
      style={{ "--pc": perfil.color } as CSSProperties}
    >
      <div className="perfil-flip-inner">
        {/* Frente */}
        <button
          type="button"
          onClick={() => setVolteado(true)}
          aria-label={`Ver opciones de ${perfil.nombre}`}
          className="perfil-flip-cara flex cursor-pointer flex-col items-center justify-center gap-4 rounded-[2rem] text-white shadow-lg relative"
          style={{
            background: "linear-gradient(135deg, var(--pc), color-mix(in srgb, var(--pc) 55%, black))",
          }}
        >
          {tienePin(perfil) && (
            <span
              aria-label="Perfil protegido con PIN"
              title="Protegido con PIN"
              className="absolute right-4 top-4 rounded-full bg-black/30 p-1.5"
            >
              <IconCandado className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
          )}
          <AvatarPerfil perfil={perfil} className="h-20 w-20 text-4xl" />
          <span className="max-w-full truncate px-4 text-lg font-bold">{perfil.nombre}</span>
          <span className="text-xs font-medium text-white/80">Toca para ver opciones</span>
        </button>

        {/* Dorso */}
        <div className="perfil-flip-cara perfil-flip-dorso flex flex-col items-center justify-center gap-3 rounded-[2rem] border border-border bg-surface p-4 text-center shadow-lg">
          <p className="max-w-full truncate text-base font-bold">{perfil.nombre}</p>
          <p className="text-xs text-muted">
            {numHabitos} hábito{numHabitos !== 1 ? "s" : ""}
          </p>
          <button type="button" onClick={onEntrar} className="btn-primary mt-1 min-h-11 w-full text-sm">
            Entrar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEditar}
              aria-label={`Editar ${perfil.nombre}`}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <IconEditar className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onEliminar}
              aria-label={`Eliminar ${perfil.nombre}`}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
            >
              <IconBorrar className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setVolteado(false)}
              aria-label="Volver"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <IconFlechaAtras className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
