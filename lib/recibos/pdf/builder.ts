import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Receipt, ReceiptTotals } from "../tipos";
import {
  computeTotals,
  lineTotal,
  lineGross,
} from "../calculos";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODE_LABELS,
  STATUS_LABELS,
} from "../formato";
import {
  C,
  PAGE,
  M,
  type Cursor,
  type RGB,
  type PdfThemeName,
  type PdfLayoutName,
  type ThemeColors,
  getThemeColors,
  setFill,
  setStroke,
  setTextColor,
  roundRect,
  compactLines,
  formatNum,
} from "./shared";
import {
  convertirABs,
  formatearBs,
  type TasaBs,
} from "../tasas";
import { resolveWarranty } from "../garantia";
import { SENDA_LOGO_BASE64 } from "./logo";

interface BuildPdfOptions {
  bsRate?: TasaBs | null;
  theme?: PdfThemeName;
  layout?: PdfLayoutName;
  logoLabel?: string;
  /** Texto de marca del encabezado (defecto "SENDA"). */
  marca?: string;
  /** Subtítulo bajo la marca (defecto "Comprobante de pago"). */
  subtitulo?: string;
  /** Si el recibo está anulado: marca de agua ANULADO. */
  anulado?: boolean;
}

/**
 * PDF v3 — Premium redesign.
 * Compact header, clean typography, logical proportions, thin dividers,
 * highlighted totals. Designed to feel like a serious corporate document.
 */
export function buildReceiptPdf(
  receipt: Receipt,
  options: BuildPdfOptions = {}
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const totals = computeTotals(receipt);
  const cursor: Cursor = { y: 0 };
  const bsRate = options.bsRate ?? null;
  const theme = options.theme ?? "navy";
  const layout = options.layout ?? "classic";

  const themeColors = getThemeColors(theme);

  drawHeader(doc, receipt, totals, cursor, themeColors, layout, options.marca ?? "SENDA", options.subtitulo ?? "Comprobante de pago");
  drawParties(doc, receipt, cursor, themeColors);
  drawDivider(doc, cursor);
  if (!totals.usingDeclaredTotal || hasValidItems(receipt)) {
    drawItemsTable(doc, receipt, cursor, themeColors, layout);
  }
  drawPaymentsAndSummary(doc, receipt, totals, cursor, bsRate, themeColors, layout);
  drawScheduledPayments(doc, receipt, cursor, themeColors);
  drawNotes(doc, receipt, cursor, themeColors);
  drawWarranty(doc, receipt, cursor, themeColors);
  drawSignature(doc, receipt, cursor, totals, themeColors);
  drawWatermark(doc, totals, themeColors, options.anulado ?? false);
  drawFooter(doc, receipt, totals, themeColors, layout, options.logoLabel);

  return doc;
}

function hasValidItems(receipt: Receipt): boolean {
  return receipt.items.some(
    (it) => it.description.trim() !== "" || Number(it.unitPrice) > 0
  );
}

/** Thin horizontal divider line across the content width. */
function drawDivider(doc: jsPDF, cursor: Cursor) {
  setStroke(doc, C.border);
  doc.setLineWidth(0.2);
  doc.line(M.left, cursor.y, PAGE.w - M.right, cursor.y);
  cursor.y += 5;
}

/* ============================================================
   HEADER — Dynamic theme and layout support, clean layout
   ============================================================ */
