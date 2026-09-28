/**
 * Recibos (Fase 5): cliente web. Lee directo por RLS; la creación, los abonos
 * y la anulación van por RPC con auth dual (el navegador usa su JWT, igual
 * que Mercado). El número secuencial siempre sale del RPC (guardarraíl #2).
 */

import { getSupabase, getSessionUser } from "../core/supabase";
import { obtenerMiHogar } from "../core/hogar";
import type { FinMoneda } from "../finanzas/types";
import type {
  Receipt,
  ReceiptItem,
  PartialPayment,
  PaymentMethod,
} from "./tipos";
import { computeTotals } from "./calculos";
import { buildPdfFilename, formatDate } from "./formato";
import { buildSynapticaPdf } from "./pdf/synaptica";
import type { TasaBs } from "./tasas";

export interface ReciboFila {
  id: string;
  numero: string;
  estado: "pendiente" | "parcial" | "pagado" | "anulado";
  moneda: FinMoneda;
  cliente_nombre: string;
  snapshot: Record<string, unknown>;
  total: number;
  total_pagado: number;
  saldo: number;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  creado_en: string;
}

export interface EmisorRecibo {
  nombre: string;
  doc: string;
  telefono: string;
  email: string;
  direccion: string;
}

export interface ItemNuevo {
  descripcion: string;
  cantidad: number;
  precio: number;
  descuento: number; // %
}

export interface NuevoRecibo {
  emisor: EmisorRecibo;
  clienteNombre: string;
  clienteTelefono: string;
  moneda: FinMoneda;
  items: ItemNuevo[];
  descuentoGlobal: number;
  impuesto: number;
  notas: string;
}

function lanzarSiHayError(error: unknown, contexto: string): void {
  if (error) {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
    throw new Error(`${contexto}: ${msg}`);
  }
}

async function usuario(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  return user.id;
}

/** Convierte una fila de la BD al Receipt que pide el motor del PDF. */
export function filaARecibo(fila: ReciboFila): Receipt {
  const s = (fila.snapshot ?? {}) as {
    emisor?: Partial<EmisorRecibo>;
    clienteTelefono?: string;
    items?: ReceiptItem[];
    pagos?: PartialPayment[];
    descuentoGlobal?: number;
    impuesto?: number;
    notas?: string;
  };
  const pagos = Array.isArray(s.pagos) ? (s.pagos as PartialPayment[]) : [];
  return {
    meta: {
      number: fila.numero,
      issueDate: fila.fecha_emision,
      dueDate: fila.fecha_vencimiento ?? "",
      currency: fila.moneda,
      primaryMethod: "transfer",
      paymentMode: pagos.length > 0 ? "partial" : "full",
      notes: typeof s.notas === "string" ? s.notas : "",
      observations: "",
      thankYouMessage: "¡Gracias por su preferencia!",
      warrantyDays: 0,
      warrantyEndDate: "",
    },
    issuer: {
      name: s.emisor?.nombre ?? "",
      taxId: s.emisor?.doc ?? "",
      phone: s.emisor?.telefono ?? "",
      email: s.emisor?.email ?? "",
      address: s.emisor?.direccion ?? "",
      cityCountry: "Venezuela",
    },
    client: {
      name: fila.cliente_nombre,
      taxId: "",
      phone: s.clienteTelefono ?? "",
      email: "",
      address: "",
      company: "",
    },
    items: Array.isArray(s.items) ? (s.items as ReceiptItem[]) : [],
    payments: pagos,
    globalDiscount: Number(s.descuentoGlobal ?? 0),
    taxRate: Number(s.impuesto ?? 0),
    declaredTotal: 0,
  };
}

/** Últimos recibos del usuario (o de su hogar). */
export async function listarRecibos(): Promise<ReciboFila[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  await usuario();
  const { data, error } = await supabase
    .from("fin_recibos")
    .select(
      "id, numero, estado, moneda, cliente_nombre, snapshot, total, total_pagado, saldo, fecha_emision, fecha_vencimiento, creado_en"
    )
    .order("creado_en", { ascending: false })
    .limit(100);
  lanzarSiHayError(error, "No se pudieron cargar los recibos");
  return (data ?? []) as ReciboFila[];
}

/** Tasa en Bs para la línea de conversión del PDF (paralelo/USDT de fin_tasas). */
async function tasaBsParaPdf(moneda: FinMoneda): Promise<TasaBs | null> {
  if (moneda !== "USD" && moneda !== "USDT") return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("fin_tasas")
    .select("paralelo, usdt")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fila = data as { paralelo?: number | null; usdt?: number | null } | null;
  const tasa = moneda === "USD" ? Number(fila?.paralelo ?? 0) : Number(fila?.usdt ?? 0);
  if (!(tasa > 0)) return null;
  return { etiqueta: moneda === "USD" ? "Paralelo" : "USDT", tasa };
}

/** Data URLs en caché de los assets de marca Synaptica (logo + firma). */
const marcaCache: { logo?: string; firma?: string } = {};

