#!/usr/bin/env node
// Puente WhatsApp → Hábitos (Nivel 2): registra un hábito desde lenguaje natural.
//
//   TZ=America/Caracas node scripts/whatsapp-registrar.mjs --q "beber agua" [--dry-run]
//   node scripts/whatsapp-registrar.mjs --habit <id> [--moment <id|HH:MM>] [--fecha YYYY-MM-DD]
//   [--perfil-id <uuid>] (por defecto: el perfil usado más recientemente)
//
// 1. Lee hábitos vía RPC y hace match difuso del query (sin tildes, por tokens).
// 2. Lee historial (400 días) + game_state vía RPC.
// 3. Compila lib/*.ts con el tsc del repo (caché en .cache/whatsapp-lib/) y corre
//    el registrarConJuego REAL → XP, niveles, cofres, logros idénticos a la app.
// 4. Escribe el completion + game_state vía RPC (salvo --dry-run).
// 5. Imprime JSON a stdout para que el agente redacte la respuesta.
//
// Requiere: ~/.config/habitos/rpc-secret (600) o HABITOS_RPC_SECRET,
// y NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local o env.
// El usuario: --user-id o HABITOS_USER_ID.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cargarLib, resolverPerfilId } from "./whatsapp-comun.mjs";

// ── 0. Forzar zona horaria de luigi (madrugadas y todayKey dependen de hora local) ──
if (process.env.TZ !== "America/Caracas") {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, TZ: "America/Caracas" },
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = (obj) => {
  console.log(JSON.stringify(obj));
  process.exit(obj.ok ? 0 : 1);
};
const fail = (codigo, detalle) => out({ ok: false, codigo, detalle });

// ── 1. Argumentos ────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
if (!args.q && !args.habit) fail("args", 'se requiere --q "texto" o --habit <id>');