function drawHeader(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor,
  themeColors: ThemeColors,
  layout: PdfLayoutName,
  marca: string = "SENDA",
  subtitulo: string = "Comprobante de pago"
) {
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const isMinimalist = layout === "minimalist" && !isSoftware;
  const bandH = 28;

  if (isMinimalist) {
    // Top colored thin line for brand accent
    setFill(doc, themeColors.primary);
    doc.rect(0, 0, PAGE.w, 1.2, "F");

    // Logo mark (left) - sized 22mm
    drawLogoMark(doc, M.left + 2, 3, 22, themeColors, true);

    // Title & Subtitle side-by-side with logo
    setTextColor(doc, C.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.text(marca, M.left + 27, 12.5);

    setTextColor(doc, themeColors.accent);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(subtitulo, M.left + 27, 17.5);
  } else {
    // Full-width colored band - height reduced to 28mm
    setFill(doc, themeColors.primary);
    doc.rect(0, 0, PAGE.w, bandH, "F");

    // If software theme with diagonals, draw cyan diagonal accent shapes
    if (isSoftware) {
      setFill(doc, themeColors.accent);
      // Cyan polygon (trapezoid) crossing the left corner using standard shapes
      doc.rect(0, 0, 8, bandH, "F");
      doc.triangle(8, 0, 24, 0, 8, bandH, "F");

      // Soft white separator line over polygon
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.3);
      doc.line(24, 0, 8, bandH);
    }

    // Logo mark (left) - sized 22mm
    drawLogoMark(doc, M.left + 5, 3, 22, themeColors, false);

    // Title & Subtitle centered in header
    if (isSoftware) {
      setTextColor(doc, C.white);
      doc.setFont("times", "bold");
      doc.setFontSize(22);
      doc.text("RECIBO", PAGE.w / 2, 16.5, { align: "center" });

      setTextColor(doc, [241, 245, 249]); // Slate 100
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(subtitulo, PAGE.w / 2, 22.5, { align: "center" });
    } else {
      setTextColor(doc, C.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.text(marca, M.left + 30, 12.5);

      setTextColor(doc, [241, 245, 249]); // Slate 100
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(subtitulo, M.left + 30, 17.5);
    }

    // Accent line (Cyan/Accent color) at the bottom border of the band (0.8mm thick)
    setFill(doc, themeColors.accent);
    doc.rect(0, bandH, PAGE.w, 0.8, "F");
  }

  // Right side: receipt number + status pill (vertically aligned)
  const rightX = PAGE.w - M.right;
  const rightYText = isMinimalist ? 9.5 : 9;
  const rightYNum = isMinimalist ? 15 : 14.5;
  const rightYStatus = isMinimalist ? 21 : 20;

  if (isSoftware && !isMinimalist) {
    // Serif styling for receipt number (e.g. Nº 002 instead of whole string)
    doc.setFont("times", "bold");
    doc.setFontSize(22);
    setTextColor(doc, C.white);
    const shortNum = receipt.meta.number.includes("-") 
      ? receipt.meta.number.split("-").slice(-1)[0] 
      : receipt.meta.number;
    doc.text(`Nº ${shortNum}`, rightX, 16.5, { align: "right" });

    // Draw status pill below the title
    drawStatusPill(doc, totals.status, rightX, 22.5, themeColors);
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setTextColor(doc, isMinimalist ? C.muted : themeColors.primaryLight);
    doc.text("Nº RECIBO", rightX, rightYText, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setTextColor(doc, isMinimalist ? themeColors.primary : C.white);
    doc.text(receipt.meta.number || "—", rightX, rightYNum, { align: "right" });

    // Status pill
    drawStatusPill(doc, totals.status, rightX, rightYStatus, themeColors);
  }

  // Meta info row (below the header)
  cursor.y = isMinimalist ? 30 : bandH + 6;
  drawMetaInfo(doc, receipt, cursor);
}

function drawLogoMark(
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
  themeColors: ThemeColors,
  isMinimalist: boolean
) {
  try {
    doc.addImage(SENDA_LOGO_BASE64, "PNG", x, y, size, size, undefined, "FAST");
  } catch (error) {
    console.error("Error drawing logo image on PDF:", error);
    const r = size;
    // Fallback: Background circle
    const bgColors = isMinimalist ? themeColors.primaryLight : themeColors.primaryDeep;
    setFill(doc, bgColors);
    roundRect(doc, x, y, r, r, 2, "F");

    // Fallback: Accent ring
    setStroke(doc, themeColors.accent);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, r, r, 2, 2, "S");

    // Fallback: Synapse nodes
    setFill(doc, themeColors.accent);
    doc.circle(x + r * 0.3, y + r * 0.3, 1, "F");
    setFill(doc, isMinimalist ? themeColors.primary : C.white);
    doc.circle(x + r * 0.7, y + r * 0.3, 0.7, "F");
    doc.circle(x + r * 0.5, y + r * 0.72, 1, "F");

    setStroke(doc, themeColors.accent);
    doc.setLineWidth(0.3);
    doc.line(x + r * 0.3, y + r * 0.3, x + r * 0.7, y + r * 0.3);
    doc.line(x + r * 0.7, y + r * 0.3, x + r * 0.5, y + r * 0.72);
    doc.line(x + r * 0.3, y + r * 0.3, x + r * 0.5, y + r * 0.72);
  }
}

function drawStatusPill(
  doc: jsPDF,
  status: ReceiptTotals["status"],
  rightX: number,
  y: number,
  themeColors: ThemeColors
) {
  const label = STATUS_LABELS[status].toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  const textW = doc.getTextWidth(label);
  const padX = 4;
  const w = textW + padX * 2;
  const h = 5.5;

  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const bgColor =
    status === "paid" ? (isSoftware ? themeColors.accentLight : C.emeraldBg) : status === "partial" ? C.skyBg : C.amberBg;
  const textColor =
    status === "paid" ? (isSoftware ? themeColors.accent : C.emerald) : status === "partial" ? C.sky : C.amber;

  setFill(doc, bgColor);
  roundRect(doc, rightX - w, y - h + 1, w, h, 2.5, "F");
  setTextColor(doc, textColor);
  doc.text(label, rightX - padX, y - 0.5, { align: "right" });
}

function drawMetaInfo(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor
) {
  const barW = PAGE.w - M.left - M.right;
  const barH = 10;
  const y = cursor.y;

  // Soft background bar
  setFill(doc, [248, 250, 252] as RGB); // Slate-50 background tint
  roundRect(doc, M.left, y - 4, barW, barH, 2, "F");

  // Very subtle border
  setStroke(doc, C.border as RGB);
  doc.setLineWidth(0.15);
  doc.roundedRect(M.left, y - 4, barW, barH, 2, 2, "S");

  const colW = barW / 4;
  const drawField = (label: string, value: string, x: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    setTextColor(doc, C.muted as RGB);
    doc.text(label.toUpperCase(), x + 4, y - 1);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, C.ink as RGB);
    doc.text(value, x + 4, y + 3);
  };

  drawField("Emisión", formatDate(receipt.meta.issueDate), M.left);
  drawField(
    "Vencimiento",
    receipt.meta.dueDate ? formatDate(receipt.meta.dueDate) : "—",
    M.left + colW
  );
  drawField(
    "Modalidad",
    PAYMENT_MODE_LABELS[receipt.meta.paymentMode],
    M.left + colW * 2
  );
  drawField(
    "Moneda",
    receipt.meta.currency,
    M.left + colW * 3
  );

  cursor.y = y + barH - 2;
}

/* ============================================================
   WARRANTY — Colored badge with status, prominent
   ============================================================ */
