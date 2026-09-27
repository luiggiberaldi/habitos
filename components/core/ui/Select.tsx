"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevronAbajo } from "../../../lib/core/ui/icons";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Dropdown propio con bordes redondeados (regla UI #1).
 * Reemplaza al <select> nativo, cuya lista abierta la dibuja el SO
 * y no admite border-radius.
 */
export function Select({ value, options, onChange, ariaLabel, className = "" }: SelectProps) {
  const [abierto, setAbierto] = useState(false);
  const [indiceActivo, setIndiceActivo] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const listaId = useId();
  const seleccionada = options.find((o) => o.value === value);

  // Cierra al tocar fuera.
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("pointerdown", cerrar);
    return () => document.removeEventListener("pointerdown", cerrar);
  }, [abierto]);

  const abrir = () => {
    setIndiceActivo(Math.max(0, options.findIndex((o) => o.value === value)));
    setAbierto(true);
  };

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
    botonRef.current?.focus();
  };

  const teclaBoton = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    }
  };

  const teclaLista = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setAbierto(false);
      botonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceActivo((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceActivo((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      elegir(options[indiceActivo].value);
    } else if (e.key === "Tab") {
      setAbierto(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={botonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-label={ariaLabel}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={teclaBoton}
        className="input-field flex min-h-10 w-full items-center justify-between gap-2 !py-1.5 text-left"
      >
        <span className="truncate">{seleccionada?.label ?? ""}</span>
        <IconChevronAbajo className={`h-4 w-4 shrink-0 text-muted transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>
      {abierto && (
        <ul
          id={listaId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={teclaLista}
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {options.map((op, i) => {
            const esSeleccionada = op.value === value;
            return (
              <li key={op.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={esSeleccionada}
                  onClick={() => elegir(op.value)}
                  onMouseEnter={() => setIndiceActivo(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    i === indiceActivo ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="truncate">{op.label}</span>
                  {esSeleccionada && <IconCheck className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
