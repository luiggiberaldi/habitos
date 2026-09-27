import { useEffect, useState } from "react";
import type { Habit } from "../lib/types";
import { IconReloj, IconX } from "../lib/icons";

/** Motivos sugeridos para posponer un hábito (se puede escribir uno libre). */
export const MOTIVOS_POSPONER = [
  "Enfermedad",
  "Período",
  "Cansancio",
  "Viaje",
  "Día ocupado",
];

/**
 * Modal para elegir el motivo al posponer un hábito para mañana.
 * Chips de motivos comunes + texto libre; el motivo es obligatorio.
 */
export default function ModalMotivo({
  habit,
  onConfirmar,
  onClose,
}: {
  habit: Habit;
  onConfirmar: (motivo: string) => void;
  onClose: () => void;
}) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [libre, setLibre] = useState("");

  useEffect(() => {
    const alTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alTeclar);
    return () => window.removeEventListener("keydown", alTeclar);
  }, [onClose]);

  const motivo = libre.trim() || elegido || "";
  const listo = motivo.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Posponer ${habit.nombre}`}
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
            <IconReloj className="h-5 w-5 text-accent" aria-hidden="true" />
            Posponer para mañana
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="btn-icon min-h-[40px] min-w-[40px]"
          >
            <IconX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-1 text-sm text-muted">
          <span className="font-medium text-fg">{habit.nombre}</span> vuelve solo mañana.
          ¿Por qué lo pospones?
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Motivos comunes">
          {MOTIVOS_POSPONER.map((m) => {
            const sel = elegido === m && !libre.trim();
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setElegido(sel ? null : m);
                  setLibre("");
                }}
                aria-pressed={sel}
                className={`chip min-h-10 !text-sm ${sel ? "chip-active" : "hover:border-accent"}`}
              >
                {m}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <label htmlFor="motivo-libre" className="mb-1.5 block text-sm font-medium text-fg">
            Otro motivo
          </label>
          <input
            id="motivo-libre"
            type="text"
            value={libre}
            onChange={(e) => setLibre(e.target.value)}
            placeholder="Escríbelo aquí…"
            maxLength={60}
            className="input-field min-h-11"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary min-h-11 flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivo)}
            disabled={!listo}
            className="btn-primary min-h-11 flex-1 disabled:opacity-40"
          >
            Posponer
          </button>
        </div>
      </div>
    </div>
  );
}