function drawWarranty(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  themeColors: ThemeColors
) {
  const days = receipt.meta.warrantyDays ?? 0;
  const endDate = receipt.meta.warrantyEndDate ?? "";
  if (days <= 0 && !endDate) return;

  const warranty = resolveWarranty(days, endDate);
  if (warranty.status === "none") return;

  const ensureSpace = (needed: number) => {
    if (cursor.y + needed > PAGE.h - 50) {
      doc.addPage();
      cursor.y = M.top;
    }
  };
  ensureSpace(12);

  let accent: RGB = C.body;
  let accentBg: RGB = [241, 245, 249];
  let statusLabel = "Vigente";
  
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  if (warranty.status === "active") {
    accent = isSoftware ? themeColors.accent : C.emerald;
    accentBg = isSoftware ? themeColors.accentLight : [209, 250, 229];
    statusLabel = "GARANTÍA VIGENTE";
  } else if (warranty.status === "expiring") {
    accent = C.amber;
    accentBg = [254, 243, 199];
    statusLabel = "GARANTÍA POR VENCER";
  } else if (warranty.status === "expired") {
    accent = C.red;
    accentBg = [254, 226, 226];
    statusLabel = "GARANTÍA VENCIDA";
  }

  // Badge background
  const badgeW = PAGE.w - M.left - M.right;
  const badgeH = 9;
  setFill(doc, accentBg);
  roundRect(doc, M.left, cursor.y, badgeW, badgeH, 2, "F");

  // Left accent strip
  setFill(doc, accent);
  roundRect(doc, M.left, cursor.y, 2.5, badgeH, 1.5, "F");

  // Status label (Bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, accent);
  const statusWidth = doc.getTextWidth(statusLabel);
  doc.text(statusLabel, M.left + 6, cursor.y + 5.8);

  // Detail text (Normal)
  const detail = `${days} días${endDate ? `  ·  Vence el ${formatDate(endDate)}` : ""}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setTextColor(doc, C.body);
  doc.text(detail, M.left + 6 + statusWidth + 4, cursor.y + 5.8);

  cursor.y += badgeH + 3;
}

/* ============================================================
   SCHEDULED PAYMENTS — Calendar of upcoming installments
   ============================================================ */
function drawScheduledPayments(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  themeColors: ThemeColors
) {
  const scheduled = receipt.scheduledPayments;
  if (!scheduled || scheduled.length === 0) return;
  if (receipt.meta.paymentMode !== "installments") return;

  const ensureSpace = (needed: number) => {
    if (cursor.y + needed > PAGE.h - 50) {
      doc.addPage();
      cursor.y = M.top;
    }
  };

  ensureSpace(10 + scheduled.length * 7);
  cursor.y += 3;

  // Section header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, themeColors.primary);
  doc.text("CALENDARIO DE CUOTAS PENDIENTES", M.left, cursor.y);
  cursor.y += 5;

  // Sort by date
  const sorted = [...scheduled].sort((a, b) => a.date.localeCompare(b.date));
  let total = 0;

  sorted.forEach((sp, i) => {
    ensureSpace(8);
    const isEven = i % 2 === 0;
    const rowH = 6.5;
    const rowW = PAGE.w - M.left - M.right;

    // Alternating background
    if (isEven) {
      setFill(doc, [255, 251, 235] as RGB);
      doc.rect(M.left, cursor.y - 4, rowW, rowH, "F");
    }

    // Index
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, C.amber);
    doc.text(`${i + 1}.`, M.left + 1, cursor.y);

    // Date
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setTextColor(doc, C.ink);
    doc.text(formatDate(sp.date), M.left + 7, cursor.y);

    // Note
    if (sp.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      setTextColor(doc, C.muted);
      doc.text(sp.note, M.left + 35, cursor.y);
    }

    // Amount (right-aligned)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setTextColor(doc, themeColors.primaryDeep);
    doc.text(
      formatCurrency(sp.amount, receipt.meta.currency),
      PAGE.w - M.right,
      cursor.y,
      { align: "right" }
    );

    total += sp.amount;
    cursor.y += rowH;
  });

  // Total line
  setStroke(doc, C.borderDark as RGB);
  doc.setLineWidth(0.2);
  doc.line(M.left, cursor.y, PAGE.w - M.right, cursor.y);
  cursor.y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setTextColor(doc, C.muted as RGB);
  doc.text("Total cuotas pendientes", M.left, cursor.y);
  setTextColor(doc, themeColors.primary);
  doc.text(
    formatCurrency(total, receipt.meta.currency),
    PAGE.w - M.right,
    cursor.y,
    { align: "right" }
  );

  cursor.y += 6;
}

/* ============================================================
   PARTIES — Plain text, clean hierarchy, no boxes
   ============================================================ */
function drawParties(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  themeColors: ThemeColors
) {
  const ensureSpace = (needed: number) => {
    if (cursor.y + needed > PAGE.h - 50) {
      doc.addPage();
      cursor.y = M.top;
    }
  };
  ensureSpace(40);

  cursor.y += 4;
  const startY = cursor.y;

  const colW = (PAGE.w - M.left - M.right) / 2;
  const cardW = colW - 3;
  const cardH = 34;

  // --- LEFT CARD: FACTURADO A ---
  const leftX = M.left;
  // Shaded background
  setFill(doc, [248, 250, 252] as RGB);
  roundRect(doc, leftX, startY, cardW, cardH, 2.5, "F");

  // Subtle border
  setStroke(doc, C.border as RGB);
  doc.setLineWidth(0.15);
  doc.roundedRect(leftX, startY, cardW, cardH, 2.5, 2.5, "S");

  // Left accent line
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const accentColor = isSoftware ? themeColors.accent : C.emerald;
  setFill(doc, accentColor);
  roundRect(doc, leftX, startY + 4, 1.8, 10, 0.8, "F");

  // Label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  setTextColor(doc, themeColors.primary);
  doc.text("FACTURADO A", leftX + 4.5, startY + 8);

  const clientLines = compactLines([
    receipt.client.name || "—",
    receipt.client.company,
    receipt.client.taxId ? `RIF/C.I: ${receipt.client.taxId}` : undefined,
    receipt.client.phone ? `Tlf: ${receipt.client.phone}` : undefined,
    receipt.client.email,
    receipt.client.city,
    receipt.client.address,
  ]);

  // Name (Bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setTextColor(doc, C.ink as RGB);
  doc.text(clientLines[0] || "—", leftX + 4.5, startY + 14);

  // Other details
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setTextColor(doc, C.body as RGB);
  let ly = startY + 18.5;
  for (let i = 1; i < clientLines.length; i++) {
    if (ly > startY + cardH - 3) break;
    const text = clientLines[i];
    const truncated = doc.splitTextToSize(text, cardW - 8);
    doc.text(truncated[0], leftX + 4.5, ly);
    ly += 3.8;
  }

  // --- RIGHT CARD: EMITIDO POR ---
  const rightX = M.left + colW + 3;
  // Shaded background
  setFill(doc, [248, 250, 252] as RGB);
  roundRect(doc, rightX, startY, cardW, cardH, 2.5, "F");

  // Subtle border
  setStroke(doc, C.border as RGB);
  doc.setLineWidth(0.15);
  doc.roundedRect(rightX, startY, cardW, cardH, 2.5, 2.5, "S");

  // Left accent line
  setFill(doc, themeColors.primaryDeep);
  roundRect(doc, rightX, startY + 4, 1.8, 10, 0.8, "F");

  // Label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  setTextColor(doc, themeColors.primaryDeep);
  doc.text("EMITIDO POR", rightX + 4.5, startY + 8);

  const issuerLines = compactLines([
    receipt.issuer.name,
    receipt.issuer.taxId ? `RIF: ${receipt.issuer.taxId}` : undefined,
    receipt.issuer.phone ? `Tlf: ${receipt.issuer.phone}` : undefined,
    receipt.issuer.email,
    receipt.issuer.address,
    receipt.issuer.cityCountry,
  ]);

  // Name (Bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setTextColor(doc, C.ink as RGB);
  doc.text(issuerLines[0] || "—", rightX + 4.5, startY + 14);

  // Other details
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setTextColor(doc, C.body as RGB);
  ly = startY + 18.5;
  for (let i = 1; i < issuerLines.length; i++) {
    if (ly > startY + cardH - 3) break;
    const text = issuerLines[i];
    const truncated = doc.splitTextToSize(text, cardW - 8);
    doc.text(truncated[0], rightX + 4.5, ly);
    ly += 3.8;
  }

  cursor.y = startY + cardH + 4;
}

/* ============================================================
   ITEMS TABLE — Logical proportions, navy header, clean rows
   ============================================================ */
function drawItemsTable(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  themeColors: ThemeColors,
  layout: PdfLayoutName
) {
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const isMinimalist = layout === "minimalist" && !isSoftware;

  // Section label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, themeColors.primary);
  doc.text("CONCEPTOS", M.left, cursor.y);
  cursor.y += 3;

  // Only show the "Desc." column if at least one item has a discount > 0
  const hasAnyDiscount = receipt.items.some((it) => it.discount > 0);

  const head = hasAnyDiscount
    ? ["Descripción", "Cant.", "P. unit.", "Desc.", "Total"]
    : ["Descripción", "Cant.", "P. unit.", "Total"];

  const body = receipt.items
    .filter((it) => it.description || it.quantity > 0 || it.unitPrice > 0)
    .map((it) => {
      const total = lineTotal(it);
      const gross = lineGross(it);
      const totalStr =
        it.discount > 0 && gross > 0
          ? `${formatCurrencyCompact(total, receipt.meta.currency)}\n${formatCurrencyCompact(gross, receipt.meta.currency)}`
          : formatCurrencyCompact(total, receipt.meta.currency);

      let desc = it.description || "—";
      if (it.licenseType === "monthly") {
        desc += "\n[Licencia Mensual]";
      } else if (it.licenseType === "lifetime") {
        desc += "\n[Licencia Permanente / Vitalicia]";
      }

      if (hasAnyDiscount) {
        const disc = it.discount > 0 ? `${formatNum(it.discount)}%` : "—";
        return [
          desc,
          formatNum(it.quantity),
          formatCurrencyCompact(it.unitPrice, receipt.meta.currency),
          disc,
          totalStr,
        ];
      }
      return [
        desc,
        formatNum(it.quantity),
        formatCurrencyCompact(it.unitPrice, receipt.meta.currency),
        totalStr,
      ];
    });

  if (body.length === 0) {
    body.push(
      hasAnyDiscount
        ? ["Sin conceptos registrados", "", "", "", ""]
        : ["Sin conceptos registrados", "", "", ""]
    );
  }

  const columnStyles: Record<number, unknown> = hasAnyDiscount
    ? {
        0: { cellWidth: "auto" },
        1: { cellWidth: 16, halign: "right" },
        2: { cellWidth: 26, halign: "right" },
        3: { cellWidth: 18, halign: "right" },
        4: { cellWidth: 32, halign: "right", fontStyle: "bold" },
      }
    : {
        0: { cellWidth: "auto" },
        1: { cellWidth: 18, halign: "right" },
        2: { cellWidth: 30, halign: "right" },
        3: { cellWidth: 36, halign: "right", fontStyle: "bold" },
      };

  const headStyles = isMinimalist
    ? {
        fillColor: C.panel as RGB,
        textColor: C.ink as RGB,
        fontStyle: "bold",
        fontSize: 7,
        cellPadding: 3,
        lineColor: C.border as RGB,
        lineWidth: 0.2,
      }
    : {
        fillColor: themeColors.primary,
        textColor: C.white as RGB,
        fontStyle: "bold",
        fontSize: 7,
        cellPadding: 3,
        lineColor: themeColors.primary,
        lineWidth: 0.1,
      };

  autoTable(doc, {
    startY: cursor.y,
    head: [head],
    body,
    theme: isMinimalist ? "plain" : "striped",
    margin: { left: M.left, right: M.right },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3,
      textColor: C.ink as RGB,
      lineColor: C.border as RGB,
      lineWidth: 0.1,
      valign: "middle",
    },
    headStyles: headStyles as never,
    alternateRowStyles: isMinimalist ? undefined : { fillColor: C.panel as RGB },
    columnStyles: columnStyles as never,
    didParseCell: (data) => {
      const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
      if (data.section === "head" && !isMinimalist && isSoftware) {
        if (data.column.index === 0) {
          data.cell.styles.fillColor = themeColors.accent;
        } else {
          data.cell.styles.fillColor = themeColors.primaryDeep;
        }
      }
    }
  });

  // @ts-expect-error lastAutoTable is added by the plugin at runtime
  cursor.y = (doc.lastAutoTable?.finalY ?? cursor.y) + 5;
}

/* ============================================================
   PAYMENTS + SUMMARY — Side by side, clean cards
   ============================================================ */
function drawPaymentsAndSummary(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor,
  bsRate: TasaBs | null,
  themeColors: ThemeColors,
  layout: PdfLayoutName
) {
  const colW = (PAGE.w - M.left - M.right - 5) / 2;
  const ensureSpace = (needed: number) => {
    if (cursor.y + needed > PAGE.h - 40) {
      doc.addPage();
      cursor.y = M.top;
    }
  };

  const paymentsH = paymentsPanelHeight(receipt);
  const summaryH = summaryBoxHeight(totals, bsRate, layout);
  const maxH = Math.max(paymentsH, summaryH);

  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const isMinimalist = layout === "minimalist" && !isSoftware;
  const boxH = isMinimalist ? maxH + 2 : maxH + 6;

  ensureSpace(boxH + 10);
  const startY = cursor.y;

  // Payments (left)
  drawPaymentsPanel(doc, receipt, totals, M.left, startY, colW, boxH, themeColors, layout);

  // Summary (right) — bordered box with highlighted total
  drawSummaryBox(
    doc,
    totals,
    receipt.meta.currency,
    M.left + colW + 5,
    startY,
    colW,
    boxH,
    bsRate,
    themeColors,
    layout
  );

  cursor.y = startY + boxH + 6;
}

function paymentsPanelHeight(receipt: Receipt): number {
  let h = 10;
  if (receipt.payments.length === 0) {
    h += 20;
  } else {
    const showBs = receipt.meta.showBsInPayments ?? true;
    receipt.payments.forEach((p) => {
      h += (showBs && p.amountBs && p.amountBs > 0) ? 10.5 : 8.5;
    });
    h += 12;
  }
  return h;
}

function drawPaymentsPanel(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  x: number,
  y: number,
  w: number,
  boxH: number,
  themeColors: ThemeColors,
  layout: PdfLayoutName
) {
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const isMinimalist = layout === "minimalist" && !isSoftware;

  if (isMinimalist) {
    // Section label without colored band
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, themeColors.primary);
    doc.text(`PAGOS REGISTRADOS (${receipt.payments.length})`, x, y);

    // Minimalist main box
    setFill(doc, C.white as RGB);
    setStroke(doc, C.border as RGB);
    doc.setLineWidth(0.2);
    roundRect(doc, x, y + 2, w, boxH, 1.5, "F");
    doc.roundedRect(x, y + 2, w, boxH, 1.5, 1.5, "S");
  } else {
    // Draw unified background box
    setFill(doc, C.panel as RGB);
    roundRect(doc, x, y, w, boxH, 2, "F");

    // Draw solid header bar
    setFill(doc, themeColors.primaryDeep);
    roundRect(doc, x, y, w, 7, 2, "F");
    doc.rect(x, y + 4, w, 3, "F");

    // Header text
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, C.white as RGB);
    doc.text(`PAGOS REGISTRADOS (${receipt.payments.length})`, x + 4, y + 4.5);
  }

  let py = y + (isMinimalist ? 11 : 14);
  const labelX = x + 4;
  const valueX = x + w - 4;

  if (receipt.payments.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    setTextColor(doc, C.faint as RGB);
    doc.text("No se han registrado abonos.", labelX, py);
    doc.text("Recibo emitido como PENDIENTE.", labelX, py + 4);

    if (totals.totalPaid > 0) {
      drawTotalAbonado(doc, receipt, totals, x, y, w, boxH, y + boxH - 6, themeColors, false);
    }
    return;
  }

  const showBs = receipt.meta.showBsInPayments ?? true;

  receipt.payments.forEach((p, i) => {
    if (i > 0) {
      setStroke(doc, C.border as RGB);
      doc.setLineWidth(0.1);
      doc.line(x + 2, py - 4.5, x + w - 2, py - 4.5);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, C.ink as RGB);
    doc.text(PAYMENT_METHOD_LABELS[p.method], labelX, py);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setTextColor(doc, C.muted as RGB);
    const dateText = formatDate(p.date);
    const refText = p.reference ? ` · Ref: ${p.reference}` : "";
    doc.text(`${dateText}${refText}`, labelX, py + 3.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, themeColors.primaryDeep);
    
    let amtText = formatCurrency(p.amount, receipt.meta.currency);
    if (showBs && p.amountBs && p.amountBs > 0) {
      amtText += `\nBs ${p.amountBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    doc.text(amtText, valueX, py, { align: "right" });

    py += (showBs && p.amountBs && p.amountBs > 0) ? 10.5 : 8.5;
  });

  drawTotalAbonado(doc, receipt, totals, x, y, w, boxH, y + boxH - 6, themeColors, showBs);
}

