"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { IconX } from "../lib/icons";
import Sparkles from "./ui/Sparkles";

export interface CelebracionData {
  icono: ReactNode;
  titulo: string;
  detalle: string;
  /** Cuerpo personalizado (p. ej. el cofre con flip): reemplaza icono/título/detalle. */
  cuerpo?: ReactNode;
  /** Acción principal opcional (p. ej. ir a reclamar un premio). */
  accion?: { etiqueta: string; href: string };
}

/**
 * Modal de celebración para eventos de juego (subida de nivel, logro, cofre,
 * desafío). Componente propio en español — nada de alert()/confirm().
 */
export default function Celebracion({
  data,
  onCerrar,
}: {
  data: CelebracionData;
  onCerrar: () => void;
}) {
  useEffect(() => {
    const alTeclar = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclar);
    return () => window.removeEventListener("keydown", alTeclar);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={data.titulo}
        className="card relative w-full max-w-sm overflow-hidden p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Sparkles className="absolute inset-0 h-full w-full opacity-60" densidad={28} />
        <div className="relative">
          {data.cuerpo ?? (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
                {data.icono}
              </div>
              <h2 className="mt-4 text-xl font-bold">{data.titulo}</h2>
              <p className="mt-2 text-sm text-muted">{data.detalle}</p>
            </>
          )}
          {data.accion ? (
            <>
              <Link href={data.accion.href} onClick={onCerrar} className="btn-primary mt-6 w-full justify-center">
                {data.accion.etiqueta}
              </Link>
              <button
                type="button"
                onClick={onCerrar}
                className="mt-2 w-full rounded-xl px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
              >
                Cerrar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onCerrar}
              className="btn-primary mt-6 w-full justify-center"
              autoFocus
            >
              ¡Genial!
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="absolute right-3 top-3 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <IconX className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
