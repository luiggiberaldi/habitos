/**
 * Finanzas (Fase 1): cliente del libro. Habla directo con las tablas vía RLS
 * (el usuario autenticado es dueño o miembro del hogar). El secreto de RPC
 * es solo para WhatsApp/integraciones (scripts/), nunca llega al navegador.
 */

import { getSupabase, getSessionUser } from "../core/supabase";
import { obtenerMiHogar } from "../core/hogar";
import type {
  FinCuenta,
  FinCuentaConSaldo,
  FinMoneda,
  FinMovimiento,
  FinResumenDia,
  FinTipoMov,
} from "./types";

/** Hoy en America/Caracas, YYYY-MM-DD. */
export function hoyCaracas(fecha = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
  return partes; // en-CA ya da YYYY-MM-DD
}

function lanzarSiHayError(error: unknown, contexto: string): void {
  if (error) {
    const e = error as { message?: string };
    throw new Error(`${contexto}: ${e.message ?? "error desconocido"}`);
  }
}

function filaACuenta(f: Record<string, unknown>): FinCuenta {
  return {
    id: String(f.id),
    nombre: String(f.nombre),
    moneda: f.moneda as FinCuenta["moneda"],
    tipo: f.tipo as FinCuenta["tipo"],
    tasaUsdManual: f.tasa_usd_manual == null ? null : Number(f.tasa_usd_manual),
    archivada: Boolean(f.archivada),
    hogarId: (f.hogar_id as string | null) ?? null,
    creadoEn: String(f.creado_en),
  };
}

/** Cuentas activas del usuario (personales + del hogar) con sus saldos. */
export async function listarCuentasConSaldos(): Promise<FinCuentaConSaldo[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("fin_cuentas")
    .select("*, fin_saldos!inner(saldo_moneda, saldo_usd, n_movimientos)")
    .eq("archivada", false)
    .order("creado_en", { ascending: true });
  lanzarSiHayError(error, "No se pudieron cargar las cuentas");
  return ((data ?? []) as Record<string, unknown>[]).map((f) => {
    const s = (f.fin_saldos ?? {}) as Record<string, unknown>;
    return {
      ...filaACuenta(f),
      saldoMoneda: Number(s.saldo_moneda ?? 0),
      saldoUsd: Number(s.saldo_usd ?? 0),
      nMovimientos: Number(s.n_movimientos ?? 0),
    };
  });
}

/** Crea una cuenta. `compartida=true` la ata al hogar del usuario (si tiene). */
export async function crearCuenta(input: {
  nombre: string;
  moneda: FinMoneda;
  tipo: FinCuenta["tipo"];
  tasaUsdManual?: number | null;
  compartida?: boolean;
}): Promise<FinCuenta> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("La cuenta necesita un nombre");
  if (input.moneda === "COP" && !(input.tasaUsdManual && input.tasaUsdManual > 0)) {
    throw new Error("COP necesita una tasa manual (COP por $1)");
  }
  let hogarId: string | null = null;
  if (input.compartida) {
    const hogar = await obtenerMiHogar(supabase);
    if (!hogar) throw new Error("No perteneces a ningún hogar");
    hogarId = hogar.id;
  }
  const { data, error } = await supabase
    .from("fin_cuentas")
    .insert({
      user_id: user.id,
      hogar_id: hogarId,
      nombre,
      moneda: input.moneda,
      tipo: input.tipo,
      tasa_usd_manual:
        input.tasaUsdManual && input.tasaUsdManual > 0 ? input.tasaUsdManual : null,
      creado_por: user.id,
    })
    .select()
    .single();
  lanzarSiHayError(error, "No se pudo crear la cuenta");
  return filaACuenta(data as Record<string, unknown>);
}

/** Archiva una cuenta (no se borra: el historial se conserva). */
export async function archivarCuenta(cuentaId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase
    .from("fin_cuentas")
    .update({ archivada: true })
    .eq("id", cuentaId);
  lanzarSiHayError(error, "No se pudo archivar la cuenta");
}

/** Última tasa VES→USD (1 Bs → USD) desde fin_tasas. */
async function tasaVesSnapshot(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { data, error } = await supabase
    .from("fin_tasas")
    .select("paralelo")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  lanzarSiHayError(error, "No se pudo leer la tasa del día");
  const paralelo = Number((data as { paralelo?: number } | null)?.paralelo ?? 0);
  if (!(paralelo > 0)) throw new Error("No hay tasa VES disponible");
  return 1 / paralelo;
}

/** Snapshot 1 unidad de moneda → USD (manual > fin_tasas). */
async function tasaUsdSnapshot(
  moneda: FinMoneda,
  manual: number | null
): Promise<number> {
  if (manual != null && manual > 0) return manual;
  if (moneda === "USD" || moneda === "USDT") return 1;
  if (moneda === "VES") return tasaVesSnapshot();
  throw new Error("COP necesita una tasa manual en la cuenta");
}

function claveEvento(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `app-${Date.now().toString(36)}-${r}`;
}

export interface NuevoMovimiento {
  tipo: FinTipoMov;
  cuentaId: string;
  cuentaDestinoId?: string | null;
  monto: number;
  categoria?: string | null;
  fecha?: string; // YYYY-MM-DD; hoy Caracas por defecto
  nota?: string | null;
}