function drawTotalAbonado(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  x: number,
  y: number,
  w: number,
  boxH: number,
  py: number,
  themeColors: ThemeColors,
  showBs: boolean
) {
  const valueX = x + w - 4;
  const labelX = x + 4;
  
  setStroke(doc, C.borderDark as RGB);
  doc.setLineWidth(0.2);
  doc.line(x + 2, py - 2.5, x + w - 2, py - 2.5);

  py += 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, C.muted as RGB);
  doc.text("Total abonado", labelX, py);
  
  setTextColor(doc, themeColors.primaryDeep);

  let totalPaidText = formatCurrency(totals.totalPaid, receipt.meta.currency);
  if (showBs) {
    const totalPaidBs = receipt.payments.reduce((acc, curr) => acc + (curr.amountBs ?? 0), 0);
    if (totalPaidBs > 0) {
      totalPaidText += ` / Bs ${totalPaidBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  doc.text(
    totalPaidText,
    valueX,
    py,
    { align: "right" }
  );
}

/* ============================================================
   SUMMARY BOX — Bordered box, highlighted TOTAL in theme color
   ============================================================ */
function summaryBoxHeight(
  totals: ReceiptTotals,
  bsRate: TasaBs | null,
  layout: PdfLayoutName
): number {
  const isMinimalist = layout === "minimalist";
  let currentY = isMinimalist ? 11 : 14;

  const simulateRow = (bsAmount: number | null, isLarge?: boolean) => {
    currentY += isLarge ? 7 : 5.5;
    if (bsRate && bsAmount !== null && bsAmount > 0) {
      currentY += 3;
    }
  };

  if (!totals.usingDeclaredTotal) {
    // Subtotal
    simulateRow(totals.subtotal);
    // Descuentos línea
    if (totals.lineDiscountsTotal > 0) simulateRow(totals.lineDiscountsTotal);
    // Descuento global
    if (totals.globalDiscountAmount > 0) simulateRow(totals.globalDiscountAmount);
    // Impuesto
    if (totals.taxAmount > 0) simulateRow(totals.taxAmount);
  }

  // Divisor antes del total
  currentY += 5.5;

  // Total
  simulateRow(totals.total, true);

  // Total abonado
  if (totals.totalPaid > 0) {
    currentY += 1;
    simulateRow(totals.totalPaid);
  }

  // Saldo pendiente
  if (totals.balanceDue > 0 || totals.totalPaid > 0) {
    currentY += 1;
    simulateRow(totals.balanceDue);
  }

  if (bsRate) {
    currentY += 2; // margen antes de la nota
    currentY += 4; // alto estimado de la nota
  }

  // Margen de padding inferior
  currentY += 3.5;

  const boxStartY = isMinimalist ? 2 : 6;
  return currentY - boxStartY;
}

function drawSummaryBox(
  doc: jsPDF,
  totals: ReceiptTotals,
  currency: Receipt["meta"]["currency"],
  x: number,
  y: number,
  w: number,
  boxH: number,
  bsRate: TasaBs | null,
  themeColors: ThemeColors,
  layout: PdfLayoutName
) {
  const isMinimalist = layout === "minimalist";
  const boxY = y;

  if (isMinimalist) {
    // Section label without colored band
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, themeColors.primary);
    doc.text("RESUMEN", x, y);

    // Minimalist main box (white background with very light border)
    setFill(doc, C.white as RGB);
    setStroke(doc, C.border as RGB);
    doc.setLineWidth(0.2);
    roundRect(doc, x, y + 2, w, boxH, 1.5, "F");
    doc.roundedRect(x, y + 2, w, boxH, 1.5, 1.5, "S");
  } else {
    // Draw unified background box first
    setFill(doc, C.panel as RGB);
    roundRect(doc, x, boxY, w, boxH, 2, "F");

    // Draw solid header bar (rounded on top, straight on bottom)
    setFill(doc, themeColors.primary);
    roundRect(doc, x, boxY, w, 7, 2, "F");
    doc.rect(x, boxY + 4, w, 3, "F"); // straightens the bottom curve of the header

    // Header text
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, C.white as RGB);
    doc.text("RESUMEN", x + 4, boxY + 4.5);
  }

  let ry = y + (isMinimalist ? 11 : 14);
  const labelX = x + 4;
  const valueX = x + w - 5; // más margen derecho

  const row = (
    label: string,
    value: string,
    bsAmount: number | null,
    opts?: { bold?: boolean; color?: RGB; large?: boolean; bg?: RGB }
  ) => {
    // Optional row background highlight (pill style with inner margins so it never leaks)
    if (opts?.bg) {
      setFill(doc, opts.bg);
      doc.roundedRect(x + 2, ry - 4.2, w - 4, opts?.large ? 6.5 : 5.2, 1, 1, "F");
    }

    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.large ? 10 : opts?.bold ? 8.5 : 7.5);
    // Colores oscuros forzados para contraste
    const textColor = opts?.color ?? (opts?.bold ? C.ink : C.body);
    setTextColor(doc, textColor);
    doc.text(label, labelX, ry);
    setTextColor(doc, textColor);
    doc.text(value, valueX, ry, { align: "right" });
    ry += opts?.large ? 6.5 : 5;
    if (bsRate && bsAmount !== null && bsAmount > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      setTextColor(doc, C.muted);
      doc.text(formatearBs(convertirABs(bsAmount, bsRate)), valueX, ry, {
        align: "right",
      });
      ry += 2.5;
    }
  };

  if (!totals.usingDeclaredTotal) {
    row("Subtotal", formatCurrency(totals.subtotal, currency), totals.subtotal);
    if (totals.lineDiscountsTotal > 0)
      row(
        "Descuentos línea",
        `− ${formatCurrency(totals.lineDiscountsTotal, currency)}`,
        totals.lineDiscountsTotal,
        { color: C.muted as RGB }
      );
    if (totals.globalDiscountAmount > 0)
      row(
        "Descuento global",
        `− ${formatCurrency(totals.globalDiscountAmount, currency)}`,
        totals.globalDiscountAmount,
        { color: C.muted as RGB }
      );
    if (totals.taxAmount > 0)
      row(
        "Impuesto",
        `+ ${formatCurrency(totals.taxAmount, currency)}`,
        totals.taxAmount,
        { color: C.muted as RGB }
      );
  }

  // Refined divider before total
  ry += 1;
  setStroke(doc, isMinimalist ? (C.border as RGB) : themeColors.primaryLight);
  doc.setLineWidth(isMinimalist ? 0.2 : 0.3);
  doc.line(x + 4, ry, x + w - 4, ry);
  ry += 4.5;

  row(
    totals.usingDeclaredTotal ? "Total del recibo" : "Total",
    formatCurrency(totals.total, currency),
    totals.total,
    {
      bold: true,
      large: true,
      color: themeColors.primaryDeep,
      bg: isMinimalist ? undefined : (C.white as RGB),
    }
  );

  if (totals.totalPaid > 0) {
    ry += 1;
    row(
      "Total abonado",
      formatCurrency(totals.totalPaid, currency),
      totals.totalPaid,
      { color: C.teal }
    );
  }

  if (totals.balanceDue > 0) {
    ry += 1;
    row(
      "Saldo pendiente",
      formatCurrency(totals.balanceDue, currency),
      totals.balanceDue,
      { bold: true, color: C.navy }
    );
  } else if (totals.totalPaid > 0) {
    ry += 1;
    row(
      "PAGADO",
      "",
      null,
      { bold: true, color: C.teal }
    );
  }

  // Draw contornos after to superimpose the borders perfectly
  if (!isMinimalist) {
    setStroke(doc, themeColors.primary);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, boxY, w, boxH, 2, 2, "S");
  }

  if (bsRate) {
    ry += 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    setTextColor(doc, C.muted as RGB);
    const note = `Tasa ${bsRate.etiqueta}: ${bsRate.tasa.toLocaleString("es-VE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} Bs`;
    doc.text(note, x + 4, ry);
  }
}

function drawNotes(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  themeColors: ThemeColors
) {
  const ensureSpace = (needed: number) => {
    if (cursor.y + needed > PAGE.h - 40) {
      doc.addPage();
      cursor.y = M.top;
    }
  };

  if (receipt.meta.notes) {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, themeColors.primary);
    doc.text("NOTAS", M.left, cursor.y);
    cursor.y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, C.body as RGB);
    const lines = doc.splitTextToSize(
      receipt.meta.notes,
      PAGE.w - M.left - M.right
    );
    lines.forEach((ln: string) => {
      ensureSpace(5);
      doc.text(ln, M.left, cursor.y);
      cursor.y += 4.2;
    });
    cursor.y += 2;
  }

  if (receipt.meta.observations) {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(doc, themeColors.primary);
    doc.text("OBSERVACIONES", M.left, cursor.y);
    cursor.y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, C.body as RGB);
    const lines = doc.splitTextToSize(
      receipt.meta.observations,
      PAGE.w - M.left - M.right
    );
    lines.forEach((ln: string) => {
      ensureSpace(5);
      doc.text(ln, M.left, cursor.y);
      cursor.y += 4.2;
    });
    cursor.y += 2;
  }
}