async function dataUrlImagen(ruta: string): Promise<string | undefined> {
  try {
    const res = await fetch(ruta);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("FileReader"));
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Genera y descarga el PDF 2.0 de un recibo (marca Synaptica). */
export async function descargarPdf(fila: ReciboFila): Promise<void> {
  const recibo = filaARecibo(fila);
  const bsRate = await tasaBsParaPdf(fila.moneda);
  if (!marcaCache.logo) marcaCache.logo = await dataUrlImagen("/synaptica/logo.png");
  if (!marcaCache.firma) marcaCache.firma = await dataUrlImagen("/synaptica/firma-luigi.png");
  const doc = buildSynapticaPdf(recibo, {
    bsRate,
    anulado: fila.estado === "anulado",
    logoDataUrl: marcaCache.logo,
    firmaDataUrl: marcaCache.firma,
  });
  doc.save(buildPdfFilename(fila.numero, fila.cliente_nombre));
}

/** Crea un recibo (resumen + confirmación los maneja la UI antes de llamar). */
export async function crearRecibo(input: NuevoRecibo): Promise<{ id: string; numero: string }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const clienteNombre = input.clienteNombre.trim();
  if (!clienteNombre) throw new Error("El recibo necesita un cliente");
  const items = input.items.filter(
    (it) => it.descripcion.trim() !== "" || it.precio > 0
  );
  if (items.length === 0) throw new Error("Agrega al menos un concepto");

  const receipt: Receipt = {
    meta: {
      number: "",
      issueDate: formatDateHoy(),
      dueDate: "",
      currency: input.moneda,
      primaryMethod: "transfer",
      paymentMode: "full",
      notes: input.notas.trim(),
      observations: "",
      thankYouMessage: "¡Gracias por su preferencia!",
      warrantyDays: 0,
      warrantyEndDate: "",
    },
    issuer: {
      name: input.emisor.nombre.trim(),
      taxId: input.emisor.doc.trim(),
      phone: input.emisor.telefono.trim(),
      email: input.emisor.email.trim(),
      address: input.emisor.direccion.trim(),
      cityCountry: "Venezuela",
    },
    client: {
      name: clienteNombre,
      taxId: "",
      phone: input.clienteTelefono.trim(),
      email: "",
      address: "",
      company: "",
    },
    items: items.map((it, i) => ({
      id: `it-${i}`,
      description: it.descripcion.trim(),
      quantity: Math.max(0, Number(it.cantidad) || 0),
      unitPrice: Math.max(0, Number(it.precio) || 0),
      discount: Math.min(100, Math.max(0, Number(it.descuento) || 0)),
    })),
    payments: [],
    globalDiscount: Math.min(100, Math.max(0, Number(input.descuentoGlobal) || 0)),
    taxRate: Math.max(0, Number(input.impuesto) || 0),
    declaredTotal: 0,
  };
  const totales = computeTotals(receipt);
  if (!(totales.total > 0)) throw new Error("El total debe ser mayor a 0");

  const snapshot = {
    emisor: receipt.issuer,
    clienteTelefono: receipt.client.phone,
    items: receipt.items,
    pagos: [],
    descuentoGlobal: receipt.globalDiscount,
    impuesto: receipt.taxRate,
    notas: receipt.meta.notes,
  };

  let hogarId: string | null = null;
  try {
    const hogar = await obtenerMiHogar(supabase);
    hogarId = hogar?.id ?? null;
  } catch {
    hogarId = null;
  }

  const { data, error } = await supabase.rpc("rpc_recibo_crear", {
    p_user_id: userId,
    p_moneda: input.moneda,
    p_cliente_nombre: clienteNombre,
    p_snapshot: snapshot,
    p_total: totales.total,
    p_fecha_emision: receipt.meta.issueDate,
    p_fecha_vencimiento: null,
    p_hogar_id: hogarId,
  });
  lanzarSiHayError(error, "No se pudo crear el recibo");
  const r = data as { ok: boolean; id: string; numero: string } | null;
  if (!r?.ok) throw new Error("No se pudo crear el recibo");
  return { id: r.id, numero: r.numero };
}

/** Registra un abono (el RPC rechaza sobrepagos — guardarraíl #6). */
export async function abonarRecibo(
  id: string,
  monto: number,
  metodo: PaymentMethod,
  referencia: string
): Promise<{ estado: string; saldo: number }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  if (!(monto > 0)) throw new Error("El monto debe ser mayor a 0");
  const { data, error } = await supabase.rpc("rpc_recibo_abonar", {
    p_user_id: userId,
    p_recibo_id: id,
    p_monto: monto,
    p_fecha: formatDateHoy(),
    p_metodo: metodo,
    p_referencia: referencia.trim() || null,
    p_nota: null,
  });
  if (error) {
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("sobrepago")) throw new Error("El abono supera el saldo pendiente");
    if (msg.includes("recibo_anulado")) throw new Error("El recibo está anulado");
    lanzarSiHayError(error, "No se pudo registrar el abono");
  }
  const r = data as { ok: boolean; estado: string; saldo: number } | null;
  if (!r?.ok) throw new Error("No se pudo registrar el abono");
  return { estado: r.estado, saldo: Number(r.saldo) };
}

/** Anula un recibo (soft delete — guardarraíl #3). */
export async function anularRecibo(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_recibo_anular", {
    p_user_id: userId,
    p_recibo_id: id,
  });
  lanzarSiHayError(error, "No se pudo anular el recibo");
  const r = data as { ok: boolean } | null;
  if (!r?.ok) throw new Error("No se pudo anular el recibo");
}

/** Hoy en America/Caracas, YYYY-MM-DD. */
function formatDateHoy(): string {
  const d = new Date();
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return partes;
}

export { formatDate };
