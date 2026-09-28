import { todayIso } from "./formato";

/**
 * Compute the warranty end date from an issue date + number of warranty days.
 * Returns "" if days <= 0 or the issue date is invalid.
 *
 * Timezone-safe: works with ISO date components (yyyy-mm-dd) without relying
 * on the runtime timezone, so the result is identical on server and client.
 */
export function computeWarrantyEndDate(
  issueDate: string,
  warrantyDays: number
): string {
  if (!issueDate || !Number.isFinite(warrantyDays) || warrantyDays <= 0) {
    return "";
  }
  const parts = issueDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "";
  const [year, month, day] = parts;
  // Validate ranges to reject overflow dates like 2026-13-45.
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  // Build a UTC date to avoid timezone drift, then add the days.
  const d = new Date(Date.UTC(year, month - 1, day));
  // Verify the date didn't overflow (e.g. Feb 30 → Mar 2).
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return "";
  }
  d.setUTCDate(d.getUTCDate() + Math.floor(warrantyDays));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Warranty status relative to today. */
export type WarrantyStatus = "none" | "active" | "expiring" | "expired";

export interface WarrantyInfo {
  status: WarrantyStatus;
  /** Days until expiration (negative = already expired). Null when no warranty. */
  daysUntilExpiry: number | null;
  /** Human-readable label (e.g. "Garantía: 90 días", "Vence en 5 días", "Vencida"). */
  label: string;
  /** Whether the warranty is still valid today. */
  isValid: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the warranty status for a receipt.
 *
 * @param warrantyDays   Number of warranty days (0 = no warranty).
 * @param warrantyEndDate Warranty end date (ISO yyyy-mm-dd). Takes precedence
 *                        over warrantyDays when both are present.
 * @param today           Override for testing (ISO yyyy-mm-dd); defaults to today.
 */
export function resolveWarranty(
  warrantyDays: number,
  warrantyEndDate: string,
  today: string = todayIso()
): WarrantyInfo {
  const days = Number.isFinite(warrantyDays) ? warrantyDays : 0;
  const endDate = warrantyEndDate?.trim() || "";

  if (days <= 0 && !endDate) {
    return {
      status: "none",
      daysUntilExpiry: null,
      label: "Sin garantía",
      isValid: false,
    };
  }

  // Use the explicit end date if available, otherwise compute it.
  const effectiveEnd = endDate || computeWarrantyEndDate(today, days);
  if (!effectiveEnd) {
    return {
      status: "none",
      daysUntilExpiry: null,
      label: "Sin garantía",
      isValid: false,
    };
  }

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const endMs = new Date(`${effectiveEnd}T00:00:00Z`).getTime();
  if (Number.isNaN(todayMs) || Number.isNaN(endMs)) {
    return {
      status: "none",
      daysUntilExpiry: null,
      label: "Sin garantía",
      isValid: false,
    };
  }

  const daysUntilExpiry = Math.round((endMs - todayMs) / DAY_MS);
  const isValid = daysUntilExpiry >= 0;

  let status: WarrantyStatus;
  let label: string;

  if (daysUntilExpiry < 0) {
    status = "expired";
    label = `Garantía vencida (hace ${Math.abs(daysUntilExpiry)}d)`;
  } else if (daysUntilExpiry <= 7) {
    status = "expiring";
    label =
      daysUntilExpiry === 0
        ? "Garantía vence hoy"
        : `Garantía vence en ${daysUntilExpiry}d`;
  } else {
    status = "active";
    label = `Garantía: ${days}d (vence en ${daysUntilExpiry}d)`;
  }

  return { status, daysUntilExpiry, label, isValid };
}
