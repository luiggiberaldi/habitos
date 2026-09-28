/**
 * Cartera y catálogo (Fase 6): cliente web.
 * Todo pasa por RPC con auth dual (el navegador usa su JWT, igual que Recibos).
 * Los saldos se calculan en la BD (cargos − abonos por moneda); aquí solo se muestran.
 */

import { getSupabase, getSessionUser } from "../core/supabase";
import type { FinMoneda } from "../finanzas/types";

export type MonedaCartera = FinMoneda;
export type TipoCliente = "cliente" | "proveedor" | "ambos";
export type TipoMovimiento = "cargo" | "abono";

export interface SaldoMoneda {
  moneda: MonedaCartera;
  saldo: number;
  cargos?: number;
  abonos?: number;
}

export interface ClienteCartera {
  id: string;
  nombre: string;
  tipo: TipoCliente;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  saldos: SaldoMoneda[];
}

export interface MovimientoCartera {
  id: string;
  cliente_id: string;
  tipo: TipoMovimiento;
  concepto: string;
  monto: number;
  moneda: MonedaCartera;
  fecha: string;
  recibo_id: string | null;
  creado_en: string;
}

export interface DetalleCartera {
  ok: boolean;
  cliente: {
    id: string;
    nombre: string;
    tipo: TipoCliente;
    telefono: string | null;
    email: string | null;
    activo: boolean;
  };
  saldos: SaldoMoneda[];
  movimientos: MovimientoCartera[];
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  unidad: string;
  categoria: string;
  precio_venta: number;
  moneda: MonedaCartera;
  costo: number | null;
  notas: string | null;
  activo: boolean;
  creado_en: string;
}

export interface NuevoProducto {
  nombre: string;
  unidad: string;
  categoria: string;
  precioVenta: number;
  moneda: MonedaCartera;
  costo: number | null;
  notas: string;
}

export interface NuevoCliente {
  nombre: string;
  tipo: TipoCliente;
  telefono: string;
  email: string;
  notas: string;
}

export interface NuevoMovimiento {
  clienteId: string;
  tipo: TipoMovimiento;
  concepto: string;
  monto: number;
  moneda: MonedaCartera;
  fecha: string;
}

export const UNIDADES_CATALOGO = [
  { value: "und", label: "Unidad" },
  { value: "kg", label: "Kilogramo" },
  { value: "g", label: "Gramo" },
  { value: "L", label: "Litro" },
  { value: "ml", label: "Mililitro" },
  { value: "paquete", label: "Paquete" },
  { value: "caja", label: "Caja" },
  { value: "servicio", label: "Servicio" },
] as const;

export const MONEDAS_CARTERA: { value: MonedaCartera; label: string }[] = [
  { value: "USD", label: "USD ($)" },
  { value: "VES", label: "VES (Bs)" },
  { value: "USDT", label: "USDT" },
  { value: "COP", label: "COP" },
];

export const TIPOS_CLIENTE: { value: TipoCliente; label: string }[] = [
  { value: "cliente", label: "Cliente (me debe)" },
  { value: "proveedor", label: "Proveedor (le debo)" },
  { value: "ambos", label: "Ambos" },
];

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

function supabaseOk() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  return supabase;
}

/* ── Productos ── */

export async function listarProductos(): Promise<ProductoCatalogo[]> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_cat_producto_listar", {
    p_user_id: userId,
    p_solo_activos: true,
  });
  lanzarSiHayError(error, "No se pudieron cargar los productos");
  return (data ?? []) as ProductoCatalogo[];
}

export async function guardarProducto(input: NuevoProducto): Promise<{ id: string; nuevo: boolean }> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El producto necesita un nombre");
  if (!(input.precioVenta > 0)) throw new Error("El precio de venta debe ser mayor a 0");
  const { data, error } = await supabase.rpc("rpc_cat_producto_upsert", {
    p_user_id: userId,
    p_nombre: nombre,
    p_unidad: input.unidad,
    p_categoria: input.categoria.trim() || "General",
    p_precio_venta: input.precioVenta,
    p_moneda: input.moneda,
    p_costo: input.costo && input.costo > 0 ? input.costo : null,
    p_notas: input.notas.trim() || null,
  });
  lanzarSiHayError(error, "No se pudo guardar el producto");
  return { id: (data as { id: string }).id, nuevo: (data as { nuevo: boolean }).nuevo };
}

