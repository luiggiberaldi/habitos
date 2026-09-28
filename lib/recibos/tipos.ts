/**
 * Core domain types for Recibos de Senda (Fase 5).
 * Strictly typed, no `any`, safe for production.
 */

export type CurrencyCode = "USD" | "VES" | "COP" | "USDT";

export type PaymentMode = "full" | "partial" | "installments";

export type ReceiptStatus = "pending" | "partial" | "paid";

export type PaymentMethod =
  | "transfer"
  | "mobile"
  | "cash"
  | "zelle"
  | "card"
  | "check"
  | "other";

export interface Issuer {
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  cityCountry: string;
}

export interface Client {
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  company: string;
}

export interface ReceiptItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number; // line discount as percentage (0-100)
  licenseType?: "none" | "monthly" | "lifetime";
  allowedLicenses?: string;
}

export interface PartialPayment {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  method: PaymentMethod;
  reference: string;
  note: string;
  amountBs?: number;
}

export interface ScheduledPayment {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  note?: string;
}

export interface ReceiptMeta {
  number: string;
  issueDate: string; // ISO yyyy-mm-dd
  dueDate: string; // ISO yyyy-mm-dd | ""
  currency: CurrencyCode;
  primaryMethod: PaymentMethod;
  paymentMode: PaymentMode;
  notes: string;
  observations: string;
  thankYouMessage: string;
  /** Number of warranty days (0 = no warranty). */
  warrantyDays: number;
  /** Warranty expiration date (ISO yyyy-mm-dd). Auto-calculated from issueDate + warrantyDays, but editable. */
  warrantyEndDate: string;
  exchangeRate?: number;
  /** Whether to show Bs equivalent prices in the PDF and UI. */
  showBsConversion?: boolean;
  /** Whether to show Bs equivalent in payments/abonos section. */
  showBsInPayments?: boolean;
}

export interface Receipt {
  meta: ReceiptMeta;
  issuer: Issuer;
  client: Client;
  items: ReceiptItem[];
  payments: PartialPayment[];
  scheduledPayments?: ScheduledPayment[];
  globalDiscount: number; // percentage (0-100)
  taxRate: number; // percentage (>=0)
  /**
   * Optional manually-declared total. When > 0 it overrides the itemized
   * total — used for partial-payment / installment receipts where the full
   * amount being paid off is stated directly (e.g. "recibo de abono") rather
   * than built from a line-item breakdown.
   */
  declaredTotal: number;
}

/** Derived, computed financial snapshot of a receipt. */
export interface ReceiptTotals {
  subtotal: number;
  lineDiscountsTotal: number;
  globalDiscountAmount: number;
  taxableBase: number;
  taxAmount: number;
  total: number;
  totalPaid: number;
  balanceDue: number;
  status: ReceiptStatus;
  paidPercentage: number;
  /** True when the total comes from `declaredTotal` (itemized breakdown ignored). */
  usingDeclaredTotal: boolean;
}
