#!/usr/bin/env node
// Smoke tests de la capa de juego (Tier 1 + Tier 2) — sin dependencias externas.
//
// Compila lib/types.ts, lib/dates.ts, lib/event-id.ts, lib/gamificacion.ts,
// lib/juego.ts y lib/store.ts con el tsc del repo a un directorio temporal
// y aserta:
//   - Niveles: umbrales, nombres y progreso 0..1.
//   - inicioSemana: el lunes de una fecha dada.
//   - rachaActual respeta días protegidos por congelador.
//   - congeladorAutomatico protege el día fallado más reciente (uno por día),
//     sin quemar congeladores de usuarios nuevos.
//   - registrarConJuego otorga XP (+bonus por objetivo) y es idempotente
//     ante taps duplicados.
//   - El cofre del día completo se otorga una sola vez por fecha.
//   - Cada 7 días de racha se gana un congelador (tope 2).
//   - logrosNuevos detecta hitos de racha y de madrugador.
//   - fusionarJuego converge por máximos/unión.
//   - reconciliarJuego hace backfill de XP histórico y es idempotente.
//   - Desafíos semanales: se generan y miden progreso.
//
// Salida: código 0 si todo pasa, 1 si algo falla.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let ok = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    ok++;
    console.log(`OK: ${name}`);
  } else {
    fail++;
    console.log(`FALLA: ${name}`);
  }
};

