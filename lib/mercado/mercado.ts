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
};

export const fmtCantidad = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(n);