export async function desactivarProducto(id: string): Promise<void> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_cat_producto_desactivar", {
    p_user_id: userId,
    p_id: id,
  });
  lanzarSiHayError(error, "No se pudo desactivar el producto");
}

export async function actualizarProducto(id: string, input: NuevoProducto): Promise<void> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El producto necesita un nombre");
  if (!(input.precioVenta > 0)) throw new Error("El precio de venta debe ser mayor a 0");
  const { error } = await supabase.rpc("rpc_cat_producto_actualizar", {
    p_user_id: userId,
    p_id: id,
    p_nombre: nombre,
    p_unidad: input.unidad,
    p_categoria: input.categoria.trim() || "General",
    p_precio_venta: input.precioVenta,
    p_moneda: input.moneda,
    p_costo: input.costo && input.costo > 0 ? input.costo : null,
    p_notas: input.notas.trim() || null,
  });
  lanzarSiHayError(error, "No se pudo actualizar el producto");
}

export async function eliminarProducto(id: string): Promise<void> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_cat_producto_eliminar", {
    p_user_id: userId,
    p_id: id,
  });
  lanzarSiHayError(error, "No se pudo borrar el producto");
}

/* ── Clientes ── */

export async function listarClientes(): Promise<ClienteCartera[]> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_car_cliente_listar", {
    p_user_id: userId,
  });
  lanzarSiHayError(error, "No se pudieron cargar los clientes");
  return (data ?? []) as ClienteCartera[];
}

export async function guardarCliente(input: NuevoCliente): Promise<{ id: string; nuevo: boolean }> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El cliente necesita un nombre");
  const { data, error } = await supabase.rpc("rpc_car_cliente_upsert", {
    p_user_id: userId,
    p_nombre: nombre,
    p_tipo: input.tipo,
    p_telefono: input.telefono.trim() || null,
    p_email: input.email.trim() || null,
    p_notas: input.notas.trim() || null,
  });
  lanzarSiHayError(error, "No se pudo guardar el cliente");
  return { id: (data as { id: string }).id, nuevo: (data as { nuevo: boolean }).nuevo };
}

export async function desactivarCliente(id: string): Promise<void> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_car_cliente_desactivar", {
    p_user_id: userId,
    p_id: id,
  });
  lanzarSiHayError(error, "No se pudo desactivar el cliente");
}

/* ── Cartera ── */

export async function verCartera(clienteId: string): Promise<DetalleCartera> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_car_cartera", {
    p_user_id: userId,
    p_cliente_id: clienteId,
    p_limite_movimientos: 20,
  });
  lanzarSiHayError(error, "No se pudo cargar la cartera");
  return data as DetalleCartera;
}

export async function registrarMovimiento(input: NuevoMovimiento): Promise<{ saldo: number }> {
  const supabase = supabaseOk();
  const userId = await usuario();
  const concepto = input.concepto.trim();
  if (!concepto) throw new Error("El movimiento necesita un concepto");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a 0");
  const { data, error } = await supabase.rpc("rpc_car_movimiento", {
    p_user_id: userId,
    p_cliente_id: input.clienteId,
    p_tipo: input.tipo,
    p_concepto: concepto,
    p_monto: input.monto,
    p_moneda: input.moneda,
    p_fecha: input.fecha || null,
  });
  lanzarSiHayError(error, "No se pudo registrar el movimiento");
  return { saldo: Number((data as { saldo_moneda: number }).saldo_moneda) };
}

/* ── Formato ── */

const SIMBOLO: Record<MonedaCartera, string> = {
  USD: "$",
  VES: "Bs ",
  USDT: "USDT ",
  COP: "COP ",
};

export function formatoMonto(monto: number, moneda: MonedaCartera): string {
  const abs = Math.abs(monto);
  const txt = abs.toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${SIMBOLO[moneda]}${txt}`;
}

/** "me deben $50,00" / "les debo $30,00" / "en cero" */
export function textoSaldo(saldo: number, moneda: MonedaCartera): string {
  if (saldo > 0) return `me deben ${formatoMonto(saldo, moneda)}`;
  if (saldo < 0) return `les debo ${formatoMonto(saldo, moneda)}`;
  return `en cero en ${moneda}`;
}
