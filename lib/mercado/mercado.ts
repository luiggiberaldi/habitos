// lib/mercado/mercado.ts — Cliente del módulo Mercado (Fase 2).
//
// Los RPC de mercado usan el mismo secreto compartido que finanzas
// (header `x-fin-rpc-secret`, fail-closed). La sesión se toma del cliente
// Supabase del navegador (auth del usuario dueño).

"use client";

import { createClient } from "@supabase/supabase-js";
import type {
  MerInventarioItem,
  MerListaItem,
  MerPrecio,
  MerPresupuesto,
  MerTipoMov,
  MerUnidad,
} from "./types";

const supabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const secreto = process.env.NEXT_PUBLIC_HABITOS_RPC_SECRET;
  if (!secreto) throw new Error("Falta NEXT_PUBLIC_HABITOS_RPC_SECRET.");
  const { data: { session } } = await supabase().auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Sin sesión.");
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        "x-fin-rpc-secret": secreto,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user_id: userId, ...params }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error de Mercado (${fn}): ${txt.slice(0, 160)}`);
  }
  return (await res.json()) as T;
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
