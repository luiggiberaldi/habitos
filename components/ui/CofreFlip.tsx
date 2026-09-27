"use client";

import { useState } from "react";
import { IconCopo, IconRayo, IconRegalo } from "../../lib/icons";
import Sparkles from "./Sparkles";

export interface PremioCofreUI {
  tipo: "xp" | "congelador";
  cantidad: number;
}

/**
 * Cofre sorpresa con carta que gira (flip 3D, patrón clásico de Uiverse):
 * frente con el regalo, dorso con el premio revelado + destellos.
 * Se toca una vez para abrir; no se vuelve a cerrar (el premio ya es tuyo).
 */
export default function CofreFlip({ premio }: { premio: PremioCofreUI }) {
  const [abierto, setAbierto] = useState(false);
  const esCongelador = premio.tipo === "congelador";

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-xl font-bold">¡Cofre del día!</h2>
      <p className="mt-1 text-sm text-muted">
        {abierto ? "Día completo. Te lo ganaste." : "Toca el cofre para revelar tu premio"}
      </p>

      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={abierto ? "Cofre abierto" : "Abrir el cofre del día"}
        className="mt-5 h-48 w-48 [perspective:900px]"
      >
        <span
          className={`relative block h-full w-full transition-transform duration-700 [transform-style:preserve-3d] ${
            abierto ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          {/* Frente: el regalo cerrado */}
          <span className="absolute inset-0 flex items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-strong shadow-lg [backface-visibility:hidden]">
            {!abierto && (
              <span className="animate-flotar absolute inset-0 rounded-3xl" aria-hidden="true" />
            )}
            <IconRegalo className="h-20 w-20 text-white drop-shadow" />
          </span>
          {/* Dorso: el premio */}
          <span className="absolute inset-0 overflow-hidden rounded-3xl border border-accent/30 bg-surface-2 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            {abierto && (
              <Sparkles className="absolute inset-0 h-full w-full" densidad={34} />
            )}
            <span className="relative flex h-full flex-col items-center justify-center gap-1.5 p-4">
              {esCongelador ? (
                <IconCopo className="h-12 w-12 text-sky-400" aria-hidden="true" />
              ) : (
                <IconRayo className="h-12 w-12 text-accent" aria-hidden="true" />
              )}
              <span className="text-2xl font-extrabold">
                {esCongelador ? "¡Congelador!" : `+${premio.cantidad} XP`}
              </span>
              <span className="text-xs leading-snug text-muted">
                {esCongelador
                  ? "Protege tu racha si un día fallas"
                  : "Bonus sorpresa por completar el día"}
              </span>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}