// 1. Compilar las fuentes puras con el tsc del repo.
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-juego-"));
try {
  const tscBin = join(root, "node_modules", ".bin", "tsc");
  execFileSync(
    tscBin,
    [
      join(root, "lib", "types.ts"),
      join(root, "lib", "dates.ts"),
      join(root, "lib", "event-id.ts"),
      join(root, "lib", "gamificacion.ts"),
      join(root, "lib", "juego.ts"),
      join(root, "lib", "store.ts"),
      "--outDir", outDir,
      "--module", "commonjs",
      "--target", "es2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  console.log("FALLA: compilación con tsc del repo");
  const detail = e.stderr ? String(e.stderr) : String(e.message);
  console.log(detail.slice(0, 2000));
  process.exit(1);
}

const req = createRequire(join(outDir, "cargador.cjs"));
const g = req(join(outDir, "gamificacion.js"));
const j = req(join(outDir, "juego.js"));
const s = req(join(outDir, "store.js"));
const d = req(join(outDir, "dates.js"));

// ── Utilidades ─────────────────────────────────────────────────────────────
const hoy = d.todayKey();
const hace = (n) => d.todayKey(d.addDays(new Date(`${hoy}T12:00:00`), -n));

const mkHabit = (over = {}) => ({
  id: "h1",
  nombre: "Leer",
  icono: "📖",
  color: "#7964a9",
  categoria: "crecimiento",
  dias: [0, 1, 2, 3, 4, 5, 6],
  objetivo: 1,
  momentos: [{ id: "m1", tipo: "hora", hora: "23:00" }],
  estado: "activo",
  creadoEn: "2026-01-01T00:00:00.000Z",
  actualizadoEn: "2026-01-01T00:00:00.000Z",
  tipo: "momento",
  ...over,
});

const mkCompletion = (habitId, momentId, fecha) => ({
  id: `${habitId}|${momentId}|${fecha}`,
  eventId: `${habitId}|${momentId}|${fecha}`,
  habitId,
  momentId,
  fecha,
  timestamp: `${fecha}T18:00:00.000Z`,
});

const mkState = (habits, completions, juegoOver = {}) => ({
  habits,
  completions,
  settings: { notificaciones: false, horasDescanso: { inicio: "22:00", fin: "08:00" }, tema: "sistema" },
  juego: { ...j.juegoInicial(), ...juegoOver },
  version: 1,
});

// ── Niveles ────────────────────────────────────────────────────────────────
{
  const n0 = g.nivelParaXp(0);
  check("nivel 1 = Novato con 0 XP", n0.nivel === 1 && n0.nombre === "Novato");
  const n2 = g.nivelParaXp(150);
  check("150 XP = nivel 2", n2.nivel === 2);
  const n9 = g.nivelParaXp(6000);
  check("6000 XP = nivel 9 Leyenda (máximo)", n9.nivel === 9 && n9.nombre === "Leyenda" && n9.xpSiguiente === null);
  check("progreso siempre en [0,1]", n0.progreso >= 0 && n0.progreso <= 1 && n2.progreso >= 0 && n2.progreso <= 1);
  const nCerca = g.nivelParaXp(399);
  check("a 1 XP del nivel 3 el progreso es casi 1", nCerca.progreso > 0.99 && nCerca.nivel === 2);
}

// ── inicioSemana ───────────────────────────────────────────────────────────
{
  // 2026-09-26 es sábado → lunes 2026-09-21.
  check("inicioSemana(2026-09-26) = 2026-09-21", d.inicioSemana("2026-09-26") === "2026-09-21");
  check("inicioSemana de un lunes es él mismo", d.inicioSemana("2026-09-21") === "2026-09-21");
  check("inicioSemana de un domingo retrocede 6", d.inicioSemana("2026-09-27") === "2026-09-21");
}

// ── Racha con días protegidos ──────────────────────────────────────────────
{
  const habit = mkHabit();
  const comps = [hace(3), hace(2)].map((f) => mkCompletion("h1", "m1", f));
  const sinProteccion = g.rachaActual(habit, hoy, comps, [], "10:00");
  check("sin protección, el día fallado de ayer rompe la racha", sinProteccion === 0);
  const conProteccion = g.rachaActual(habit, hoy, comps, [hace(1)], "10:00");
  check("con ayer protegido, la racha cuenta 2 días", conProteccion === 2);
}

// ── Congelador automático ──────────────────────────────────────────────────
{
  const habit = mkHabit();
  const comps = [hace(3), hace(2)].map((f) => mkCompletion("h1", "m1", f));
  const juego = { ...j.juegoInicial(), congeladores: 1 };
  const res = g.congeladorAutomatico(juego, [habit], comps, hoy);
  check("protege ayer y gasta 1 congelador", res.congeladores === 0 && res.diasProtegidos.includes(hace(1)));
  // Usuario nuevo: sin actividad anterior, no quema congeladores.
  const nuevo = g.congeladorAutomatico({ ...j.juegoInicial(), congeladores: 2 }, [habit], [], hoy);
  check("usuario nuevo: no gasta congeladores", nuevo.congeladores === 2 && nuevo.diasProtegidos.length === 0);
  // Dos días fallados seguidos con 2 congeladores: protege ambos.
  const comps2 = [hace(4)].map((f) => mkCompletion("h1", "m1", f));
  const res2 = g.congeladorAutomatico({ ...j.juegoInicial(), congeladores: 2 }, [habit], comps2, hoy);
  check(
    "2 fallos seguidos + 2 congeladores = ambos protegidos",
    res2.congeladores === 0 && res2.diasProtegidos.includes(hace(1)) && res2.diasProtegidos.includes(hace(2)),
  );
}

// ── registrarConJuego: XP + idempotencia ───────────────────────────────────
{
  // Hábito con 2 momentos y objetivo 2: el primer registro da 10 XP sin
  // bonus (objetivo no alcanzado) y sin cofre (día no completo).
  const habit2 = mkHabit({
    objetivo: 2,
    momentos: [
      { id: "m1", tipo: "hora", hora: "09:00" },
      { id: "m2", tipo: "hora", hora: "23:00" },
    ],
  });
  const st = mkState([habit2], []);
  const r1 = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check("un registro da 10 XP sin bonus si no alcanza el objetivo", r1.state.juego.xpTotal === 10);
  check("el XP semanal también sube", r1.state.juego.xpSemanal === 10);
  check("sin día completo no hay cofre", r1.eventos.every((e) => e.tipo !== "cofre"));
  // Segundo momento: alcanza el objetivo (+5) y completa el día (+cofre).
  const r2 = s.registrarConJuego(r1.state, "h1", "m2", hoy, `${hoy}T18:00:00.000Z`);
  check(
    "al cumplir el objetivo y el día: +5 bonus + cofre",
    r2.state.juego.xpTotal >= 45 || r2.state.juego.congeladores === 1,
  );
  check("hay eventos de juego (cofre por día completo)", r2.eventos.some((e) => e.tipo === "cofre"));
  const r3 = s.registrarConJuego(r2.state, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check(
    "tap duplicado: sin XP extra ni eventos",
    r3.state.juego.xpTotal === r2.state.juego.xpTotal && r3.eventos.length === 0,
  );
}

// ── Cofre: una sola vez por fecha ──────────────────────────────────────────
{
  const habit = mkHabit();
  const st = mkState([habit], []);
  const r1 = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const xpTrasCofre = r1.state.juego.xpTotal;
  check("día completo otorga cofre (XP > 15 o congelador)", xpTrasCofre > 15 || r1.state.juego.congeladores === 1);
  check("ultimoCofre queda marcado", r1.state.juego.ultimoCofre === hoy);
  // Deshacer y volver a registrar: el cofre NO se otorga dos veces.
  const deshecho = s.deshacerCumplimiento(r1.state, `h1|m1|${hoy}`);
  const r3 = s.registrarConJuego(deshecho, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const cofres = r3.eventos.filter((e) => e.tipo === "cofre").length;
  check("el cofre no se repite en la misma fecha", cofres === 0);
}

// ── Congelador cada 7 días de racha ────────────────────────────────────────
{
  const habit = mkHabit();
  const comps = [6, 5, 4, 3, 2, 1].map((n) => mkCompletion("h1", "m1", hace(n)));
  const st = mkState([habit], comps);
  const r = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  // El cofre del día completo tiene 25% de dar un congelador extra, así que
  // el total puede ser 1 (solo racha) o 2 (racha + cofre).
  check("al llegar a 7 días de racha se gana ≥1 congelador", r.state.juego.congeladores >= 1);
  check("se emite evento de congelador ganado", r.eventos.some((e) => e.tipo === "congelador-ganado"));
  check("racha máxima histórica = 7", r.state.juego.rachaMaxima.h1 === 7);
}

// ── Logros ─────────────────────────────────────────────────────────────────
{
  const juego = { ...j.juegoInicial(), rachaMaxima: { h1: 7 }, madrugadas: 5 };
  const nuevos = g.logrosNuevos({ juego, habits: [mkHabit()], completions: [], hoy });
  check("racha de 7 → logro racha-7", nuevos.includes("racha-7"));
  check("5 madrugadas → logro madrugador", nuevos.includes("madrugador"));
  check("no repite logros ya desbloqueados", g.logrosNuevos({
    juego: { ...juego, logros: ["racha-7", "madrugador"] },
    habits: [mkHabit()], completions: [], hoy,
  }).length === 0);
}

// ── Fusión entre dispositivos ──────────────────────────────────────────────
{
  const a = { ...j.juegoInicial(), xpTotal: 100, logros: ["racha-7"], congeladores: 1, diasProtegidos: ["2026-09-20"] };
  const b = { ...j.juegoInicial(), xpTotal: 150, logros: ["madrugador"], congeladores: 0, diasProtegidos: ["2026-09-21"] };
  const f = j.fusionarJuego(a, b);
  check("xpTotal = máximo", f.xpTotal === 150);
  check("logros = unión", f.logros.includes("racha-7") && f.logros.includes("madrugador"));
  check("congeladores = máximo", f.congeladores === 1);
  check("días protegidos = unión", f.diasProtegidos.length === 2);
  check("sin remoto no rompe", j.fusionarJuego(a, null).xpTotal === 100);
}

// ── Reconciliación: backfill idempotente ────────────────────────────────────
{
  const habit = mkHabit();
  const comps = [hace(2), hace(1)].map((f) => mkCompletion("h1", "m1", f));
  const st = mkState([habit], comps, { xpTotal: 0 });
  const r1 = j.reconciliarJuego(st);
  check("backfill: XP histórico > 0", r1.juego.xpTotal > 0);
  // 2 registros (10 c/u) + 2 bonus de objetivo (5 c/u) = 30.
  check("backfill: 2 registros + 2 objetivos = 30 XP", r1.juego.xpTotal === 30);
  const r2 = j.reconciliarJuego(r1);
  check("reconciliar dos veces no cambia nada (misma referencia)", r2 === r1);
}

// ── Desafíos semanales ─────────────────────────────────────────────────────
{
  const habit = mkHabit();
  const st = mkState([habit], []);
  const semana = d.inicioSemana(hoy);
  const conDesafios = g.asegurarDesafios(st.juego, [habit], [], semana, hoy);
  check("se genera 1 desafío para el hábito activo", conDesafios.desafios.length === 1);
  check("el desafío pertenece a esta semana", conDesafios.desafios[0].semana === semana);
  const otraVez = g.asegurarDesafios(conDesafios, [habit], [], semana, hoy);
  check("no duplica desafíos de la misma semana", otraVez === conDesafios);
  const dias = g.diasCumplidosEnSemana(habit, semana, hoy, [mkCompletion("h1", "m1", hoy)], []);
  check("diasCumplidosEnSemana cuenta el día de hoy", dias >= 1);
}

// ── Día completo ───────────────────────────────────────────────────────────
{
  const habit = mkHabit();
  check("día sin registros no está completo", g.diaCompleto([habit], hoy, [], []) === false);
  check(
    "día con objetivo cumplido está completo",
    g.diaCompleto([habit], hoy, [mkCompletion("h1", "m1", hoy)], []) === true,
  );
  check("sin hábitos programados no hay día completo", g.diaCompleto([], hoy, [], []) === false);
}

// ── Frase de identidad ─────────────────────────────────────────────────────
{
  const f1 = g.fraseIdentidad([mkHabit()], { ...j.juegoInicial(), rachaMaxima: { h1: 35 } });
  check("racha ≥30 → frase de identidad", typeof f1 === "string" && f1.includes("35"));
  const f2 = g.fraseIdentidad([mkHabit()], { ...j.juegoInicial(), rachaMaxima: { h1: 10 } });
  check("racha ≥7 → frase de constancia", typeof f2 === "string" && f2.includes("10"));
  const f3 = g.fraseIdentidad([], j.juegoInicial());
  check("sin datos → sin frase (null)", f3 === null);
}

// ── normalizarEstado trae juego ────────────────────────────────────────────
{
  const crudo = { habits: [], completions: [], settings: null };
  const n = s.normalizarEstado(crudo);
  check("normalizarEstado rellena juego por defecto", n.juego && n.juego.xpTotal === 0 && Array.isArray(n.juego.logros));
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