/** Registra ingreso/egreso/transferencia con snapshot de tasa. Idempotente. */
export async function registrarMovimiento(input: NuevoMovimiento): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a 0");

  const { data: cuenta, error: eCuenta } = await supabase
    .from("fin_cuentas")
    .select("id, moneda, tasa_usd_manual, hogar_id")
    .eq("id", input.cuentaId)
    .single();
  lanzarSiHayError(eCuenta, "Cuenta no encontrada");
  const c = cuenta as { moneda: FinMoneda; tasa_usd_manual: number | null; hogar_id: string | null };
  const tasa = await tasaUsdSnapshot(c.moneda, c.tasa_usd_manual);

  let destinoId: string | null = null;
  let montoDestino: number | null = null;
  let tasaDestino: number | null = null;
  if (input.tipo === "transferencia") {
    if (!input.cuentaDestinoId) throw new Error("Falta la cuenta destino");
    if (input.cuentaDestinoId === input.cuentaId)
      throw new Error("Origen y destino no pueden ser la misma cuenta");
    const { data: dest, error: eDest } = await supabase
      .from("fin_cuentas")
      .select("id, moneda, tasa_usd_manual")
      .eq("id", input.cuentaDestinoId)
      .single();
    lanzarSiHayError(eDest, "Cuenta destino no encontrada");
    const d = dest as { moneda: FinMoneda; tasa_usd_manual: number | null };
    tasaDestino = await tasaUsdSnapshot(d.moneda, d.tasa_usd_manual);
    destinoId = input.cuentaDestinoId;
    montoDestino = Math.round((input.monto * tasa) / tasaDestino * 100) / 100;
  }

  const { data, error } = await supabase
    .from("fin_movimientos")
    .insert({
      user_id: user.id,
      hogar_id: c.hogar_id,
      cuenta_id: input.cuentaId,
      cuenta_destino_id: destinoId,
      tipo: input.tipo,
      categoria: input.categoria?.trim().toLowerCase() || null,
      monto: Math.round(input.monto * 100) / 100,
      monto_destino: montoDestino,
      tasa_usd: tasa,
      tasa_usd_destino: tasaDestino,
      fecha: input.fecha || hoyCaracas(),
      nota: input.nota?.trim() || null,
      clave_evento: claveEvento(),
      creado_por: user.id,
    })
    .select("id")
    .single();
  lanzarSiHayError(error, "No se pudo registrar el movimiento");
  return (data as { id: string }).id;
}

/** Últimos movimientos (no anulados) con nombres de cuenta. */
export async function listarMovimientos(limite = 20): Promise<FinMovimiento[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("fin_movimientos")
    .select(
      "*, cuenta:fin_cuentas!fin_movimientos_cuenta_id_fkey(nombre, moneda), destino:fin_cuentas!fin_movimientos_cuenta_destino_id_fkey(nombre)"
    )
    .is("anulado_en", null)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(limite);
  lanzarSiHayError(error, "No se pudieron cargar los movimientos");
  return ((data ?? []) as Record<string, unknown>[]).map((f) => {
    const cuenta = (f.cuenta ?? {}) as Record<string, unknown>;
    const destino = (f.destino ?? {}) as Record<string, unknown>;
    return {
      id: String(f.id),
      cuentaId: String(f.cuenta_id),
      cuentaDestinoId: (f.cuenta_destino_id as string | null) ?? null,
      tipo: f.tipo as FinTipoMov,
      categoria: (f.categoria as string | null) ?? null,
      monto: Number(f.monto),
      montoDestino: f.monto_destino == null ? null : Number(f.monto_destino),
      tasaUsd: Number(f.tasa_usd),
      fecha: String(f.fecha),
      nota: (f.nota as string | null) ?? null,
      claveEvento: (f.clave_evento as string | null) ?? null,
      creadoEn: String(f.creado_en),
      anuladoEn: (f.anulado_en as string | null) ?? null,
      cuentaNombre: cuenta.nombre != null ? String(cuenta.nombre) : undefined,
      cuentaMoneda: (cuenta.moneda as FinMoneda | undefined) ?? undefined,
      destinoNombre: destino.nombre != null ? String(destino.nombre) : null,
    };
  });
}

/** Anula un movimiento (soft delete: el historial se conserva). */
export async function anularMovimiento(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase
    .from("fin_movimientos")
    .update({ anulado_en: new Date().toISOString() })
    .eq("id", id);
  lanzarSiHayError(error, "No se pudo anular el movimiento");
}

/** Ingresos vs egresos (USD) de los últimos 7 días, por día. */
export async function resumenSemanal(): Promise<FinResumenDia[]> {
  const movs = await listarMovimientos(500);
  const dias: FinResumenDia[] = [];
  const ahora = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ahora);
    d.setDate(d.getDate() - i);
    dias.push({ fecha: hoyCaracas(d), ingresosUsd: 0, egresosUsd: 0 });
  }
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  for (const m of movs) {
    const dia = porFecha.get(m.fecha);
    if (!dia) continue;
    const usd = m.monto * m.tasaUsd;
    if (m.tipo === "ingreso") dia.ingresosUsd += usd;
    else if (m.tipo === "egreso") dia.egresosUsd += usd;
  }
  for (const d of dias) {
    d.ingresosUsd = Math.round(d.ingresosUsd * 100) / 100;
    d.egresosUsd = Math.round(d.egresosUsd * 100) / 100;
  }
  return dias;
}

/** Patrimonio total en USD (suma de saldos). */
export function patrimonioUsd(cuentas: FinCuentaConSaldo[]): number {
  return Math.round(cuentas.reduce((acc, c) => acc + c.saldoUsd, 0) * 100) / 100;
}

/** Formato es-VE: 1.234,56. `moneda` elige el símbolo. */
export function formatearMonto(monto: number, moneda: FinMoneda): string {
  const simbolo = moneda === "VES" ? "Bs" : moneda === "COP" ? "COP" : "$";
  const texto = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto);
  return moneda === "USDT" ? `${texto} USDT` : `${simbolo} ${texto}`;
}
