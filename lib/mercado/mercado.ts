// lib/mercado/mercado.ts — Cliente del módulo Mercado (Fase 2).
//
// lib/mercado/mercado.ts — Cliente del módulo Mercado (Fase 2).
//
// La UI llama a los RPC con el JWT del navegador; el RPC acepta la llamada
// cuando auth.uid() = p_user_id (migración 0028, mismo patrón que el coach).
// El secreto de integración es solo para los scripts (WhatsApp/cron) y NUNCA
// viaja al cliente.

"use client";

import { getSupabase, getSessionUser } from "../core/supabase";
import type {
  MerInventarioItem,
  MerListaItem,
  MerMovReciente,
  MerPrecio,
  MerPresupuesto,
  MerTipoMov,
  MerUnidad,
} from "./types";

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube.");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión.");
  const { data, error } = await supabase.rpc(fn, { p_user_id: user.id, ...params });
  if (error) throw new Error(`Error de Mercado (${fn}): ${error.message.slice(0, 160)}`);
  return data as T;
}

export const merRpc = {
  productoUpsert: (p: {
    nombre: string;
    unidad: MerUnidad;
    categoria: string;
    precioRef?: number | null;
    stockInicial?: number | null;
  }) =>
    rpc<{ ok: boolean; id: string; nombre: string; nuevo?: boolean }>("rpc_mer_producto_upsert", {
      p_nombre: p.nombre,
      p_unidad: p.unidad,
      p_categoria: p.categoria,
      p_precio_ref: p.precioRef ?? null,
      p_stock_inicial: p.stockInicial ?? null,
    }),
  movimiento: (p: {
    productoId: string;
    tipo: MerTipoMov;
    cantidad: number;
    precioTotal?: number | null;
    moneda?: string | null;
    comercio?: string | null;
    cuentaId?: string | null;
    nota?: string | null;
  }) =>
    rpc<{
      ok: boolean;
      id: string;
      tipo: string;
      producto: string;
      cantidad: number;
      unidad: string;
      fin_movimiento_id: string | null;
    }>("rpc_mer_movimiento", {
      p_producto_id: p.productoId,
      p_tipo: p.tipo,
      p_cantidad: p.cantidad,
      p_precio_total: p.precioTotal ?? null,
      p_moneda: p.moneda ?? null,
      p_comercio: p.comercio ?? null,
      p_cuenta_id: p.cuentaId ?? null,
      p_nota: p.nota ?? null,
    }),
  inventario: () => rpc<MerInventarioItem[]>("rpc_mer_inventario", {}),
  precios: (productoId: string) =>
    rpc<MerPrecio[]>("rpc_mer_precios", { p_producto_id: productoId }),
  lista: () => rpc<MerListaItem[]>("rpc_mer_lista", {}),
  listaToggle: (p: {
    productoId: string;
    cantidad?: number | null;
    estado?: "pendiente" | "comprado" | "quitar";
  }) =>
    rpc<{ ok: boolean; estado: string; producto: string }>(
      "rpc_mer_lista_toggle",
      {
        p_producto_id: p.productoId,
        p_cantidad: p.cantidad ?? null,
        p_estado: p.estado ?? "pendiente",
      },
    ),
  presupuesto: () => rpc<MerPresupuesto>("rpc_mer_presupuesto", {}),
  productoActualizar: (p: {
    productoId: string;
    nombre?: string | null;
    categoria?: string | null;
    horizonteDias?: number | null;
    consumoSemanalEstim?: number | null;
    quitarEstimado?: boolean;
    activo?: boolean | null;
  }) =>
    rpc<{ ok: boolean; id: string; nombre: string }>(
      "rpc_mer_producto_actualizar",
      {
        p_producto_id: p.productoId,
        p_nombre: p.nombre ?? null,
        p_categoria: p.categoria ?? null,
        p_horizonte_dias: p.horizonteDias ?? null,
        p_consumo_semanal_estim: p.consumoSemanalEstim ?? null,
        p_quitar_estimado: p.quitarEstimado ?? false,
        p_activo: p.activo ?? null,
      },
    ),
  anular: (movimientoId: string) =>
    rpc<{ ok: boolean; anulado: boolean }>("rpc_mer_anular", {
      p_movimiento_id: movimientoId,
    }),
  recientes: (limite = 15) =>
    rpc<MerMovReciente[]>("rpc_mer_recientes", { p_limite: limite }),
  listaComprar: (p: {
    productoId: string;
    cantidad?: number | null;
    precioTotal: number;
    moneda?: string | null;
    comercio?: string | null;
    cuentaId?: string | null;
    nota?: string | null;
  }) =>
    rpc<{
      ok: boolean;
      duplicado: boolean;
      movimiento: { id: string; tipo: string; cantidad: number };
    }>("rpc_mer_lista_comprar", {
      p_producto_id: p.productoId,
      p_cantidad: p.cantidad ?? null,
      p_precio_total: p.precioTotal,
      p_moneda: p.moneda ?? "VES",
      p_comercio: p.comercio ?? null,
      p_cuenta_id: p.cuentaId ?? null,
      p_nota: p.nota ?? null,
      p_clave_evento: `web-${p.productoId}-${Date.now()}`,
    }),
};

export const fmtCantidad = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(n);

/* --- Datos (estadísticas del módulo Mercado) --- */

export interface MerGastoProducto {
  nombre: string;
  usd: number;
}

export interface MerGastoMensual {
  totalUsd: number;
  nCompras: number;
  porProducto: MerGastoProducto[];
}

function inicioMesCaracas(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  return `${partes}-01`; // YYYY-MM-01
}

/**
 * Gasto real en mercado del mes actual (compras no anuladas), en USD usando
 * la tasa histórica guardada en cada movimiento. Lectura directa con RLS
 * (dueño o miembro del hogar).
 */
export async function gastoMensualMercado(): Promise<MerGastoMensual> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la base de datos");
  const { data, error } = await supabase
    .from("mer_movimientos")
    .select("precio_total, tasa_usd, mer_productos!inner(nombre)")
    .eq("tipo", "compra")
    .gte("fecha", inicioMesCaracas())
    .is("anulado_en", null);
  if (error) throw new Error(`No se pudo cargar el gasto del mes: ${error.message.slice(0, 120)}`);
  const porProducto = new Map<string, number>();
  let total = 0;
  let n = 0;
  for (const f of (data ?? []) as Record<string, unknown>[]) {
    const usd = Number(f.precio_total) * Number(f.tasa_usd);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    total += usd;
    n++;
    const prod = (f.mer_productos ?? {}) as Record<string, unknown>;
    const nombre = String(prod.nombre ?? "Sin nombre");
    porProducto.set(nombre, (porProducto.get(nombre) ?? 0) + usd);
  }
  const lista = [...porProducto.entries()]
    .map(([nombre, usd]) => ({ nombre, usd: Math.round(usd * 100) / 100 }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  return { totalUsd: Math.round(total * 100) / 100, nCompras: n, porProducto: lista };
}
