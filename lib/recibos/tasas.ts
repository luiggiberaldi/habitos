/**
 * Tasa para la línea de conversión a bolívares del PDF (Fase 5 Recibos).
 * Portado mínimo de recibera (lib/receipt/rates.ts): Senda ya tiene fin_tasas
 * (BCV/paralelo/USDT); el llamador arma el TasaBs con la tasa elegida.
 */

export interface TasaBs {
  /** Etiqueta visible, p. ej. "BCV" o "Paralelo". */
  etiqueta: string;
  /** Bolívares por 1 unidad de la moneda del recibo. */
  tasa: number;
}

/** Convierte un monto a Bs con la tasa dada (0 si la tasa no sirve). */
export function convertirABs(monto: number, tasa: TasaBs | null): number {
  if (!tasa || !Number.isFinite(tasa.tasa) || tasa.tasa <= 0) return 0;
  const v = monto * tasa.tasa;
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** "Bs 1.234,56" en formato es-VE. */
export function formatearBs(monto: number): string {
  const v = Number.isFinite(monto) ? monto : 0;
  return `Bs ${v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
