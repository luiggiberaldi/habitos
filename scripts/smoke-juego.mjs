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
//   - deshacerConJuego revierte el XP otorgado (anti-farmeo): base + bonus
//     solo si el día deja de cumplir el objetivo; xpSemanal solo si el evento
//     es de la semana en curso; madrugadas si fue antes de las 8 a. m.
//   - logrosNuevos: semana-perfecta con día de descanso total, y sin hábitos
//     no desbloquea.
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
      join(root, "lib", "habitos", "types.ts"),
      join(root, "lib", "habitos", "dates.ts"),
      join(root, "lib", "core", "event-id.ts"),
      join(root, "lib", "habitos", "gamificacion.ts"),
      join(root, "lib", "habitos", "juego.ts"),
      join(root, "lib", "habitos", "store.ts"),
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
const g = req(join(outDir, "habitos", "gamificacion.js"));
const j = req(join(outDir, "habitos", "juego.js"));
const s = req(join(outDir, "habitos", "store.js"));
const d = req(join(outDir, "habitos", "dates.js"));

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

// Los tests de XP base aíslan la mecánica pre-desbloqueando todo el catálogo:
// así logrosNuevos no suma XP extra en sus fixtures.
const TODOS_LOS_LOGROS = g.LOGROS.map((l) => l.id);
const sinLogrosNuevos = { logros: TODOS_LOS_LOGROS };

// ── Niveles ────────────────────────────────────────────────────────────────
{
  const n0 = g.nivelParaXp(0);
  check("nivel 1 = Chispa con 0 XP", n0.nivel === 1 && n0.nombre === "Chispa");
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
  const st = mkState([habit2], [], sinLogrosNuevos);
  const r1 = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check("un registro da 10 XP sin bonus si no alcanza el objetivo", r1.state.juego.xpTotal === 10);
  check("el XP semanal también sube", r1.state.juego.xpSemanal === 10);
  check("sin día completo no hay cofre", r1.eventos.every((e) => e.tipo !== "cofre"));
  // Segundo momento: alcanza el objetivo (+5) y completa el día (+cofre).
  const r2 = s.registrarConJuego(r1.state, "h1", "m2", hoy, `${hoy}T18:00:00.000Z`);
  check(
    "al cumplir el objetivo y el día: +5 bonus + cofre",
    r2.state.juego.xpTotal >= 40 || r2.state.juego.congeladores === 1, // 10+10+5+15 (cofre mínimo en nivel 1)
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
    juego: { ...juego, logros: ["racha-3", "racha-7", "madrugador", "primer-habito"] },
    habits: [mkHabit()], completions: [], hoy,
  }).length === 0);
  check("todo logro otorga XP positivo", g.LOGROS.every((l) => l.xp > 0));
  check("todo logro trae mensaje de ánimo", g.LOGROS.every((l) => l.mensaje.trim().length > 0));
  check("catálogo ampliado (29 logros)", g.LOGROS.length === 29);
}

// ── Logros: desbloqueo sin XP automático ────────────────────────────────────
{
  // Al registrar con el catálogo bloqueado, el primer hábito desbloquea
  // "primer-habito" (+10 XP) pero el XP NO se acredita solo: queda pendiente
  // de reclamo con un tap en la sala de trofeos.
  const st = mkState([mkHabit()], []);
  const r = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const evLogro = r.eventos.find((e) => e.tipo === "logro" && e.dato === "primer-habito");
  // El cofre del día completo es aleatorio: se lee su XP del evento para un assert exacto.
  const evCofre = r.eventos.find((e) => e.tipo === "cofre");
  const xpCofre = evCofre && evCofre.dato !== "congelador" ? Number(String(evCofre.dato).split(":")[1] || 0) : 0;
  check("desbloquear un logro NO suma XP al total (queda por reclamar)", r.state.juego.xpTotal === 15 + xpCofre); // 10 base + 5 bonus objetivo (+cofre)
  check("el logro queda guardado pero sin reclamar", r.state.juego.logros.includes("primer-habito") && !r.state.juego.logrosReclamados.includes("primer-habito"));
  check("hay 3 premios pendientes", j.premiosPendientes(r.state.juego) === 3); // dia-perfecto + primer-habito + cofre-1
  check("el evento de logro invita a reclamar en la sala", !!evLogro && evLogro.detalle.includes("sala de trofeos") && evLogro.detalle.includes("+10 XP"));
  // Deshacer no revoca el hito: los logros son para siempre por diseño.
  const st2 = s.deshacerConJuego(r.state, `h1|m1|${hoy}`);
  check("deshacer no revoca el logro desbloqueado", st2.juego.logros.includes("primer-habito"));
  check("deshacer devuelve base+bonus", st2.juego.xpTotal === r.state.juego.xpTotal - 15);
  // El backfill silencioso desbloquea sin otorgar XP (queda por reclamar).
  const rb = j.reconciliarJuego(mkState([mkHabit()], []));
  check("reconciliar desbloquea en silencio sin XP", rb.juego.xpTotal === 0 && rb.juego.logros.includes("primer-habito") && j.premiosPendientes(rb.juego) === 1);
}

