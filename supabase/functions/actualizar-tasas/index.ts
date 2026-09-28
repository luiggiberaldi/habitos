// Edge Function actualizar-tasas — Servicio de tasas (Fase 0.4 de Senda).
//
// Acciones (body JSON):
//   {"accion":"actualizar"} — trae BCV/paralelo de DolarAPI y USDT de
//     CriptoYa (fallback: Binance P2P); hace upsert en fin_tasas para la
//     fecha de hoy (America/Caracas). Cada fuente falla por separado sin
//     tumbar a las demás: se conserva el valor previo del campo fallido.
//   {"accion":"manual","bcv":n,"paralelo":n,"usdt":n} — guarda tasas
//     ingresadas a mano por el usuario (fuente "manual").
//
// Auth: header x-tasas-secret igual a TASAS_SECRET. Fail-closed: sin el
// secreto configurado o con valor incorrecto responde 401 y no ejecuta nada.
// verify_jwt=false (la llama pg_cron y el proxy del servidor, no el browser).
import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "America/Caracas";

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta variable de entorno requerida: ${name}`);
  return v;
}

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const TASAS_SECRET = Deno.env.get("TASAS_SECRET") ?? "";
if (!TASAS_SECRET) {
  console.error("TASAS_SECRET no configurado: la función rechaza todo.");
}

/** Fecha YYYY-MM-DD de hoy en America/Caracas. */
function fechaHoy(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** DolarAPI: { promedio } para oficial (BCV) y paralelo. */
async function dolarApi(fuente: "oficial" | "paralelo"): Promise<number | null> {
  try {
    const d = (await fetchJson(
      `https://ve.dolarapi.com/v1/dolares/${fuente}`,
    )) as { promedio?: unknown };
    const v = Number(d?.promedio);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (e) {
    console.error(`DolarAPI ${fuente} falló:`, e);
    return null;
  }
}

/** USDT/VES: promedio de ask/bid de CriptoYa (Binance P2P). */
async function usdtCriptoYa(): Promise<number | null> {
  try {
    const d = (await fetchJson(
      "https://criptoya.com/api/binancep2p/usdt/ves/1",
    )) as { ask?: unknown; bid?: unknown };
    const ask = Number(d?.ask);
    const bid = Number(d?.bid);
    if (Number.isFinite(ask) && Number.isFinite(bid) && ask > 0 && bid > 0) {
      return (ask + bid) / 2;
    }
    return null;
  } catch (e) {
    console.error("CriptoYa falló:", e);
    return null;
  }
}

/** Fallback USDT: mediana de los 5 primeros anuncios BUY de Binance P2P. */
async function usdtBinanceP2P(): Promise<number | null> {
  try {
    const d = (await fetchJson(
      "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: "USDT",
          fiat: "VES",
          merchantCheck: false,
          page: 1,
          payTypes: [],
          publisherType: null,
          rows: 5,
          tradeType: "BUY",
        }),
      },
    )) as { data?: Array<{ adv?: { price?: unknown } }> };
    const precios = (d?.data ?? [])
      .map((x) => Number(x?.adv?.price))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (precios.length === 0) return null;
    const mid = Math.floor(precios.length / 2);
    return precios.length % 2 === 1
      ? precios[mid]
      : (precios[mid - 1] + precios[mid]) / 2;
  } catch (e) {
    console.error("Binance P2P falló:", e);
    return null;
  }
}

function redondear(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Método no permitido" }, { status: 405 });
  }
  const secreto = req.headers.get("x-tasas-secret") ?? "";
  if (!TASAS_SECRET || secreto !== TASAS_SECRET) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const fecha = fechaHoy();
  const { data: previa } = await supabase
    .from("fin_tasas")
    .select("bcv,paralelo,usdt")
    .eq("fecha", fecha)
    .maybeSingle();

  let bcv: number | null = null;
  let paralelo: number | null = null;
  let usdt: number | null = null;
  let fuente = "";

  if (body.accion === "manual") {
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    bcv = num(body.bcv) ?? previa?.bcv ?? null;
    paralelo = num(body.paralelo) ?? previa?.paralelo ?? null;
    usdt = num(body.usdt) ?? previa?.usdt ?? null;
    fuente = "manual";
    if (bcv === null && paralelo === null && usdt === null) {
      return Response.json(
        { error: "Sin valores válidos para guardar" },
        { status: 400 },
      );
    }
  } else if (body.accion === "actualizar") {
    // Las tres fuentes en paralelo: el peor caso es un solo timeout.
    const [bcvApi, paraleloApi, usdtCripto] = await Promise.all([
      dolarApi("oficial"),
      dolarApi("paralelo"),
      usdtCriptoYa(),
    ]);
    let usdtApi = usdtCripto;
    let fuenteUsdt = "CriptoYa";
    if (usdtApi === null) {
      usdtApi = await usdtBinanceP2P();
      fuenteUsdt = "Binance P2P";
    }
    bcv = redondear(bcvApi) ?? previa?.bcv ?? null;
    paralelo = redondear(paraleloApi) ?? previa?.paralelo ?? null;
    usdt = redondear(usdtApi) ?? previa?.usdt ?? null;
    const partes: string[] = [];
    if (bcvApi !== null || paraleloApi !== null) partes.push("DolarAPI");
    if (usdtApi !== null) partes.push(fuenteUsdt);
    fuente = partes.join(" + ") || "sin datos nuevos";
    if (bcv === null && paralelo === null && usdt === null) {
      return Response.json(
        { error: "Todas las fuentes fallaron y no hay tasas guardadas" },
        { status: 502 },
      );
    }
  } else {
    return Response.json(
      { error: 'acción desconocida (usa "actualizar" o "manual")' },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("fin_tasas").upsert(
    {
      fecha,
      bcv,
      paralelo,
      usdt,
      fuente,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fecha" },
  );
  if (error) {
    console.error("Upsert fin_tasas falló:", error);
    return Response.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  return Response.json({ ok: true, fecha, bcv, paralelo, usdt, fuente });
});
