"use client";

import { useId } from "react";

/**
 * AvatarNivel — avatar 2D animado para cada nivel del juego.
 * SVG puro + animaciones CSS en loop (ver keyframes `avn-*` en globals.css).
 * Cada nivel tiene su glifo: chispa, impulso, ritmo, constancia, hábito,
 * disciplina, maestría, inspiración y leyenda.
 */

export const PALETA: Record<number, { de: string; a: string; profundo: string; suave: string }> = {
  1: { de: "#fbbf24", a: "#fb7185", profundo: "#9f1239", suave: "#fef3c7" }, // Chispa: amarillo → coral brasas
  2: { de: "#fb923c", a: "#e11d48", profundo: "#881337", suave: "#ffedd5" }, // Impulso: naranja → rojo despegue
  3: { de: "#facc15", a: "#65a30d", profundo: "#365314", suave: "#fef9c3" }, // Ritmo: amarillo → lima flow
  4: { de: "#4ade80", a: "#0d9488", profundo: "#134e4a", suave: "#dcfce7" }, // Constancia: verde → teal maduro
  5: { de: "#2dd4bf", a: "#2563eb", profundo: "#1e3a8a", suave: "#ccfbf1" }, // Hábito: teal → azul confianza
  6: { de: "#60a5fa", a: "#4f46e5", profundo: "#312e81", suave: "#dbeafe" }, // Disciplina: azul → índigo foco
  7: { de: "#818cf8", a: "#a855f7", profundo: "#581c87", suave: "#e0e7ff" }, // Maestría: índigo → violeta arte
  8: { de: "#e879f9", a: "#f59e0b", profundo: "#78350f", suave: "#fae8ff" }, // Inspiración: magenta → dorado spotlight
  9: { de: "#f59e0b", a: "#78350e", profundo: "#451a03", suave: "#fef3c7" }, // Leyenda: ámbar → bronce hall of fame
};

const BLANCO = "#ffffff";