// ── Reclamo de premios por tap ──────────────────────────────────────────────
{
  const st = mkState([mkHabit()], []);
  const r = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const antes = r.state.juego.xpTotal;
  // Reclamar otorga el XP una sola vez.
  const c1 = j.reclamarLogro(r.state, "primer-habito");
  check("reclamar otorga el XP del logro", c1.xpGanado === 10 && c1.state.juego.xpTotal === antes + 10);
  check("reclamar marca el logro como reclamado", c1.state.juego.logrosReclamados.includes("primer-habito"));
  check("reclamar NO toca el XP semanal (la liga mide actividad reciente)", c1.state.juego.xpSemanal === r.state.juego.xpSemanal);
  check("quedan 2 premios pendientes", j.premiosPendientes(c1.state.juego) === 2);
  // Reclamar los demás deja la sala en cero.
  const c1b = j.reclamarLogro(c1.state, "dia-perfecto");
  const c1c = j.reclamarLogro(c1b.state, "cofre-1");
  check("reclamar todo deja 0 pendientes", j.premiosPendientes(c1c.state.juego) === 0);
  // Segundo tap: idempotente, no duplica XP.
  const c2 = j.reclamarLogro(c1.state, "primer-habito");
  check("reclamar dos veces no duplica el XP", c2.xpGanado === 0 && c2.state.juego.xpTotal === antes + 10);
  // Logro no desbloqueado: no hace nada.
  const c3 = j.reclamarLogro(r.state, "racha-7");
  check("reclamar un logro bloqueado no otorga nada", c3.xpGanado === 0 && c3.state === r.state);
  // Reclamar puede subir de nivel (objetivo 2 evita el cofre aleatorio).
  const stN = mkState([mkHabit({ objetivo: 2 })], [], { xpTotal: 135, xpSemanal: 0 });
  const rN = s.registrarConJuego(stN, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`); // +10 → 145 (nivel 1)
  check("sin cofre el XP tras registrar es exacto", rN.state.juego.xpTotal === 145);
  const cN = j.reclamarLogro(rN.state, "primer-habito"); // +10 → 155 (nivel 2)
  check("reclamar detecta subida de nivel", cN.subioNivel !== null && cN.subioNivel.nivel === 2);
  // Migración: logros desbloqueados antes del reclamo por tap ya tenían su
  // XP acreditado, así que nacen marcados como reclamados.
  const viejo = j.normalizarJuego({ logros: ["primer-habito"] });
  check("migración marca como reclamados los logros viejos", viejo.logrosReclamados.includes("primer-habito"));
  check("migración no deja premios pendientes fantasma", j.premiosPendientes(viejo) === 0);
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
  const st = mkState([habit], comps, { xpTotal: 0, ...sinLogrosNuevos });
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

// ── deshacerConJuego revierte el XP (anti-farmeo) ──────────────────────────
{
  const h1 = mkHabit({ momentos: [{ id: "m1", tipo: "hora", hora: "23:00" }] });
  const h2 = mkHabit({ id: "h2", nombre: "Otro", momentos: [{ id: "m2", tipo: "hora", hora: "23:00" }] });
  const st0 = mkState([h1, h2], [], sinLogrosNuevos);
  const r1 = s.registrarConJuego(st0, "h1", "m1", hoy);
  // 10 base + 5 bonus (objetivo 1 cruzado); sin cofre porque h2 sigue pendiente.
  check("registrar otorga 10+5 de XP", r1.state.juego.xpTotal === 15 && r1.state.juego.xpSemanal === 15);
  const eid = `h1|m1|${hoy}`;
  const st1 = s.deshacerConJuego(r1.state, eid);
  check("deshacer revierte base+bonus y xpSemanal", st1.juego.xpTotal === 0 && st1.juego.xpSemanal === 0);
  check("deshacer elimina el evento", st1.completions.length === 0);
  // Ciclo completo marcar→desmarcar→marcar→desmarcar: neto cero, sin farmeo.
  const r2 = s.registrarConJuego(st1, "h1", "m1", hoy);
  const st2 = s.deshacerConJuego(r2.state, eid);
  check("ciclo marcar→desmarcar no farmea XP", st2.juego.xpTotal === 0 && st2.juego.xpSemanal === 0);
  const nada = s.deshacerConJuego(st2, "inexistente");
  check("deshacer evento inexistente no cambia nada", nada.juego.xpTotal === 0);
}

{
  // El bonus solo se devuelve si el día deja de cumplir el objetivo.
  const h = mkHabit({ momentos: [{ id: "m1", tipo: "hora", hora: "23:00" }, { id: "m2", tipo: "hora", hora: "23:00" }] });
  const h2 = mkHabit({ id: "h2", nombre: "Otro", momentos: [{ id: "m2b", tipo: "hora", hora: "23:00" }] });
  const st0 = mkState([h, h2], [], sinLogrosNuevos);
  const r1 = s.registrarConJuego(st0, "h1", "m1", hoy); // +15 (10+5)
  const r2 = s.registrarConJuego(r1.state, "h1", "m2", hoy); // +10
  check("dos taps con objetivo 1 dan 25 XP", r2.state.juego.xpTotal === 25);
  const st1 = s.deshacerConJuego(r2.state, `h1|m1|${hoy}`);
  check("si otro evento mantiene el objetivo, solo se devuelve la base", st1.juego.xpTotal === 15);
  const st2 = s.deshacerConJuego(st1, `h1|m2|${hoy}`);
  check("al caer el objetivo se devuelve base+bonus", st2.juego.xpTotal === 0);
}

{
  // xpSemanal solo se toca si el evento es de la semana en curso.
  const fechaVieja = hace(10);
  const ev = mkCompletion("h1", "m1", fechaVieja);
  const st = mkState([mkHabit()], [ev], { xpTotal: 100, xpSemanal: 20, madrugadas: 2 });
  const st2 = s.deshacerConJuego(st, ev.eventId);
  check("evento de otra semana: revierte xpTotal sin tocar xpSemanal",
    st2.juego.xpTotal === 85 && st2.juego.xpSemanal === 20);
}

{
  // Madrugador: espejo del conteo (< 8:00 a. m. hora local).
  const ts = new Date();
  ts.setHours(6, 30, 0, 0);
  const ev = { ...mkCompletion("h1", "m1", hoy), timestamp: ts.toISOString() };
  const st = mkState([mkHabit()], [ev], { xpTotal: 50, madrugadas: 3 });
  const st2 = s.deshacerConJuego(st, ev.eventId);
  check("deshacer de madrugada revierte XP y conteo", st2.juego.madrugadas === 2 && st2.juego.xpTotal === 35);
  const evTarde = { ...mkCompletion("h1", "m1", hoy), timestamp: `${hoy}T18:00:00.000Z` };
  const st3 = mkState([mkHabit()], [evTarde], { xpTotal: 50, madrugadas: 3 });
  const st4 = s.deshacerConJuego(st3, evTarde.eventId);
  check("deshacer de tarde no toca madrugadas", st4.juego.madrugadas === 3 && st4.juego.xpTotal === 35);
}

// ── semana-perfecta con día de descanso ────────────────────────────────────
{
  const h = mkHabit({ dias: [1, 2, 3, 4, 5] }); // Lun–Vie
  const comps = [];
  for (let i = 0; i < 7; i++) {
    const f = hace(i);
    if (!d.esDescanso(h, f)) comps.push(mkCompletion("h1", "m1", f));
  }
  check("la ventana de prueba incluye descanso", comps.length < 7 && comps.length > 0);
  const nuevos = g.logrosNuevos({ juego: j.juegoInicial(), habits: [h], completions: comps, hoy });
  check("semana perfecta con día de descanso total desbloquea", nuevos.includes("semana-perfecta"));
  const vacios = g.logrosNuevos({ juego: j.juegoInicial(), habits: [], completions: [], hoy });
  check("sin hábitos no hay semana perfecta", !vacios.includes("semana-perfecta"));
}

// ── normalizarEstado trae juego ────────────────────────────────────────────
{
  const crudo = { habits: [], completions: [], settings: null };
  const n = s.normalizarEstado(crudo);
  check("normalizarEstado rellena juego por defecto", n.juego && n.juego.xpTotal === 0 && Array.isArray(n.juego.logros));
}

// ── Economía rebalanceada: XP escalado, cofre escalado, niveles fijos ─────
{
  // xpPorRegistro escala con el nivel efectivo: 10 en nivel 1, 18 en nivel 9.
  check("xpPorRegistro(1) = 10", g.xpPorRegistro(1) === 10);
  check("xpPorRegistro(9) = 18", g.xpPorRegistro(9) === 18);
  check("xpPorRegistro satura en [1,9]", g.xpPorRegistro(0) === 10 && g.xpPorRegistro(99) === 18);

  // El registro escala con el nivel efectivo: a 6000 XP la base es 18.
  const stAlta = mkState([mkHabit()], [], { xpTotal: 6000, xpSemanal: 0, ...sinLogrosNuevos });
  const rAlta = s.registrarConJuego(stAlta, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const evCofreAlta = rAlta.eventos.find((e) => e.tipo === "cofre");
  const xpCofreAlta = evCofreAlta && evCofreAlta.dato !== "congelador" ? Number(String(evCofreAlta.dato).split(":")[1] || 0) : 0;
  check("en nivel 9 el registro da 18 base + 5 bonus", rAlta.state.juego.xpTotal - 6000 - xpCofreAlta === 23);

  // tirarCofre escala con el nivel: 15–120 en nivel 1, 55–160 en nivel 9.
  let min1 = 999, max1 = 0, min9 = 999, max9 = 0, huboCongelador = false;
  for (let i = 0; i < 400; i++) {
    const c1 = g.tirarCofre(2, 1); // tope de congeladores → siempre XP
    if (!c1.congelador) { min1 = Math.min(min1, c1.xp); max1 = Math.max(max1, c1.xp); }
    const c9 = g.tirarCofre(2, 9);
    if (!c9.congelador) { min9 = Math.min(min9, c9.xp); max9 = Math.max(max9, c9.xp); }
    if (g.tirarCofre(0, 1).congelador) huboCongelador = true;
  }
  check("cofre nivel 1 en [15,120]", min1 >= 15 && max1 <= 120);
  check("cofre nivel 9 en [55,160]", min9 >= 55 && max9 <= 160);
  check("el cofre puede dar congelador con cupo", huboCongelador);

  // Niveles fijos: el XP bajo el umbral no degrada el nivel efectivo.
  const stFija = mkState([mkHabit()], [], { xpTotal: 100, xpSemanal: 0, nivelMaximo: 2, ...sinLogrosNuevos });
  const ef = g.nivelEfectivo(stFija.juego.xpTotal, stFija.juego.nivelMaximo);
  check("el nivel efectivo no baja del máximo alcanzado", ef.nivel === 2 && ef.progreso === 0);
  check("nivelParaXp puro sigue calculando por XP", g.nivelParaXp(100).nivel === 1);

  // Migración: sin nivelMaximo previo se toma el nivel por XP actual.
  const migrada = j.normalizarJuego({ xpTotal: 500 });
  check("normalizarJuego migra nivelMaximo desde el XP", migrada.nivelMaximo === 3);

  // fusionarJuego converge nivelMaximo por máximo.
  const fa = { ...j.juegoInicial(), nivelMaximo: 2 };
  const fb = { ...j.juegoInicial(), nivelMaximo: 5 };
  check("fusionarJuego toma el mayor nivelMaximo", j.fusionarJuego(fa, fb).nivelMaximo === 5);

  // El pool de logros ya no domina la curva (< 40% de la meta de Leyenda).
  const pool = g.LOGROS.reduce((a, l) => a + l.xp, 0);
  check("pool de logros < 40% de 6000 XP", pool < 2400);

  // Deshacer revierte el XP escalado: marcar→desmarcar no farmea en nivel 9.
  const stDes = mkState([mkHabit({ objetivo: 2 })], [], { xpTotal: 6000, xpSemanal: 100, ...sinLogrosNuevos });
  const rDes = s.registrarConJuego(stDes, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check("en nivel 9 el registro suma 18", rDes.state.juego.xpTotal === 6018);
  const uDes = s.deshacerConJuego(rDes.state, `h1|m1|${hoy}`);
  check("deshacer en nivel 9 revierte 18 (no farmea)", uDes.juego.xpTotal === 6000 && uDes.juego.xpSemanal === 100);
}

// ── Auditoría 2026-09-27: el sueño participa del día completo ──────────────
{
  const mkSueno = (over = {}) =>
    mkHabit({
      id: "sueno-1",
      nombre: "Sueño",
      tipo: "sueno",
      objetivo: 2,
      momentos: [],
      horaLevantar: "06:00",
      horaAcostar: "22:00",
      ...over,
    });
  const mkSuenoEv = (momentId, fecha, hhmm) => ({
    id: `sueno-1|${momentId}|${fecha}`,
    eventId: `sueno-1|${momentId}|${fecha}`,
    habitId: "sueno-1",
    momentId,
    fecha,
    timestamp: `${fecha}T${hhmm}:00.000Z`,
  });
  const sueno = mkSueno();
  const ayer = hace(1);
  const nocheOk = [mkSuenoEv("acostar", ayer, "22:00"), mkSuenoEv("levantar", hoy, "06:00")];
  check("sueño: noche completa atribuye el día al despertar", g.diaCumplidoHabit(sueno, hoy, nocheOk) === true);
  check(
    "sueño: sin levantar no hay día cumplido",
    g.diaCumplidoHabit(sueno, hoy, [mkSuenoEv("acostar", ayer, "22:00")]) === false,
  );
  const comps3 = [];
  for (let i = 0; i < 3; i++) {
    comps3.push(mkSuenoEv("acostar", hace(i + 1), "22:00"), mkSuenoEv("levantar", hace(i), "06:00"));
  }
  check("sueño: racha de 3 noches = 3", g.rachaActual(sueno, hoy, comps3) === 3);
  check("sueño: consistencia 100% en 3 noches", g.consistenciaEnRango(sueno, hace(2), hoy, comps3) === 100);
  const h1 = mkHabit();
  check("día completo incluye al sueño", g.diaCompleto([sueno, h1], hoy, [...nocheOk, mkCompletion("h1", "m1", hoy)]) === true);
  check("sueño: día incompleto si falta el hábito diurno", g.diaCompleto([sueno, h1], hoy, nocheOk) === false);

  // Puntos mostrados escalan con el nivel (14 por registro en nivel 5 + 5 bonus).
  check("puntos nivel 5 = 14 + 5", g.puntosParaFecha(h1, hoy, [mkCompletion("h1", "m1", hoy)], 5) === 19);
  check("puntos nivel 1 = 10 + 5", g.puntosParaFecha(h1, hoy, [mkCompletion("h1", "m1", hoy)], 1) === 15);

  // Desafío: la recompensa escala con la meta (25–65).
  check("desafío meta 1 → 25 XP", g.xpPorDesafio(1) === 25);
  check("desafío meta 5 → 65 XP", g.xpPorDesafio(5) === 65);

  // Deshacer revierte diasCompletos cuando el día deja de estar completo.
  const stD = mkState([mkHabit()], [], sinLogrosNuevos);
  const rD = s.registrarConJuego(stD, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check("registrar el único hábito suma un día completo", rD.state.juego.diasCompletos === 1);
  const uD = s.deshacerConJuego(rD.state, `h1|m1|${hoy}`);
  check("deshacer revierte diasCompletos", uD.juego.diasCompletos === 0);

  // Cantidad: reintento con el mismo eventId no duplica el registro.
  const hCant = mkHabit({ id: "hc", tipo: "cantidad", momentos: [] });
  const eid = `hc|cantidad|${hoy}|abc123`;
  const stC = mkState([hCant], [], sinLogrosNuevos);
  const rC1 = s.registrarConJuego(stC, "hc", undefined, hoy, `${hoy}T18:00:00.000Z`, undefined, eid);
  const rC2 = s.registrarConJuego(rC1.state, "hc", undefined, hoy, `${hoy}T18:00:00.000Z`, undefined, eid);
  check("cantidad idempotente por eventId", rC2.state.completions.length === 1);

  // logrosNuevos mira el nivel efectivo (irreversible), no el XP actual.
  const stN = mkState([mkHabit()], [], { xpTotal: 50, nivelMaximo: 5 });
  const nuevosN = g.logrosNuevos({ juego: stN.juego, habits: stN.habits, completions: stN.completions, hoy });
  check("logros de nivel usan el nivel efectivo", nuevosN.includes("nivel-5"));
}

// ── Historial de XP ──────────────────────────────────────────────────────
{
  const habit = mkHabit({ objetivo: 1 });
  const st = mkState([habit], [], sinLogrosNuevos);
  const r1 = s.registrarConJuego(st, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  const hist1 = r1.state.juego.historialXp;
  check(
    "registrar deja movimientos de registro + objetivo + cofre",
    hist1.some((m) => m.motivo === "registro" && m.delta === 10 && m.detalle === "Leer") &&
      hist1.some((m) => m.motivo === "objetivo" && m.delta === 5) &&
      hist1.some((m) => m.motivo === "cofre" && m.delta > 0),
  );
  const suma = hist1.reduce((a, m) => a + m.delta, 0);
  check("la suma del historial cuadra con el XP ganado", suma === r1.state.juego.xpTotal);
  // Tap duplicado: sin movimientos nuevos.
  const r2 = s.registrarConJuego(r1.state, "h1", "m1", hoy, `${hoy}T18:00:00.000Z`);
  check("tap duplicado no agrega movimientos", r2.state.juego.historialXp.length === hist1.length);
  // Deshacer: movimiento de revertido con el XP devuelto.
  const u = s.deshacerConJuego(r1.state, `h1|m1|${hoy}`);
  const rev = u.juego.historialXp.find((m) => m.motivo === "revertido");
  check("deshacer deja movimiento revertido", !!rev && rev.delta === -15 && rev.detalle === "Leer");
  // Reclamar logro: movimiento de logro.
  const c = j.reclamarLogro(r1.state, "primer-habito");
  check(
    "reclamar logro deja movimiento",
    c.state.juego.historialXp.some((m) => m.motivo === "logro" && m.delta === 10),
  );
  // Totales: ganado vs perdido.
  const t = j.totalesHistorialXp(u.juego);
  check("totales separan ganado y perdido", t.ganado > 0 && t.perdido === 15);
  // Fusión: unión por id sin duplicados.
  const f = j.fusionarJuego(r1.state.juego, u.juego);
  const ids = f.historialXp.map((m) => m.id);
  check("fusión une historiales sin duplicar ids", ids.length === new Set(ids).size);
  check("fusión conserva el revertido del otro dispositivo", f.historialXp.some((m) => m.motivo === "revertido"));
  // Backfill: el pasado queda como entrada "historial" (estimado).
  const comps = [hace(2), hace(1)].map((f2) => mkCompletion("h1", "m1", f2));
  const rb = j.reconciliarJuego(mkState([mkHabit()], comps, { xpTotal: 0, ...sinLogrosNuevos }));
  const back = rb.juego.historialXp.find((m) => m.motivo === "historial");
  check("backfill deja entrada de saldo anterior", !!back && back.delta === rb.juego.xpTotal);
  const rb2 = j.reconciliarJuego(rb);
  check("reconciliar dos veces no duplica el backfill", rb2 === rb);
  // Sueño: marca puntual deja movimiento; olvido deja −10 con motivo.
  const hSueno = mkHabit({ id: "hs", nombre: "Sueño", tipo: "sueno", momentos: [], horaLevantar: "06:00", horaAcostar: "22:00", objetivo: 2 });
  const stS = mkState([hSueno], [], sinLogrosNuevos);
  const rs = s.registrarSuenoConJuego(stS, "hs", "levantar", hoy, `${hoy}T06:05:00.000Z`);
  check(
    "sueño puntual deja movimiento de sueño",
    rs.state.juego.historialXp.some((m) => m.motivo === "sueno" && m.detalle.includes("Me levanté")),
  );
  // Siembra de fallos antiguos: suenoFallos previos aparecen como movimientos.
  const stF = mkState([hSueno], [], { ...sinLogrosNuevos, suenoFallos: [`levantar|${hace(1)}`], xpTotal: 0 });
  const rf = j.reconciliarJuego(stF);
  check(
    "fallo de sueño antiguo se siembra en el historial",
    rf.juego.historialXp.some((m) => m.motivo === "sueno-olvido" && m.delta === -10),
  );
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
