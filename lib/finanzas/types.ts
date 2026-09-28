/**
 * Finanzas (Fase 1): tipos del libro del hogar.
 *
 * Decisiones: saldos y patrimonio se CALCULAN desde movimientos (nunca se
 * almacenan); todo dato compartido lleva creado_por; sin gamificación.
 */

export type FinMoneda = "USD" | "VES" | "COP" | "USDT";
export type FinTipoCuenta = "efectivo" | "banco" | "cripto" | "otro";
export type FinTipoMov = "ingreso" | "egreso" | "transferencia";

export interface FinCuenta {
  id: string;
  nombre: string;
  moneda: FinMoneda;
  tipo: FinTipoCuenta;
  tasaUsdManual: number | null;
  archivada: boolean;
  hogarId: string | null;
  creadoEn: string;
}

export interface FinCuentaConSaldo extends FinCuenta {
  saldoMoneda: number;
  saldoUsd: number;
  nMovimientos: number;
}

export interface FinMovimiento {
  id: string;
  cuentaId: string;
  cuentaDestinoId: string | null;
  tipo: FinTipoMov;
  categoria: string | null;
  monto: number;
  montoDestino: number | null;
  tasaUsd: number;
  fecha: string; // YYYY-MM-DD
  nota: string | null;
  claveEvento: string | null;
  creadoEn: string;
  anuladoEn: string | null;
  // Joins (opcionales, los trae listarMovimientos):
  cuentaNombre?: string;
  cuentaMoneda?: FinMoneda;
  destinoNombre?: string | null;
}

export interface FinResumenDia {
  fecha: string; // YYYY-MM-DD
  ingresosUsd: number;
  egresosUsd: number;
}

export const MONEDAS: { valor: FinMoneda; etiqueta: string }[] = [
  { valor: "USD", etiqueta: "Dólar ($)" },
  { valor: "VES", etiqueta: "Bolívar (Bs)" },
  { valor: "USDT", etiqueta: "USDT" },
];

export const TIPOS_CUENTA: { valor: FinTipoCuenta; etiqueta: string }[] = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "banco", etiqueta: "Banco" },
  { valor: "cripto", etiqueta: "Cripto" },
  { valor: "otro", etiqueta: "Otra" },
];

export const CATEGORIAS_EGRESO = [
  "comida",
  "mercado",
  "transporte",
  "servicios",
  "vivienda",
  "salud",
  "ocio",
  "ropa",
  "otros",
];

export const CATEGORIAS_INGRESO = ["salario", "ventas", "otros"];