// ── 2. Config ────────────────────────────────────────────────────────────────
const home = process.env.HOME || "/home/hatch";
function loadSecret() {
  if (process.env.HABITOS_RPC_SECRET) return process.env.HABITOS_RPC_SECRET.trim();
  const p = join(home, ".config", "habitos", "rpc-secret");
  if (!existsSync(p)) fail("sin-secreto", `no existe ${p} ni HABITOS_RPC_SECRET`);
  return readFileSync(p, "utf8").trim();
}
function loadEnv() {
  const env = { ...process.env };
  const leer = (p) => {
    if (!existsSync(p)) return;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  };
  leer(join(root, ".env.local"));
  leer(join(home, ".config", "habitos", "config")); // HABITOS_USER_ID, etc.
  return env;
}
const secret = process.env.HABITOS_MOCK ? "mock" : loadSecret();
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const USER_ID = args["user-id"] || env.HABITOS_USER_ID;
if (!SUPABASE_URL || !ANON_KEY) fail("sin-config", "faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
if (!USER_ID) fail("sin-config", "falta --user-id o HABITOS_USER_ID");

async function rpc(fn, params) {
  if (process.env.HABITOS_MOCK) return mockRpc(fn, params);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "x-habitos-rpc-secret": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) fail("rpc", `${fn}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Datos de prueba para HABITOS_MOCK=1 (no toca la red).
function mockRpc(fn) {
  if (fn === "rpc_habitos_list") {
    return [
      { id: "h-agua", data: { id: "h-agua", nombre: "Tomar agua", tipo: "cantidad", objetivo: 3, dias: [0,1,2,3,4,5,6], momentos: [], estado: "activo", categoria: "salud", color: "#3b82f6", icono: "agua", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
      { id: "h-desayuno", data: { id: "h-desayuno", nombre: "Desayunar", tipo: "momento", objetivo: 1, dias: [0,1,2,3,4,5,6], momentos: [{ id: "m1", tipo: "hora", hora: "08:00" }], estado: "activo", categoria: "salud", color: "#3b82f6", icono: "comida", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
      { id: "h-leer", data: { id: "h-leer", nombre: "Leer", tipo: "momento", objetivo: 1, dias: [1,2,3,4,5], momentos: [{ id: "m1", tipo: "hora", hora: "21:00" }], estado: "activo", categoria: "crecimiento", color: "#7964a9", icono: "libro", creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
      { id: "h-sueno", data: { id: "h-sueno", nombre: "Sueño", tipo: "sueno", objetivo: 2, dias: [0,1,2,3,4,5,6], momentos: [], estado: "activo", categoria: "bienestar", color: "#6366f1", icono: "", horaLevantar: "06:00", horaAcostar: "22:00", objetivoHoras: 8, creadoEn: "2026-01-01", actualizadoEn: "2026-01-01" }, updated_at: "2026-01-01" },
    ];
  }
  if (fn === "rpc_habitos_historial") return [];
  if (fn === "rpc_game_get") return null;
  if (fn === "rpc_perfil_reciente") return "00000000-0000-0000-0000-000000000000";
  if (fn === "rpc_habitos_complete") return true;
  if (fn === "rpc_game_upsert") return true;
  throw new Error(`mock sin datos para ${fn}`);
}

// ── 3. Compilar lib (caché; usa el módulo común con las rutas post-extracción
// lib/core + lib/habitos) ────────────────────────────────────────────────────
const { d, e, g, j, s } = cargarLib();

// ── 4. Match difuso del hábito ───────────────────────────────────────────────
const norm = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const SINONIMOS = { beber: "tomar", ejercicio: "entrenar", correr: "trotar" };
const expandir = (str) => norm(str).split(" ").map((t) => SINONIMOS[t] || t).join(" ");

function matchHabito(habits, q) {
  const nq = expandir(q);
  const activos = habits.filter((h) => h.estado === "activo");
  const rank = activos
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
  return rank;
}

// ── 5. Flujo principal ───────────────────────────────────────────────────────
const main = async () => {
  const hoy = d.todayKey();
  const fecha = args.fecha || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail("args", `--fecha debe ser YYYY-MM-DD`);

  // El registro va al perfil fijado (--perfil-id / HABITOS_PERFIL_ID) o al
  // usado más recientemente en la app (migración 0014: rpc_perfil_reciente).
  const PERFIL_ID = await resolverPerfilId(rpc, USER_ID, args["perfil-id"] || env.HABITOS_PERFIL_ID)
    .catch((e) => fail("sin-perfil", e.message));

  const rows = await rpc("rpc_habitos_list", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID });
  const habits = (rows || []).map((r) => ({ ...r.data, id: r.id }));
  if (habits.length === 0) fail("sin-habitos", "el RPC no devolvió hábitos (¿user-id correcto? ¿secreto configurado?)");

  let habit;
  // Sueño: "me levanté"/"me acosté" van directo al hábito Sueño sin pasar por
  // el match difuso (no matchean el nombre "Sueño").
  let suenoForzado = null;
  if (!args.habit) {
    const nq = norm(args.q || "");
    if (/\bme levante\b/.test(nq) || /\bme desperte\b/.test(nq)) suenoForzado = "levantar";
    else if (/\bme acoste\b/.test(nq) || /\bme dormi\b/.test(nq)) suenoForzado = "acostar";
  }
  if (suenoForzado) {
    const sueno = habits.find((h) => h.tipo === "sueno" && h.estado === "activo");
    if (!sueno) fail("sin-habito", "no hay hábito Sueño activo");
    habit = sueno;
    args.moment = suenoForzado;
  } else if (args.habit) {
    habit = habits.find((h) => h.id === args.habit) || habits.find((h) => norm(h.nombre) === norm(args.habit));
    if (!habit) fail("sin-habito", `no existe hábito ${args.habit}`);
  } else {
    const rank = matchHabito(habits, args.q);
    if (rank.length === 0) {
      fail("sin-match", `ningún hábito activo matchea "${args.q}"`);
    }
    if (rank.length > 1 && rank[0].score === rank[1].score) {
      out({ ok: false, codigo: "ambiguo", detalle: `varios hábitos matchean "${args.q}"`, candidatos: rank.slice(0, 4).map((x) => x.h.nombre) });
      return;
    }
    habit = rank[0].h;
  }
  if (habit.estado !== "activo") fail("inactivo", `el hábito "${habit.nombre}" no está activo`);

  // Sueño: momentos virtuales ("levantar"/"acostar") + XP por puntualidad.
  // Se resuelve antes del flujo normal de momentos (Sueño no tiene `momentos`).
  let registroSueno = null;
  if (habit.tipo === "sueno") {
    const ahora = new Date();
    const hhmmAhora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
    let cual = args.moment === "levantar" || args.moment === "acostar" ? args.moment : null;
    let horaReal = hhmmAhora;
    if (!cual && args.moment) {
      const mm = String(args.moment).match(/^(\d{1,2}):?(\d{2})$/);
      if (mm) horaReal = `${mm[1].padStart(2, "0")}:${mm[2]}`;
    }
    if (!cual) cual = hhmmAhora < "12:00" ? "levantar" : "acostar";
    const fechaSueno = args.fecha || g.fechaParaMarcaSueno(cual, horaReal, ahora);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSueno)) fail("args", "--fecha debe ser YYYY-MM-DD");
    registroSueno = {
      cual,
      fecha: fechaSueno,
      timestamp: d.timestampLocal(fechaSueno, horaReal),
      horaReal,
      eventId: `${habit.id}|${cual}|${fechaSueno}`,
    };
  }

  // Momento: explícito (id o HH:MM) o el más cercano a la hora actual.
  // (Sueño ya resolvió sus momentos virtuales arriba.)
  let momentId;
  let momentoHora = null;
  if (habit.tipo !== "cantidad" && !registroSueno) {
    const moms = habit.momentos || [];
    if (args.moment) {
      const byId = moms.find((m) => m.id === args.moment);
      if (byId) { momentId = byId.id; momentoHora = byId.hora || null; }
      else {
        const mm = String(args.moment).match(/^(\d{1,2}):?(\d{2})$/);
        const hh = mm ? `${mm[1].padStart(2, "0")}:${mm[2]}` : null;
        const byHora = hh && moms.find((m) => m.hora === hh);
        if (!byHora) fail("sin-momento", `momento "${args.moment}" no existe en "${habit.nombre}"`);
        momentId = byHora.id; momentoHora = byHora.hora;
      }
    } else if (moms.length > 0) {
      const ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();
      // Momento anclado: su hora efectiva es la objetivo del sueño (la real
      // solo se conoce después de marcar, y aquí importa la cercanía).
      const horaEfectiva = (m) => {
        if (m.hora) return m.hora;
        if (m.ancla) {
          const s = habits.find((h) => h.tipo === "sueno" && h.estado === "activo");
          if (!s) return null;
          return m.ancla === "levantar" ? (s.horaLevantar || "06:00") : (s.horaAcostar || "22:00");
        }
        return null;
      };
      let best = moms[0], bestD = Infinity;
      for (const m of moms) {
        const he = horaEfectiva(m);
        if (!he) continue;
        const [hh, mi] = he.split(":").map(Number);
        const dd = Math.abs(hh * 60 + mi - ahoraMin);
        if (dd < bestD) { bestD = dd; best = m; }
      }
      momentId = best.id; momentoHora = horaEfectiva(best);
    } else {
      fail("sin-momento", `"${habit.nombre}" no tiene momentos configurados`);
    }
  }

  // Estado remoto → registrarConJuego REAL.
  const desde = d.todayKey(d.addDays(new Date(`${hoy}T12:00:00`), -400));
  const hist = (await rpc("rpc_habitos_historial", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID, p_desde: desde })) || [];
  const completions = hist.map((c) => ({
    id: c.event_id, eventId: c.event_id, habitId: c.habit_id,
    momentId: c.moment_id || undefined, fecha: c.fecha, timestamp: c.created_at,
  }));
  const gj = await rpc("rpc_game_get", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID });
  const juego = gj ? j.normalizarJuego(gj) : j.juegoInicial();
  const estado = {
    habits, completions,
    settings: { notificaciones: false, horasDescanso: { inicio: "22:00", fin: "08:00" }, tema: "sistema" },
    juego, version: 1,
  };

  let eventId, nuevo, eventos;
  let fechaFinal = fecha;
  let momentoIdFinal = momentId;
  if (registroSueno) {
    // Sueño: registro con XP por puntualidad (puede ser negativo).
    eventId = registroSueno.eventId;
    fechaFinal = registroSueno.fecha;
    momentoIdFinal = registroSueno.cual;
    momentoHora = registroSueno.horaReal;
    ({ state: nuevo, eventos } = s.registrarSuenoConJuego(
      estado, habit.id, registroSueno.cual, registroSueno.fecha, registroSueno.timestamp, eventId,
    ));
  } else {
    const timestamp = new Date().toISOString();
    eventId = e.construirEventId(habit.id, momentId, fecha);
    ({ state: nuevo, eventos } = s.registrarConJuego(estado, habit.id, momentId, fecha, timestamp, undefined, eventId));
  }
  if (nuevo.completions.length === estado.completions.length) {
    out({ ok: false, codigo: "ya-registrado", detalle: `"${habit.nombre}" ya estaba registrado`, habito: habit.nombre });
    return;
  }

  if (!args["dry-run"]) {
    const okComplete = await rpc("rpc_habitos_complete", {
      p_user_id: USER_ID, p_perfil_id: PERFIL_ID, p_event_id: eventId, p_habit_id: habit.id,
      p_moment_id: momentoIdFinal || null, p_fecha: fechaFinal,
    });
    if (!okComplete) fail("rpc", "rpc_habitos_complete devolvió false (¿duplicado?)");
    await rpc("rpc_game_upsert", { p_user_id: USER_ID, p_perfil_id: PERFIL_ID, p_data: nuevo.juego });
  }

  const hechos = d.completadosPara(habit, fechaFinal, nuevo.completions).size;
  const objetivo = g.objetivoEnFecha(habit, fechaFinal);
  const xpGanado = nuevo.juego.xpTotal - juego.xpTotal;
  const nivel = g.nivelParaXp(nuevo.juego.xpTotal);
  out({
    ok: true,
    habito: habit.nombre,
    tipo: habit.tipo,
    momentoHora,
    fecha: fechaFinal,
    eventId,
    xpGanado,
    xpTotal: nuevo.juego.xpTotal,
    xpSemanal: nuevo.juego.xpSemanal,
    nivel: { nivel: nivel.nivel, nombre: nivel.nombre },
    progreso: { hechos, objetivo },
    eventos: eventos.map((ev) => ({ tipo: ev.tipo, titulo: ev.titulo, detalle: ev.detalle, dato: ev.dato || null })),
    dryRun: !!args["dry-run"],
  });
};

main().catch((err) => fail("excepcion", String(err && err.message || err).slice(0, 500)));
