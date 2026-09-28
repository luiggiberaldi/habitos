import type { jsPDF } from "jspdf";

// Portado de recibera (Fase 5 Recibos). Se añade el tema `senda`.

export type RGB = [number, number, number];

export type PdfThemeName = "navy" | "emerald" | "charcoal" | "amber" | "violet" | "tech" | "software" | "senda";
export type PdfLayoutName = "classic" | "minimalist";

export interface ThemeColors {
  primary: RGB;
  primaryDeep: RGB;
  primaryLight: RGB;
  accent: RGB;
  accentLight: RGB;
  badgeBg: RGB;
}

export const THEME_PALETTES: Record<PdfThemeName, ThemeColors> = {
  navy: {
    primary: [26, 35, 126],       // Deep navy (#1A237E)
    primaryDeep: [15, 23, 90],    // Deeper navy (#0F175A)
    primaryLight: [232, 234, 246],// Soft navy tint
    accent: [255, 183, 77],       // Warm gold
    accentLight: [255, 243, 224], // Soft gold
    badgeBg: [232, 234, 246],
  },
  emerald: {
    primary: [5, 150, 105],       // Emerald (#059669)
    primaryDeep: [4, 120, 87],    // Deeper green (#047857)
    primaryLight: [209, 250, 229],// Soft emerald tint
    accent: [245, 158, 11],       // Amber gold contrast
    accentLight: [254, 243, 199], // Soft amber
    badgeBg: [209, 250, 229],
  },
  charcoal: {
    primary: [55, 65, 81],        // Slate gray (#374151)
    primaryDeep: [31, 41, 55],    // Near black (#1F2937)
    primaryLight: [243, 244, 246],// Soft slate gray
    accent: [20, 184, 166],       // Teal contrast
    accentLight: [204, 251, 241], // Soft teal
    badgeBg: [243, 244, 246],
  },
  amber: {
    primary: [217, 119, 6],       // Amber (#D97706)
    primaryDeep: [180, 83, 9],    // Deep amber (#B45309)
    primaryLight: [254, 243, 199],// Soft amber tint
    accent: [99, 102, 241],       // Indigo contrast
    accentLight: [224, 231, 255], // Soft indigo
    badgeBg: [254, 243, 199],
  },
  violet: {
    primary: [109, 40, 217],      // Violet (#6D28D9)
    primaryDeep: [91, 33, 182],   // Deep violet (#5B21B6)
    primaryLight: [245, 243, 255],// Soft violet tint
    accent: [244, 63, 94],        // Rose pink contrast
    accentLight: [255, 228, 230], // Soft rose
    badgeBg: [245, 243, 255],
  },
  tech: {
    primary: [26, 36, 56],        // Midnight Slate (#1A2438) - Blue-gray deep from image
    primaryDeep: [16, 23, 38],    // Deep midnight slate (#101726)
    primaryLight: [6, 182, 212],   // Cyan 500 (#06B6D4) - tech accent over dark background
    accent: [6, 182, 212],       // Cyan 500 (#06B6D4)
    accentLight: [207, 250, 254], // Cyan 100 (#CFFAFE)
    badgeBg: [241, 245, 249],     // Slate 100 (#F1F5F9)
  },
  senda: {
    primary: [206, 63, 20],       // Flama ember-600 (#CE3F14)
    primaryDeep: [154, 44, 12],   // Flama profunda
    primaryLight: [254, 237, 227],// Tinte flama suave
    accent: [248, 136, 8],        // Flama blaze (#F88808)
    accentLight: [255, 244, 214], // Tinte dorado suave (#FFF4D6)
    badgeBg: [255, 244, 214],
  },
  software: {
    primary: [15, 16, 38],        // Dark violet-indigo (#0F1026)
    primaryDeep: [8, 9, 23],       // Ultra dark violet (#080917)
    primaryLight: [241, 245, 249],// Slate 100
    accent: [255, 114, 0],        // Electric Orange (#FF7200)
    accentLight: [254, 237, 222], // Soft orange tint (#FFEDD5)
    badgeBg: [254, 237, 222],     // Soft orange tint
  },
};

export function getThemeColors(theme: PdfThemeName): ThemeColors {
  return THEME_PALETTES[theme] || THEME_PALETTES.navy;
}

/**
 * SYNAPTICA brand palette (RGB 0-255) for the PDF document v2.0.
 * Improved contrast: deeper petroleum for headers, lighter panels, stronger
 * accent colors for status badges.
 */
export const C: Record<string, RGB> = {
  // Brand
  navy: [26, 35, 126],           // Deep navy blue (header/footer bands, like reference)
  navyDeep: [15, 23, 90],        // Even deeper navy
  petroleum: [13, 60, 71],       // Petroleum blue (legacy compat)
  petroleumDeep: [8, 40, 48],    // Deep petroleum (legacy compat)
  petroleumLight: [27, 80, 95],  // Lighter petroleum
  teal: [0, 151, 167],           // Teal accent
  gold: [255, 183, 77],          // Gold accent (circles in header/footer)

  // Text
  ink: [17, 24, 39],             // Near-black for primary text (strong contrast)
  body: [55, 65, 81],            // Dark gray for secondary text
  muted: [107, 114, 128],        // Medium gray for labels
  faint: [156, 163, 175],        // Light gray for hints

  // Backgrounds
  white: [255, 255, 255],
  panel: [248, 250, 252],        // Very light gray for panels
  panelWarm: [243, 248, 248],    // Light teal-tinted panel
  border: [226, 232, 240],       // Light border
  borderDark: [203, 213, 225],   // Slightly darker border

  // Status colors (stronger contrast)
  emerald: [255, 114, 0],        // Paid / valid warranty (Changed from green to brand orange)
  emeraldBg: [254, 237, 222],    // Light brand orange background
  amber: [217, 119, 6],          // Pending / expiring
  amberBg: [255, 251, 235],      // Light amber background
  sky: [2, 132, 199],            // Partial payment
  skyBg: [240, 249, 255],        // Light blue background
  red: [220, 38, 38],            // Overdue / expired warranty
  redBg: [254, 242, 242],        // Light red background
};

/** A4 page dimensions in mm. */
export const PAGE = { w: 210, h: 297 };

/** Document margins in mm. */
export const M = { left: 14, right: 14, top: 16 };

/** Vertical cursor shared across draw functions. */
export interface Cursor {
  y: number;
}

export function setFill(doc: jsPDF, rgb: RGB): void {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

export function setStroke(doc: jsPDF, rgb: RGB): void {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

export function setTextColor(doc: jsPDF, rgb: RGB): void {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

export function roundRect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  style: "F" | "S" = "F"
): void {
  doc.roundedRect(x, y, w, h, r, r, style);
}

/** Filter out empty/undefined lines, returning a clean string array. */
export function compactLines(lines: (string | undefined)[]): string[] {
  return lines.filter((l): l is string => Boolean(l && l.trim()));
}

/** Safe numeric to string, treating NaN as 0. */
export function formatNum(n: number): string {
  return Number.isFinite(n) ? String(n) : "0";
}
