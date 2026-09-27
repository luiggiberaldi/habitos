// Módulo común para los scripts de WhatsApp de Hábitos (ESM).
// Config, RPC, mock, compilación de lib/* y match difuso. No ejecuta nada al importarse.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME || "/home/hatch";

// ── Config ───────────────────────────────────────────────────────────────────
export function cargarConfig(args = {}) {
  const loadSecret = () => {
    if (process.env.HABITOS_RPC_SECRET) return process.env.HABITOS_RPC_SECRET.trim();
    const p = join(home, ".config", "habitos", "rpc-secret");
    if (!existsSync(p)) throw new Error(`sin-secreto: no existe ${p} ni HABITOS_RPC_SECRET`);
    return readFileSync(p, "utf8").trim();
  };
  const env = { ...process.env };
  for (const p of [join(root, ".env.local"), join(home, ".config", "habitos", "config")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const secret = process.env.HABITOS_MOCK ? "mock" : loadSecret();
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const USER_ID = args["user-id"] || env.HABITOS_USER_ID;
  if (!SUPABASE_URL || !ANON_KEY) throw new Error("sin-config: faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  if (!USER_ID) throw new Error("sin-config: falta --user-id o HABITOS_USER_ID");
  return { secret, SUPABASE_URL, ANON_KEY, USER_ID };
}

// ── RPC ──────────────────────────────────────────────────────────────────────
function mockRpc(fn) {
  if (fn === "rpc_habitos_list") {
    return [
      { id: "h-agua", data: { id: "h-agua", nombre: "Tomar agua", tipo: "cantidad", objetivo: 8, unidad: "vasos", dias: [0, 1, 2, 3, 4, 5, 6], momentos: [], estado: "activo", categoria: "salud", color: "#3b82f6", icono: "", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
      { id: "h-desayuno", data: { id: "h-desayuno", nombre: "Desayunar", tipo: "momento", objetivo: 1, dias: [0, 1, 2, 3, 4, 5, 6], momentos: [{ id: "m1", tipo: "hora", hora: "08:00" }], estado: "activo", categoria: "salud", color: "#3b82f6", icono: "", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
      { id: "h-leer", data: { id: "h-leer", nombre: "Leer", tipo: "momento", objetivo: 1, dias: [1, 2, 3, 4, 5], momentos: [{ id: "m1", tipo: "ventana", ventana: "noche" }], estado: "activo", categoria: "crecimiento", color: "#7964a9", icono: "", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
    ];
  }
  if (fn === "rpc_habitos_historial") return [];
  if (fn === "rpc_game_get") return null;
  if (fn === "rpc_perfil_reciente") return "00000000-0000-0000-0000-000000000000";
  if (fn === "rpc_habitos_complete") return true;
  if (fn === "rpc_habitos_upsert") return true;
  if (fn === "rpc_game_upsert") return true;
  throw new Error(`mock sin datos para ${fn}`);
}

export function crearRpc(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) return mockRpc(fn, params);
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.ANON_KEY,
        Authorization: `Bearer ${cfg.ANON_KEY}`,
        "x-habitos-rpc-secret": cfg.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}

// ── Perfil activo ────────────────────────────────────────────────────────────────
// El puente escribe en UN perfil: el fijado con --perfil-id / HABITOS_PERFIL_ID,
// o el usado más recientemente en la app (RPC rpc_perfil_reciente, migración 0014).
export async function resolverPerfilId(rpc, USER_ID, fijo) {
  if (fijo) return fijo;
  const id = await rpc("rpc_perfil_reciente", { p_user_id: USER_ID });
  if (!id) {
    throw new Error(
      "sin-perfil: la cuenta no tiene perfiles todavía — crea uno en la app (o pasa --perfil-id)"
    );
  }
  return id;
}

// ── Compilar lib/* con tsc (caché) ───────────────────────────────────────────
export function cargarLib() {
  const cacheDir = join(root, ".cache", "whatsapp-lib");
  const fuentes = ["habitos/types.ts", "habitos/dates.ts", "core/event-id.ts", "habitos/gamificacion.ts", "habitos/juego.ts", "habitos/store.ts"];
  const marcador = join(cacheDir, ".built-at");
  let recompilar = !existsSync(marcador);
  if (!recompilar) {
    const builtAt = statSync(marcador).mtimeMs;
    recompilar = fuentes.some((f) => statSync(join(root, "lib", f)).mtimeMs > builtAt);
  }
  if (recompilar) {
    mkdirSync(cacheDir, { recursive: true });
    try {
      execFileSync(join(root, "node_modules", ".bin", "tsc"), [
        ...fuentes.map((f) => join(root, "lib", f)),
        "--outDir", cacheDir,
        "--module", "commonjs",
        "--target", "es2020",
        "--moduleResolution", "node",
        "--skipLibCheck",
      ], { stdio: "pipe" });
      writeFileSync(marcador, String(Date.now()));
    } catch (e) {
      throw new Error(`tsc: ${String(e.stderr || e.message).slice(0, 500)}`);
    }
  }
  const req = createRequire(join(cacheDir, "cargador.cjs"));
  return {
    d: req(join(cacheDir, "habitos", "dates.js")),
    e: req(join(cacheDir, "core", "event-id.js")),
    g: req(join(cacheDir, "habitos", "gamificacion.js")),
    j: req(join(cacheDir, "habitos", "juego.js")),
    s: req(join(cacheDir, "habitos", "store.js")),
  };
}

// ── Match difuso ─────────────────────────────────────────────────────────────
export const norm = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SINONIMOS = { beber: "tomar", ejercicio: "entrenar", correr: "trotar" };
export const expandir = (str) => norm(str).split(" ").map((t) => SINONIMOS[t] || t).join(" ");

export function matchHabito(habits, q) {
  const nq = expandir(q);
  return habits
    .filter((h) => h.estado === "activo")
    .map((h) => {
      const nh = expandir(h.nombre);
      let score = 0;
      if (nh === nq) score = 100;
      else if (nh.includes(nq) || nq.includes(nh)) score = 80;
      else {
        const tq = new Set(nq.split(" ").filter((t) => t.length > 2));
        const th = new Set(nh.split(" "));
        const inter = [...tq].filter((t) => th.has(t));
        if (inter.length > 0) score = 40 + 10 * inter.length;
      }
      return { h, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── Estado remoto normalizado ────────────────────────────────────────────────
export async function cargarEstado(rpc, USER_ID, PERFIL_ID, lib, diasHistorial = 400) {
  const { d, j } = lib;
  const hoy = d.todayKey();
  const rows = await rpc("rpc_habitos_list", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID });
  const habits = (rows || []).map((r) => ({ ...r.data, id: r.id }));
  const desde = d.todayKey(d.addDays(new Date(`${hoy}T12:00:00`), -diasHistorial));
  const hist = (await rpc("rpc_habitos_historial", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID, p_desde: desde })) || [];
  const completions = hist.map((c) => ({
    id: c.event_id, eventId: c.event_id, habitId: c.habit_id,
    momentId: c.moment_id || undefined, fecha: c.fecha, timestamp: c.created_at,
  }));
  const gj = await rpc("rpc_game_get", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID });
  const juego = gj ? j.normalizarJuego(gj) : j.juegoInicial();
  return { habits, completions, juego, hoy };
}

/** ¿El hábito aplica hoy? (días programados + posposición puntual) */
export function aplicaHoy(h, hoy) {
  if (h.estado !== "activo") return false;
  if (h.pospuestoHasta && h.pospuestoHasta > hoy) return false;
  const dow = new Date(`${hoy}T12:00:00`).getDay();
  return (h.dias || []).includes(dow) || h.pospuestoHasta === hoy;
}

export function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
