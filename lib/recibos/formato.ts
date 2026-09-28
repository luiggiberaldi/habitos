import type { CurrencyCode, PaymentMethod, ReceiptStatus, PaymentMode } from "./tipos";

const currencyLocale: Record<CurrencyCode, string> = {
  USD: "en-US",
  VES: "es-VE",
  COP: "es-CO",
  USDT: "en-US",
};

const currencySymbol: Record<CurrencyCode, string> = {
  USD: "$",
  VES: "Bs",
  COP: "COP",
  USDT: "USDT",
};

/** Format a numeric amount as currency, 2 decimals, with currency code prefix. */
export function formatCurrency(amount: number, currency: CurrencyCode = "USD"): string {
  const value = Number.isFinite(amount) ? amount : 0;
  if (currency === "USDT") {
    return `${value.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  }
  try {
    return new Intl.NumberFormat(currencyLocale[currency] ?? "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currencySymbol[currency] ?? ""} ${value.toFixed(2)}`;
  }
}

/** Compact currency (no code, just symbol + number) — used inside dense tables. */
export function formatCurrencyCompact(amount: number, currency: CurrencyCode = "USD"): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${currencySymbol[currency] ?? ""}${value.toLocaleString(currencyLocale[currency] ?? "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function currencySymbolOf(currency: CurrencyCode): string {
  return currencySymbol[currency] ?? "";
}

const MONTHS_ES = [
  "ene.",
  "feb.",
  "mar.",
  "abr.",
  "may.",
  "jun.",
  "jul.",
  "ago.",
  "sep.",
  "oct.",
  "nov.",
  "dic.",
];

/**
 * Format an ISO date (yyyy-mm-dd) as a readable, professional date.
 *
 * IMPORTANT: we parse the ISO components manually instead of using
 * `new Date(iso + "T00:00:00")` + `toLocaleDateString`, because the latter
 * depends on the runtime timezone. The server (UTC by default) and the
 * client (America/Caracas) can interpret the same midnight instant on
 * different calendar days, causing a hydration mismatch. By working purely
 * with the string components the result is deterministic across runtimes.
 */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const parts = iso.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "—";
  const [year, month, day] = parts;
  if (month < 1 || month > 12) return "—";
  if (day < 1 || day > 31) return "—";
  return `${String(day).padStart(2, "0")} ${MONTHS_ES[month - 1]} ${year}`;
}

/** Today's date as ISO yyyy-mm-dd (local timezone). */
export function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Transferencia",
  mobile: "Pago móvil",
  cash: "Efectivo",
  zelle: "Zelle",
  card: "Tarjeta",
  check: "Cheque",
  other: "Otro",
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  full: "Pago completo",
  partial: "Pago parcial",
  installments: "Pago en cuotas",
};

export const STATUS_LABELS: Record<ReceiptStatus, string> = {
  pending: "Pendiente",
  partial: "Parcialmente pagado",
  paid: "Pagado",
};

/** Sanitize client name for the PDF filename — safe, readable, no weird chars. */
export function sanitizeForFilename(input: string): string {
  if (!input) return "cliente";
  const noAccents = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const cleaned = noAccents
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return cleaned.slice(0, 40) || "cliente";
}

/** Sanitize a receipt number for a filename. */
export function sanitizeNumberForFilename(number: string): string {
  if (!number) return "000";
  return number
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** Build the canonical PDF filename. */
export function buildPdfFilename(receiptNumber: string, clientName: string): string {
  const num = sanitizeNumberForFilename(receiptNumber) || "000";
  const client = sanitizeForFilename(clientName);
  return `synaptica-recibo-${num}-${client}.pdf`;
}
