import type {
  Receipt,
  ReceiptItem,
  ReceiptTotals,
  ReceiptStatus,
} from "./tipos";

/** Round to 2 decimals safely, avoiding floating point drift and NaN. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Safe numeric parse — empty string / NaN become 0. */
export function safeNum(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const n = typeof value === "string" ? parseFloat(value.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Total for a single line after applying its line discount (%). */
export function lineTotal(item: Pick<ReceiptItem, "quantity" | "unitPrice" | "discount">): number {
  const qty = Math.max(0, safeNum(item.quantity));
  const price = Math.max(0, safeNum(item.unitPrice));
  const disc = clamp(safeNum(item.discount), 0, 100);
  const gross = qty * price;
  const discounted = gross * (1 - disc / 100);
  return round2(discounted);
}

/** Gross amount of a line before discount. */
export function lineGross(item: Pick<ReceiptItem, "quantity" | "unitPrice">): number {
  return round2(Math.max(0, safeNum(item.quantity)) * Math.max(0, safeNum(item.unitPrice)));
}

/** Discount amount applied on a single line (in currency). */
export function lineDiscountAmount(item: Pick<ReceiptItem, "quantity" | "unitPrice" | "discount">): number {
  return round2(lineGross(item) - lineTotal(item));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sum of all line totals (before global discount / tax). */
export function subtotal(items: ReceiptItem[]): number {
  return round2(items.reduce((acc, it) => acc + lineTotal(it), 0));
}

/** Sum of line-level discounts (for transparency in the summary). */
export function lineDiscountsTotal(items: ReceiptItem[]): number {
  return round2(items.reduce((acc, it) => acc + lineDiscountAmount(it), 0));
}

/** Currency amount removed by the global discount (%). */
export function globalDiscountAmount(subtotalValue: number, globalDiscountPct: number): number {
  const pct = clamp(safeNum(globalDiscountPct), 0, 100);
  return round2(subtotalValue * (pct / 100));
}

/** Tax amount over the discounted taxable base. */
export function taxAmount(taxableBase: number, taxPct: number): number {
  const pct = Math.max(0, safeNum(taxPct));
  return round2(taxableBase * (pct / 100));
}

/** Total amount paid across all registered partial payments. */
export function totalPaid(payments: { amount: number }[]): number {
  return round2(payments.reduce((acc, p) => acc + Math.max(0, safeNum(p.amount)), 0));
}

/** Remaining balance = total - totalPaid, never negative. */
export function balanceDue(total: number, paid: number): number {
  return round2(Math.max(0, total - paid));
}

/**
 * Resolve the receipt status from the financial snapshot.
 * - paid: balance <= 0 and total > 0 and paid > 0
 * - partial: 0 < paid < total
 * - pending: paid === 0
 */
export function resolveStatus(total: number, paid: number): ReceiptStatus {
  const t = round2(total);
  const p = round2(paid);
  if (t <= 0) return "pending";
  if (p <= 0) return "pending";
  if (round2(t - p) <= 0) return "paid";
  return "partial";
}

/** Percentage of the total that has been paid (0-100). */
export function paidPercentage(total: number, paid: number): number {
  const t = round2(total);
  if (t <= 0) return 0;
  return clamp(round2((paid / t) * 100), 0, 100);
}

/**
 * Full financial derivation for a receipt.
 * Central, single source of truth used by the form, preview and PDF.
 *
 * When `receipt.declaredTotal > 0`, that value is used as the official total
 * (the itemized breakdown is ignored for the balance computation). This
 * supports "recibo de abono" scenarios for partial / installment payments
 * where the total being paid off is stated directly.
 */
export function computeTotals(receipt: Receipt): ReceiptTotals {
  const declared = safeNum(receipt.declaredTotal);
  const usingDeclared = declared > 0;

  const sub = subtotal(receipt.items);
  const lineDisc = lineDiscountsTotal(receipt.items);
  const globalDisc = globalDiscountAmount(sub, receipt.globalDiscount);
  const taxableBase = round2(sub - globalDisc);
  const tax = taxAmount(taxableBase, receipt.taxRate);
  const itemizedTotal = round2(taxableBase + tax);

  const total = usingDeclared ? round2(declared) : itemizedTotal;
  const paid = totalPaid(receipt.payments);
  const balance = balanceDue(total, paid);
  const status = resolveStatus(total, paid);
  const pct = paidPercentage(total, paid);

  return {
    subtotal: usingDeclared ? total : sub,
    lineDiscountsTotal: usingDeclared ? 0 : lineDisc,
    globalDiscountAmount: usingDeclared ? 0 : globalDisc,
    taxableBase: usingDeclared ? total : taxableBase,
    taxAmount: usingDeclared ? 0 : tax,
    total,
    totalPaid: paid,
    balanceDue: balance,
    status,
    paidPercentage: pct,
    usingDeclaredTotal: usingDeclared,
  };
}
