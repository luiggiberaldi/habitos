"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { IconX } from "../lib/icons";
import Sparkles from "./ui/Sparkles";
import Confeti from "./ui/Confeti";

export interface CelebracionData {
  icono: ReactNode;
  titulo: string;
  detalle: string;
  /** Cuerpo personalizado (p. ej. el cofre con flip): reemplaza icono/título/detalle. */
  cuerpo?: ReactNode;
  /** Acción principal opcional (p. ej. ir a reclamar un premio). */
  accion?: { etiqueta: string; href: string };
  /**
   * "trofeo": revelado de logro — la medalla entra con pop elástico, onda
   * expansiva, ráfaga de confeti y el XP sube contando. Solo CSS + canvas.
   * "sacudida": el icono se sacude una vez (p. ej. XP negativo en sueño).
   */
  efecto?: "trofeo" | "sacudida";
  /** XP a animar con contador cuando efecto === "trofeo". */
  xp?: number;
}

/** Contador animado 0 → objetivo (~0.9s, easeOutCubic). */
function useCountUp(objetivo: number, ms = 900): number {
  const [valor, setValor] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? objetivo
      : 0,
  );
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const inicio = performance.now();
    const tick = (ahora: number): void => {
      const t = Math.min(1, (ahora - inicio) / ms);
      setValor(Math.round((1 - Math.pow(1 - t, 3)) * objetivo));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [objetivo, ms]);
  return valor;
}

function TrofeoRevelado({
  icono,
  titulo,
  detalle,
  xp,
}: {
  icono: ReactNode;
  titulo: string;
  detalle: string;
  xp?: number;
}) {
  const xpAnimado = useCountUp(xp ?? 0);
  return (
    <div className="relative">
      <div className="relative mx-auto h-24 w-24">
        <span aria-hidden="true" className="animate-trofeo-onda absolute inset-0 rounded-full bg-accent-soft" />
        <span
          aria-hidden="true"
          className="animate-trofeo-onda absolute inset-0 rounded-full bg-accent-soft [animation-delay:160ms]"
        />
        <span className="animate-trofeo-pop absolute inset-0 flex items-center justify-center rounded-full bg-accent-soft text-accent">
          {icono}
        </span>
      </div>
      <h2 className="mt-4 text-xl font-bold">{titulo}</h2>
      {typeof xp === "number" && xp > 0 && (
        <p className="mt-1 text-3xl font-extrabold tabular-nums text-accent">+{xpAnimado} XP</p>
      )}
      <p className="mt-2 text-sm text-muted">{detalle}</p>
      <Confeti className="pointer-events-none absolute -inset-6 h-[calc(100%+3rem)] w-[calc(100%+3rem)]" />
    </div>
  );
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
          {data.cuerpo ??
            (data.efecto === "trofeo" ? (
              <TrofeoRevelado icono={data.icono} titulo={data.titulo} detalle={data.detalle} xp={data.xp} />
            ) : (
              <>
                <div
                  className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent ${
                    data.efecto === "sacudida" ? "animate-shake" : ""
                  }`}
                >
                  {data.icono}
                </div>
                <h2 className="mt-4 text-xl font-bold">{data.titulo}</h2>
                <p className="mt-2 text-sm text-muted">{data.detalle}</p>
              </>
            ))}
          {data.accion ? (
            <>
              <Link
                href={data.accion.href}
                onClick={onCerrar}
                className={`btn-primary mt-6 w-full justify-center ${data.efecto === "trofeo" ? "animate-boton-latido" : ""}`}
              >
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