/* ============================================================
   FOOTER — Dynamic layout and theme support
   ============================================================ */
function drawFooter(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  themeColors: ThemeColors,
  layout: PdfLayoutName,
  logoLabel: string = "SENDA"
) {
  const pages = doc.getNumberOfPages();
  const isSoftware = themeColors.accent[0] === 255 && themeColors.accent[1] === 114;
  const isMinimalist = layout === "minimalist" && !isSoftware;

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    const footerH = 18;
    const footerY = PAGE.h - footerH - 3;

    // Top separator/accent line or full band
    if (isMinimalist) {
      // Thin gray separator line
      setStroke(doc, C.border as RGB);
      doc.setLineWidth(0.2);
      doc.line(M.left, footerY, PAGE.w - M.right, footerY);
    } else if (isSoftware) {
      // Full colored band - Charcoal Gray
      setFill(doc, themeColors.primary);
      doc.rect(0, footerY, PAGE.w, footerH, "F");

      // Crimson diagonal accent shape on the bottom right using standard shapes
      setFill(doc, themeColors.accent);
      doc.rect(PAGE.w - 16, footerY, 16, PAGE.h - footerY, "F");
      doc.triangle(PAGE.w - 32, footerY, PAGE.w - 16, footerY, PAGE.w - 16, PAGE.h, "F");

      // Fine white separator line
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.3);
      doc.line(PAGE.w - 32, footerY, PAGE.w - 16, PAGE.h);
    } else {
      // Thin cyan accent line (0.8mm thick)
      setFill(doc, themeColors.accent);
      doc.rect(0, footerY, PAGE.w, 0.8, "F");
    }

    // Determine base colors for texts
    const titleColor = (isSoftware && !isMinimalist) ? [241, 245, 249] as RGB : C.muted as RGB;
    const inkColor = (isSoftware && !isMinimalist) ? C.white as RGB : C.ink as RGB;
    const bodyColor = (isSoftware && !isMinimalist) ? [226, 232, 240] as RGB : C.body as RGB;

    // Left Column: Payment & Issuer Info
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    setTextColor(doc, titleColor);
    doc.text("INFORMACIÓN DE EMISIÓN", M.left, footerY + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, inkColor);
    doc.text(receipt.issuer.name || "—", M.left, footerY + 9.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setTextColor(doc, bodyColor);
    const paymentDetail = [
      receipt.issuer.taxId,
      receipt.issuer.phone,
    ].filter(Boolean).join("  ·  ");
    if (paymentDetail) {
      doc.text(paymentDetail, M.left, footerY + 13.5);
    }

    // Center Column: Thank you message (clean, centered, italicized)
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(7.5);
    setTextColor(doc, (isSoftware && !isMinimalist) ? C.white as RGB : themeColors.accent);
    const msg =
      receipt.meta.thankYouMessage ||
      `Gracias por su confianza. ${logoLabel}.`;
    const msgLines = doc.splitTextToSize(msg, 70);
    doc.text(msgLines[0] ?? "", PAGE.w / 2, footerY + 9.5, {
      align: "center",
    });

    // Right Column: Logo in orange band (instead of CONTACTO word)
    if (isSoftware && !isMinimalist) {
      try {
        const logoSize = 14;
        doc.addImage(
          SENDA_LOGO_BASE64,
          "PNG",
          PAGE.w - 17, // Shifted 2mm left
          footerY + 2,
          logoSize,
          logoSize,
          undefined,
          "FAST"
        );
      } catch (error) {
        console.error("Error drawing footer logo:", error);
      }
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      setTextColor(doc, titleColor);
      doc.text("CONTACTO", PAGE.w - M.right, footerY + 5.5, { align: "right" });
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setTextColor(doc, bodyColor);
    const contactParts = [
      receipt.issuer.email,
      [receipt.issuer.address, receipt.issuer.cityCountry].filter(Boolean).join(", "),
    ].filter(Boolean);
    contactParts.forEach((ln, idx) => {
      // Offset position for contact info to not collide with red polygon on the right
      const rightPadding = (isSoftware && !isMinimalist) ? M.right + 18 : M.right;
      doc.text(ln, PAGE.w - rightPadding, footerY + 9.5 + idx * 4, {
        align: "right",
      });
    });

    // Pagination (Centered at the very bottom, below the info columns)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    setTextColor(doc, C.faint as RGB);
    doc.text(
      `Página ${i} de ${pages}`,
      PAGE.w / 2,
      PAGE.h - 2.5,
      { align: "center" }
    );
  }
}

