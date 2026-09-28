// lib/mercado/types.ts — Tipos del módulo Mercado (Fase 2).

export type MerUnidad = "und" | "kg" | "g" | "L" | "ml" | "paquete" | "caja";
export type MerTipoMov = "compra" | "consumo" | "ajuste" | "danado";

export const MER_UNIDADES: { valor: MerUnidad; etiqueta: string }[] = [
  { valor: "und", etiqueta: "Unidades" },
  { valor: "kg", etiqueta: "Kilos (kg)" },
  { valor: "g", etiqueta: "Gramos (g)" },
  { valor: "L", etiqueta: "Litros (L)" },
  { valor: "ml", etiqueta: "Mililitros (ml)" },
  { valor: "paquete", etiqueta: "Paquete" },
  { valor: "caja", etiqueta: "Caja" },
];

export interface MerInventarioItem {
  id: string;
  nombre: string;
  unidad: string;
  categoria: string;
  stock: number;
  ultimo_precio: number | null;
  ultima_moneda: string | null;
  ultimo_comercio: string | null;
  precio_min_usd: number | null;
  precio_max_usd: number | null;
  precio_prom_usd: number | null;
  precio_usd_unitario: number | null;
  variacion_pct: number | null;
  consumo_diario: number | null;
  consumo_mensual: number | null;
  dias_agotamiento: number | null;
  fecha_agotamiento: string | null;
  sugerido_comprar: number | null;
  n_compras: number | null;
}

export interface MerPrecio {
  fecha: string;
  comercio: string | null;
  precio_unitario: number;
  moneda: string;
  precio_usd_unitario: number;
  precio_usd_historico?: number | null;
  precio_bs_historico?: number | null;
  tasa_bs_historica?: number | null;
  cantidad: number;
}

export interface MerListaItem {
  id: string;
  producto_id: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  estado: "pendiente" | "comprado";
  creado_en: string;
}

export interface MerPresupuestoItem {
  producto: string;
  unidad: string;
  consumo_mensual: number;
  precio_usd_unitario: number;
  costo_mensual_usd: number;
}

export interface MerPresupuesto {
  total_usd: number;
  items: MerPresupuestoItem[];
}