function Glifo({ nivel }: { nivel: number }) {
  switch (nivel) {
    case 1: // Chispa: destello que parpadea y suelta partículas
      return (
        <g>
          <path
            className="avn-flicker"
            d="M32 12 C33.6 22 38 26.4 48 28 C38 29.6 33.6 34 32 44 C30.4 34 26 29.6 16 28 C26 26.4 30.4 22 32 12 Z"
            fill={BLANCO}
          />
          <circle className="avn-rise" cx="45" cy="45" r="2.4" fill={BLANCO} />
          <circle className="avn-rise avn-d2" cx="19" cy="47" r="1.9" fill={BLANCO} />
        </g>
      );
    case 2: // Impulso: cohete despegando — impulso como despegue
      return (
        <g>
          <g className="avn-float">
            <path
              d="M32 10 C36 16 38 22 38 30 L38 42 L26 42 L26 30 C26 22 28 16 32 10 Z"
              fill={BLANCO}
            />
            <path d="M26 34 L19 47 L26 45 Z" fill={BLANCO} />
            <path d="M38 34 L45 47 L38 45 Z" fill={BLANCO} />
            <path d="M28.5 42 L32 53 L35.5 42 Z" fill={BLANCO} />
          </g>
        </g>
      );
    case 3: // Ritmo: ecualizador que late
      return (
        <g fill={BLANCO}>
          <rect className="avn-eq" x="15" y="25" width="5" height="14" rx="2.5" />
          <rect className="avn-eq avn-d1" x="22.5" y="21" width="5" height="22" rx="2.5" />
          <rect className="avn-eq avn-d2" x="30" y="17" width="5" height="30" rx="2.5" />
          <rect className="avn-eq avn-d3" x="37.5" y="21" width="5" height="22" rx="2.5" />
          <rect className="avn-eq avn-d4" x="45" y="25" width="5" height="14" rx="2.5" />
        </g>
      );
    case 4: // Constancia: órbita — el punto que siempre vuelve
      return (
        <g>
          <circle cx="32" cy="32" r="13" fill="none" stroke={BLANCO} strokeWidth="4" opacity="0.9" />
          <g className="avn-orbit">
            <circle cx="32" cy="19" r="4.5" fill={BLANCO} />
          </g>
          <circle cx="32" cy="32" r="5" fill={BLANCO} />
        </g>
      );
    case 5: // Hábito: el bucle infinito
      return (
        <path
          className="avn-pulse"
          d="M32 32 C32 27.6 28.4 24 24 24 C18.5 24 14 27.6 14 32 C14 36.4 18.5 40 24 40 C28.4 40 32 36.4 32 32
             C32 27.6 35.6 24 40 24 C45.5 24 50 27.6 50 32 C50 36.4 45.5 40 40 40 C35.6 40 32 36.4 32 32 Z"
          fill="none"
          stroke={BLANCO}
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      );
    case 6: // Disciplina: escudo con brillo que lo recorre
      return (
        <g>
          <rect className="avn-shine" x="26" y="4" width="6" height="56" fill={BLANCO} opacity="0.22" />
          <path
            d="M32 11 L46 16.5 V29 C46 39.5 39.5 46 32 50 C24.5 46 18 39.5 18 29 V16.5 Z"
            fill={BLANCO}
            opacity="0.22"
          />
          <path
            d="M32 11 L46 16.5 V29 C46 39.5 39.5 46 32 50 C24.5 46 18 39.5 18 29 V16.5 Z"
            fill="none"
            stroke={BLANCO}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path
            d="M26.5 31.5 L30.5 35.5 L38 27"
            fill="none"
            stroke={BLANCO}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case 7: // Maestría: estrella con destellos
      return (
        <g>
          <path
            className="avn-pulse"
            d="M32 14 L37 26.5 L50.5 27.8 L40.2 36.2 L43.2 49.5 L32 42.8 L20.8 49.5 L23.8 36.2 L13.5 27.8 L27 26.5 Z"
            fill={BLANCO}
          />
          <path
            className="avn-flicker"
            d="M49 11 V17 M46 14 H52"
            stroke={BLANCO}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            className="avn-flicker avn-d2"
            d="M15 44.5 V49.5 M12.5 47 H17.5"
            stroke={BLANCO}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      );
    case 8: // Inspiración: sol radiante que gira
      return (
        <g>
          <g className="avn-spin-slower" stroke={BLANCO} strokeWidth="3.5" strokeLinecap="round">
            <path d="M47 32 H53" />
            <path d="M42.6 42.6 L46.8 46.8" />
            <path d="M32 47 V53" />
            <path d="M21.4 42.6 L17.2 46.8" />
            <path d="M17 32 H11" />
            <path d="M21.4 21.4 L17.2 17.2" />
            <path d="M32 17 V11" />
            <path d="M42.6 21.4 L46.8 17.2" />
          </g>
          <circle className="avn-pulse" cx="32" cy="32" r="9.5" fill={BLANCO} />
        </g>
      );
    default: // 9. Leyenda: corona con resplandor
      return (
        <g>
          <circle className="avn-pulse" cx="32" cy="32" r="28" fill={BLANCO} opacity="0.14" />
          <path d="M15 41 L18.5 25 L25.5 31.5 L32 20 L38.5 31.5 L45.5 25 L49 41 Z" fill={BLANCO} />
          <rect x="15" y="43.5" width="34" height="4.5" rx="2.25" fill={BLANCO} opacity="0.9" />
          <circle className="avn-rise" cx="51" cy="18" r="2.2" fill={BLANCO} />
          <circle className="avn-rise avn-d2" cx="13" cy="20" r="1.8" fill={BLANCO} />
        </g>
      );
  }
}

export function AvatarNivel({
  nivel,
  nombre,
  className,
}: {
  nivel: number;
  nombre: string;
  className?: string;
}) {
  const nv = Math.min(9, Math.max(1, Math.round(nivel) || 1));
  const pal = PALETA[nv];
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `avng${uid}`;
  const cid = `avnc${uid}`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={`Nivel ${nv}: ${nombre}`}
    >
      <title>{`Nivel ${nv}: ${nombre}`}</title>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={pal.de} />
          <stop offset="1" stopColor={pal.a} />
        </linearGradient>
        <clipPath id={cid}>
          <circle cx="32" cy="32" r="29" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="29" fill={`url(#${gid})`} />
      <g clipPath={`url(#${cid})`}>
        <Glifo nivel={nv} />
      </g>
    </svg>
  );
}
