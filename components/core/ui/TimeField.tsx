"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconReloj, IconX } from "../../../lib/core/ui/icons";

interface TimeFieldProps {
  /** Hora en formato "HH:MM" (24 h). */
  value: string;
  onChange: (valor: string) => void;
  ariaLabel: string;
  className?: string;
}

function parsear(valor: string): { h: string; m: string } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(valor.trim());
  if (!match) return { h: "00", m: "00" };
  const h = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const m = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return { h: String(h).padStart(2, "0"), m: String(m).padStart(2, "0") };
}

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTOS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/**
 * Columna desplazable de valores (horas o minutos) con snap centrado.
 * Al abrir, el valor actual queda centrado; las flechas del teclado
 * mueven el foco entre opciones.
 */
function Columna({
  etiqueta,
  valores,
  seleccionado,
  onElegir,
}: {
  etiqueta: string;
  valores: string[];
  seleccionado: string;
  onElegir: (v: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const yaCentrado = useRef(false);

  // Solo al abrir: centra el valor actual sin pelear con el scroll manual.
  useEffect(() => {
    if (yaCentrado.current) return;
    yaCentrado.current = true;
    refs.current.get(seleccionado)?.scrollIntoView({ block: "center" });
  }, [seleccionado]);

  const tecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = valores.findIndex((v) => v === document.activeElement?.getAttribute("data-valor"));
    const j = e.key === "ArrowDown" ? i + 1 : i - 1;
    if (j >= 0 && j < valores.length) refs.current.get(valores[j])?.focus();
  };

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-center text-xs font-medium text-muted">{etiqueta}</p>
      <div
        role="group"
        aria-label={etiqueta}
        onKeyDown={tecla}
        className="max-h-56 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface-2 py-24"
      >
        {valores.map((v) => {
          const activo = v === seleccionado;
          return (
            <button
              key={v}
              ref={(el) => {
                if (el) refs.current.set(v, el);
                else refs.current.delete(v);
              }}
              type="button"
              data-valor={v}
              aria-pressed={activo}
              aria-label={`${etiqueta} ${v}`}
              onClick={() => onElegir(v)}
              className={`mx-auto block w-full max-w-24 snap-center rounded-2xl px-4 py-2 text-center text-lg tabular-nums transition-colors ${
                activo ? "bg-accent-soft font-bold text-fg" : "text-muted hover:bg-surface hover:text-fg"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Campo de hora propio con picker tipo bottom-sheet.
 * Reemplaza al <input type="time"> nativo, cuyo diálogo lo dibuja el SO
 * y en algunos móviles se recorta fuera de la pantalla.
 */
export function TimeField({ value, onChange, ariaLabel, className = "" }: TimeFieldProps) {
  const [abierto, setAbierto] = useState(false);
  const { h, m } = parsear(value);

  useEffect(() => {
    if (!abierto) return;
    const alTeclar = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclar);
    return () => window.removeEventListener("keydown", alTeclar);
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={ariaLabel}
        onClick={() => setAbierto(true)}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className="tabular-nums">{`${h}:${m}`}</span>
        <IconReloj className="h-4 w-4 shrink-0 text-muted" />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={ariaLabel}>
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setAbierto(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[80dvh] w-full max-w-sm flex-col rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-fg">{ariaLabel}</h2>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="rounded-full p-2 text-muted hover:bg-surface-2"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 gap-3">
              <Columna
                etiqueta="Hora"
                valores={HORAS}
                seleccionado={h}
                onElegir={(nh) => onChange(`${nh}:${m}`)}
              />
              <Columna
                etiqueta="Minutos"
                valores={MINUTOS}
                seleccionado={m}
                onElegir={(nm) => onChange(`${h}:${nm}`)}
              />
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="btn-primary mt-4 w-full rounded-2xl px-4 py-3 font-semibold"
            >
              Listo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