/* ============================================================
   WATERMARK & SIGNATURE FOR PAID RECEIPTS
   ============================================================ */
function drawWatermark(doc: jsPDF, totals: ReceiptTotals, themeColors: ThemeColors, anulado: boolean) {
  if (anulado) {
    marcaAguaTexto(doc, "ANULADO", [220, 38, 38]);
    return;
  }
  if (totals.balanceDue > 0.01) return;
  marcaAguaTexto(doc, "PAGADO", [16, 185, 129]);
}

function marcaAguaTexto(doc: jsPDF, texto: string, color: [number, number, number]) {
  doc.saveGraphicsState();
  try {
    const gstate = new (doc as unknown as { GState: new (o: object) => object }).GState({ opacity: 0.08 });
    doc.setGState(gstate as never);
  } catch {
    // Fallback
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(120);
  doc.setTextColor(color[0], color[1], color[2]);

  // Moved 2cm right and 3cm down (originally at 105, 150)
  doc.text(texto, 125, 180, {
    align: "center",
    angle: 35
  });

  doc.restoreGraphicsState();
}


function drawSignature(
  doc: jsPDF,
  receipt: Receipt,
  cursor: Cursor,
  totals: ReceiptTotals,
  themeColors: ThemeColors
) {
  if (totals.balanceDue > 0.01) return;

  if (cursor.y + 35 > PAGE.h - 30) {
    doc.addPage();
    cursor.y = M.top;
  }

  cursor.y += 5;
  const sigW = 60;
  const sigX = PAGE.w - M.right - sigW; // Right side

  // Draw signature line
  doc.setDrawColor(themeColors.primary[0], themeColors.primary[1], themeColors.primary[2]);
  doc.setLineWidth(0.3);
  doc.line(sigX, cursor.y + 15, sigX + sigW, cursor.y + 15);

  // Digital secure label
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  setTextColor(doc, C.muted as RGB);
  doc.text("FIRMADO DIGITALMENTE", sigX + sigW / 2, cursor.y + 14, { align: "center" });

  // Title (replacing printed name in bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, C.ink as RGB);
  doc.text(receipt.issuer.name || "El emisor", sigX + sigW / 2, cursor.y + 19, { align: "center" });

  cursor.y += 23;
}
