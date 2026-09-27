"use client";

/**
 * Checkbox animado (patrón clásico de Uiverse): círculo que se rellena y
 * check que se dibuja con animación de trazo. Reemplaza al botón "Marcar"/
 * "Hecho" en las filas de momento del home: marcar se siente mejor.
 */
export default function CheckAnimado({
  marcado,
  onCambiar,
  etiqueta,
  deshabilitado = false,
  className = "",
}: {
  marcado: boolean;
  onCambiar: (nuevo: boolean) => void;
  etiqueta: string;
  deshabilitado?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={() => onCambiar(!marcado)}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2 active:scale-95 disabled:opacity-50 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="10"
          fill={marcado ? "var(--accent)" : "none"}
          stroke={marcado ? "var(--accent)" : "var(--border)"}
          strokeWidth="2"
          style={{ transition: "fill 0.2s ease, stroke 0.2s ease" }}
        />
        <path
          d="M8 12.5l2.7 2.7L16.5 9"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={14}
          strokeDashoffset={marcado ? 0 : 14}
          style={{ transition: "stroke-dashoffset 0.28s ease-out 0.06s" }}
        />
      </svg>
    </button>
  );
}
