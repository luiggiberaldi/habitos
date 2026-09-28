import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/tasas — Proxy servidor de tasas (Fase 0.4).
 * Devuelve la última fila de fin_tasas; si está desactualizada (o viene
 * ?refresh=1) invoca la Edge Function actualizar-tasas ANTES de responder
 * ("refresco al abrir"). Si todo falla, devuelve la última guardada con
 * desactualizada=true (fallback en cadena); si no hay ninguna, 503.
 *
 * POST /api/tasas — { bcv?, paralelo?, usdt? } guarda tasas manuales
 * (fuente "manual") vía la Edge Function.
 */

export const dynamic = "force-dynamic";

const TZ = "America/Caracas";
const STALE_MS = 2 * 60 * 60 * 1000; // 2h: el cron horario la mantiene fresca

type FilaTasa = {
  fecha: string;
  bcv: number | null;
  paralelo: number | null;
  usdt: number | null;
  fuente: string;
  updated_at: string;
};

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function fechaHoy(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function leerUltima(): Promise<FilaTasa | null> {
  const sb = supabaseAnon();
  if (!sb) return null;
  const { data, error } = await sb
    .from("fin_tasas")
    .select("fecha,bcv,paralelo,usdt,fuente,updated_at")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as FilaTasa;
}

function estaDesactualizada(t: FilaTasa | null): boolean {
  if (!t) return true;
  if (t.fecha !== fechaHoy()) return true;
  return Date.now() - new Date(t.updated_at).getTime() > STALE_MS;
}

/** Invoca la Edge Function con el secreto de servidor (nunca llega al browser). */
async function invocarFuncion(body: Record<string, unknown>): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secreto = process.env.TASAS_SECRET;
  if (!url || !secreto) return false;
  try {
    const r = await fetch(`${url}/functions/v1/actualizar-tasas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tasas-secret": secreto,
      },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function respuesta(t: FilaTasa) {
  return NextResponse.json({
    ok: true,
    fecha: t.fecha,
    bcv: t.bcv,
    paralelo: t.paralelo,
    usdt: t.usdt,
    fuente: t.fuente,
    actualizadaEn: t.updated_at,
    desactualizada: estaDesactualizada(t),
  });
}

export async function GET(req: Request) {
  const forzar = new URL(req.url).searchParams.get("refresh") === "1";
  let tasa = await leerUltima();
  if (forzar || estaDesactualizada(tasa)) {
    const ok = await invocarFuncion({ accion: "actualizar" });
    if (ok) tasa = await leerUltima();
  }
  if (!tasa) {
    return NextResponse.json(
      { ok: false, error: "Sin tasas disponibles" },
      { status: 503 },
    );
  }
  return respuesta(tasa);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const bcv = num(body.bcv);
  const paralelo = num(body.paralelo);
  const usdt = num(body.usdt);
  if (bcv === undefined && paralelo === undefined && usdt === undefined) {
    return NextResponse.json(
      { ok: false, error: "Indica al menos una tasa válida" },
      { status: 400 },
    );
  }
  const ok = await invocarFuncion({
    accion: "manual",
    ...(bcv !== undefined ? { bcv } : {}),
    ...(paralelo !== undefined ? { paralelo } : {}),
    ...(usdt !== undefined ? { usdt } : {}),
  });
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "No se pudo guardar" },
      { status: 502 },
    );
  }
  const tasa = await leerUltima();
  if (!tasa) {
    return NextResponse.json({ ok: false, error: "Sin tasas" }, { status: 503 });
  }
  return respuesta(tasa);
}
