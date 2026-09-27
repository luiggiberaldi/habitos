/**
 * Design tokens de Hábitos — fuente única de verdad para la paleta de marca.
 *
 * La paleta nace del logo definitivo (la flama): tres tonos cálidos que van
 * del rojo-llama al dorado. Los roles semánticos (`accent`, `accent-strong`…)
 * viven como variables CSS en `app/globals.css` porque cambian con el tema
 * claro/oscuro; aquí están los valores canónicos de marca y las rampas.
 */

// ── Marca: la flama ──────────────────────────────────────────────────────────
export const brand = {
  /** Rojo llama — lengua superior de la flama. */
  ember: "#F84818",
  /** Naranja — lengua media de la flama. */
  blaze: "#F88808",
  /** Dorado — base de la flama. */
  gold: "#F8B808",
} as const;

/** Degradado de la flama, de arriba hacia abajo (css `background`). */
export const flameGradient =
  "linear-gradient(165deg, #F84818 0%, #F88808 52%, #F8B808 100%)";

/** La flama en horizontal (para banners), de izquierda a derecha. */
export const flameGradientX =
  "linear-gradient(100deg, #F84818 0%, #F88808 52%, #F8B808 100%)";

// ── Rampa cálida (tintes y sombras de la marca) ───────────────────────────────
export const emberScale = {
  50: "#FEF3EE",
  100: "#FDE4D7",
  200: "#FAC6AC",
  300: "#F6A074",
  400: "#F27240",
  500: "#F84818",
  600: "#CE3F14",
  700: "#A93312",
  800: "#7E2710",
  900: "#541A0C",
} as const;

// ── Roles semánticos por tema ─────────────────────────────────────────────────
// (Deben coincidir con las variables CSS de `app/globals.css`.)
export const roles = {
  light: {
    accent: "#CE3F14", // brasas: texto blanco encima con contraste ≥ 4.5
    accentStrong: "#F84818",
    accentSoft: "#F8481816",
    accentForeground: "#FFFFFF",
  },
  dark: {
    accent: "#F88808",
    accentStrong: "#F8B808",
    accentSoft: "#F8880822",
    accentForeground: "#201104",
  },
} as const;

// ── Colores de hábitos (selector de color al crear/editar) ───────────────────
export const habitColors = [
  "#F84818",
  "#F88808",
  "#F8B808",
  "#6366f1",
  "#ef4444",
  "#3b82f6",
  "#a855f7",
  "#22c55e",
];
