"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck } from "../../lib/icons";

type Estado = "reposo" | "cargando" | "exito";

/**
 * Botón con estados (inspirado en el Stateful Button de Aceternity UI):
 * reposo → cargando (spinner) → éxito (check) → reposo.
 * `onAccion` debe devolver una promesa; si rechaza, el botón vuelve a reposo
 * sin mostrar éxito (el llamador enseña el error con su propio estado).
 */
export default function StatefulButton({
  onAccion,
  children,
  textoCargando = "Cargando…",
  textoExito = "¡Listo!",
  variante = "primary",
  className = "",
  deshabilitado = false,
}: {
  onAccion: () => Promise<void>;
  children: ReactNode;
  textoCargando?: string;
  textoExito?: string;
  variante?: "primary" | "secondary";
  className?: string;
  deshabilitado?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>("reposo");
  const temporizador = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    };
  }, []);

  const accionar = async (): Promise<void> => {
    if (estado !== "reposo" || deshabilitado) return;
    setEstado("cargando");
    try {
      await onAccion();
    } catch {
      setEstado("reposo");
      return;
    }
    setEstado("exito");
    temporizador.current = window.setTimeout(() => setEstado("reposo"), 1800);
  };

  const base = variante === "primary" ? "btn-primary" : "btn-secondary";

  return (
    <button
      type="button"
      onClick={() => void accionar()}
      disabled={deshabilitado || estado !== "reposo"}
      className={`${base} min-h-11 min-w-32 items-center justify-center gap-2 disabled:opacity-70 ${className}`}
    >
      {estado === "reposo" && children}
      {estado === "cargando" && (
        <>
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>{textoCargando}</span>
        </>
      )}
      {estado === "exito" && (
        <span className="animate-pop-in inline-flex items-center gap-2">
          <IconCheck className="h-5 w-5" aria-hidden="true" />
          <span>{textoExito}</span>
        </span>
      )}
    </button>
  );
}
