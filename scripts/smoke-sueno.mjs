#!/usr/bin/env node
// Smoke tests del hábito especial Sueño — sin dependencias externas.
//
// Compila lib/types.ts, lib/dates.ts, lib/event-id.ts, lib/gamificacion.ts,
// lib/juego.ts y lib/store.ts con el tsc del repo a un directorio temporal
// y aserta:
//   - Matemática de puntualidad: +10 a tiempo, −1 XP por cada 5 min tarde,
//     −10 si > 50 min tarde (corte exacto en 50/51).
//   - minutosDeRetraso con cruce de medianoche (22:00 → 00:30 = 150 min).
//   - fechaParaMarcaSueno: levantar siempre hoy; acostar de madrugada va a
//     la noche anterior. horaSugeridaSueno propone el objetivo si se olvidó.
//   - Seed: crearHabitoSueno (06:00/22:00, objetivo 8 h), nace en
//     crearEstadoInicial, normalizarEstado lo siembra y deduplica.
//   - eliminarHabit rechaza borrar Sueño.
//   - registrarSuenoConJuego: XP por puntualidad, idempotencia por marca+fecha,
//     sin bonus de objetivo diario (+5) ni en el registro ni en puntosParaFecha.
//   - deshacerConJuego revierte exactamente (también penalizaciones).
//   - corregirSuenoConJuego revierte el XP anterior y aplica el nuevo.
//   - registrarCumplimiento rechaza momentId ajenos a Sueño.
//   - nocheEstaCompleta / nochesSueno: log invisible con duración dormida.
//   - reconciliarJuego: −10 por marca olvidada reciente, idempotente,
//     sin castigo antes de creadoEn ni con el hábito pausado (vacaciones).
//
// Salida: código 0 si todo pasa, 1 si algo falla.

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-sueno-"));
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
const hace = (n) => d.moverFecha(hoy, -n);
const ayer = hace(1);
const anteayer = hace(2);

/** Estado mínimo con el hábito Sueño dado y juego limpio. */
const estadoConSueno = (habitOver = {}) => {
  const base = s.crearEstadoInicial();
  const sueno = { ...s.crearHabitoSueno("t"), ...habitOver };
  return { ...base, habits: [sueno], completions: [] };
};
const suenoDe = (state) => state.habits.find((h) => h.tipo === "sueno");
const ts = (fecha, hora) => d.timestampLocal(fecha, hora);

// ── Matemática de puntualidad ───────────────────────────────────────────────
check("xpPorPuntualidad(0) = 10", g.xpPorPuntualidad(0) === 10);
check("xpPorPuntualidad(5) = 9", g.xpPorPuntualidad(5) === 9);
check("xpPorPuntualidad(25) = 5", g.xpPorPuntualidad(25) === 5);
check("xpPorPuntualidad(50) = 0 (corte)", g.xpPorPuntualidad(50) === 0);
check("xpPorPuntualidad(51) = -10 (corte)", g.xpPorPuntualidad(51) === -10);
check("xpPorPuntualidad(120) = -10 (tope)", g.xpPorPuntualidad(120) === -10);
check("retraso puntual = 0", g.minutosDeRetraso("22:00", "22:00") === 0);
check("temprano no penaliza", g.minutosDeRetraso("22:00", "21:30") === 0);
check("retraso simple = 30", g.minutosDeRetraso("22:00", "22:30") === 30);
check(
  "cruce de medianoche: 22:00 → 00:30 = 150 min",
  g.minutosDeRetraso("22:00", "00:30") === 150,
);

// ── Atribución de fecha y hora sugerida ─────────────────────────────────────
const ahora = new Date();
check(
  "levantar siempre es hoy",
  g.fechaParaMarcaSueno("levantar", "06:30", ahora) === hoy,
);
check(
  "acostar de noche es hoy",
  g.fechaParaMarcaSueno("acostar", "23:00", ahora) === hoy,
);
check(
  "acostar de madrugada pertenece a anoche",
  g.fechaParaMarcaSueno("acostar", "01:00", ahora) === ayer,
);
check(
  "olvido en la mañana: se sugiere la hora objetivo",
  g.horaSugeridaSueno("acostar", "22:00", new Date(2026, 8, 27, 7, 30)) === "22:00",
);
check(
  "levantar en la mañana: se sugiere la hora actual",
  g.horaSugeridaSueno("levantar", "22:00", new Date(2026, 8, 27, 7, 30)) === "07:30",
);

// ── Seed y protecciones ─────────────────────────────────────────────────────
const semilla = s.crearHabitoSueno("x");
check("seed: tipo sueno", semilla.tipo === "sueno");
check("seed: objetivo 2 marcas", semilla.objetivo === 2);
check("seed: 06:00 / 22:00", semilla.horaLevantar === "06:00" && semilla.horaAcostar === "22:00");
check("seed: objetivo 8 h", semilla.objetivoHoras === 8);
check("seed: 7 días", semilla.dias.length === 7);
check("seed: sin momentos", semilla.momentos.length === 0);

const inicial = s.crearEstadoInicial();
check("crearEstadoInicial incluye Sueño", inicial.habits.some((h) => h.tipo === "sueno"));

const sinSueno = { ...s.crearEstadoInicial(), habits: [] };
const normalizado = s.normalizarEstado(JSON.parse(JSON.stringify(sinSueno)));
check("normalizarEstado siembra Sueño", normalizado.habits.some((h) => h.tipo === "sueno"));

const conSueno = estadoConSueno();
check(
  "eliminarHabit rechaza borrar Sueño",
  s.eliminarHabit(conSueno, suenoDe(conSueno).id).habits.length === 1,
);

const dosSuenos = (() => {
  const base = estadoConSueno();
  const viejo = { ...suenoDe(base), id: "sueno-viejo" };
  const conHist = {
    ...suenoDe(base),
    id: "sueno-nuevo",
    creadoEn: d.timestampLocal(hace(30), "00:00"),
  };
  const comp = {
    id: "x", eventId: "x", habitId: "sueno-nuevo", momentId: "levantar",
    fecha: ayer, timestamp: ts(ayer, "06:00"),
  };
  return s.normalizarEstado({ ...base, habits: [viejo, conHist], completions: [comp] });
})();
check(
  "normalizarEstado deduplica y conserva el de más historial",
  dosSuenos.habits.filter((h) => h.tipo === "sueno").length === 1 &&
    dosSuenos.habits.some((h) => h.id === "sueno-nuevo"),
);

// ── Registro con juego ──────────────────────────────────────────────────────
{
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarSuenoConJuego(st0, sueno.id, "levantar", hoy, ts(hoy, "06:00"));
  check("levantar a tiempo: +10 XP", r.state.juego.xpTotal === 10);
  check("levantar a tiempo: crea el evento", r.state.completions.length === 1);
  check("evento tipo sueno va primero", r.eventos[0]?.tipo === "sueno");
  check(
    "idempotencia por marca+fecha",
    s.registrarSuenoConJuego(r.state, sueno.id, "levantar", hoy, ts(hoy, "06:00")).state.juego.xpTotal === 10 &&
      s.registrarSuenoConJuego(r.state, sueno.id, "levantar", hoy, ts(hoy, "06:00")).state.completions.length === 1,
  );
}
{
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarSuenoConJuego(st0, sueno.id, "levantar", hoy, ts(hoy, "06:35"));
  check("35 min tarde: +3 XP", r.state.juego.xpTotal === 3);
}
{
  // Piso de XP: penalización con xpTotal 0 no baja de 0.
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarSuenoConJuego(st0, sueno.id, "acostar", hoy, ts(hoy, "23:30"));
  check("90 min tarde con XP 0: piso en 0", r.state.juego.xpTotal === 0);
  check("la marca igual queda registrada", r.state.completions.length === 1);
}
{
  // Sin bonus de objetivo diario: las dos marcas a tiempo dan 20, no 25.
  // (Un hábito pendiente evita que abra el cofre del día completo, que da XP
  // aleatorio y haría el test no determinista.)
  const dummy = {
    id: "h-dummy", nombre: "Dummy", icono: "", color: "#000000", categoria: "salud",
    dias: [0, 1, 2, 3, 4, 5, 6], objetivo: 1, momentos: [], estado: "activo",
    creadoEn: "2026-01-01T00:00:00.000Z", actualizadoEn: "2026-01-01T00:00:00.000Z",
    tipo: "momento",
  };
  const st0 = estadoConSueno();
  const st1 = { ...st0, habits: [suenoDe(st0), dummy] };
  const sueno = suenoDe(st1);
  let r = s.registrarSuenoConJuego(st1, sueno.id, "levantar", hoy, ts(hoy, "06:00"));
  r = s.registrarSuenoConJuego(r.state, sueno.id, "acostar", hoy, ts(hoy, "22:00"));
  check("dos marcas a tiempo: 20 XP (sin +5)", r.state.juego.xpTotal === 20);
  check(
    "puntosParaFecha sin bonus: 20",
    g.puntosParaFecha(sueno, hoy, r.state.completions) === 20,
  );
}
{
  // Deshacer revierte exactamente (también penalizaciones).
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const conJuego = { ...st0.juego, xpTotal: 20, xpSemanal: 20 };
  const st1 = { ...st0, juego: conJuego };
  const r = s.registrarSuenoConJuego(st1, sueno.id, "acostar", hoy, ts(hoy, "23:30"));
  check("penalización −10 aplicada", r.state.juego.xpTotal === 10);
  const eid = r.state.completions[0].eventId;
  const rev = s.deshacerConJuego(r.state, eid);
  check("deshacer devuelve el XP quitado", rev.juego.xpTotal === 20);
  check("deshacer quita el evento", rev.completions.length === 0);
}
{
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarSuenoConJuego(st0, sueno.id, "levantar", hoy, ts(hoy, "06:00"));
  const eid = r.state.completions[0].eventId;
  const rev = s.deshacerConJuego(r.state, eid);
  check("deshacer de +10 vuelve a 0", rev.juego.xpTotal === 0);
}
{
  // Corregir la hora: revierte el efecto anterior y aplica el nuevo.
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarSuenoConJuego(st0, sueno.id, "levantar", hoy, ts(hoy, "06:00"));
  check("antes de corregir: 10 XP", r.state.juego.xpTotal === 10);
  const c = s.corregirSuenoConJuego(r.state, sueno.id, "levantar", hoy, ts(hoy, "07:00"));
  check("corregir 06:00 → 07:00: queda en 0", c.state.juego.xpTotal === 0);
  check("corregir no duplica el evento", c.state.completions.length === 1);
  check(
    "el timestamp queda con la hora real corregida",
    c.state.completions[0].timestamp === ts(hoy, "07:00"),
  );
}
{
  // registrarCumplimiento rechaza momentId ajenos en Sueño.
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  const r = s.registrarCumplimiento(st0, sueno.id, "m1", hoy);
  check("momentId inválido no registra", r.completions.length === 0);
}

// ── Log invisible de noches ─────────────────────────────────────────────────
{
  const st0 = estadoConSueno();
  const sueno = suenoDe(st0);
  let r = s.registrarSuenoConJuego(st0, sueno.id, "acostar", ayer, ts(ayer, "22:00"));
  r = s.registrarSuenoConJuego(r.state, sueno.id, "levantar", hoy, ts(hoy, "06:30"));
  check("noche completa detectada", g.nocheEstaCompleta(sueno, r.state.completions, ayer));
  const noches = g.nochesSueno(sueno, r.state.completions);
  check("una noche en el log", noches.length === 1);
  check("duración dormida 8.5 h", noches[0]?.horas === 8.5);
  check(
    "noche incompleta no entra al log",
    g.nochesSueno(sueno, [r.state.completions[0]]).length === 0,
  );
}

// ── Omisiones (reconciliarJuego) ─────────────────────────────────────────────
{
  const st0 = estadoConSueno({ creadoEn: d.timestampLocal(hace(10), "00:00") });
  const conXp = { ...st0, juego: { ...st0.juego, xpTotal: 50, xpSemanal: 50 } };
  const r1 = j.reconciliarJuego(conXp);
  const fallos = r1.juego.suenoFallos;
  check("fallo levantar de ayer registrado", fallos.includes(`levantar|${ayer}`));
  check("fallo acostar de anteayer registrado", fallos.includes(`acostar|${anteayer}`));
  check("−20 XP por las dos omisiones", r1.juego.xpTotal === 30);
  const r2 = j.reconciliarJuego(r1);
  check("omisiones idempotentes (sin doble castigo)", r2.juego.xpTotal === 30);
}
{
  // Sin castigo antes de que existiera el hábito.
  const st0 = estadoConSueno({ creadoEn: d.timestampLocal(ayer, "00:00") });
  const r = j.reconciliarJuego({ ...st0, juego: { ...st0.juego, xpTotal: 50 } });
  check(
    "anteayer no se castiga (no existía)",
    !r.juego.suenoFallos.includes(`acostar|${anteayer}`),
  );
  check("ayer sí se castiga", r.juego.suenoFallos.includes(`levantar|${ayer}`));
}
{
  // Vacaciones: pausado no penaliza.
  const st0 = estadoConSueno({ creadoEn: d.timestampLocal(hace(10), "00:00"), estado: "pausado" });
  const r = j.reconciliarJuego({ ...st0, juego: { ...st0.juego, xpTotal: 50 } });
  check("pausado: sin fallos de sueño", r.juego.suenoFallos.length === 0);
  check("pausado: sin castigo de XP", r.juego.xpTotal === 50);
}
{
  // Marca tardía después de la penalización no duplica el castigo.
  const st0 = estadoConSueno({ creadoEn: d.timestampLocal(hace(10), "00:00") });
  const r1 = j.reconciliarJuego({ ...st0, juego: { ...st0.juego, xpTotal: 50 } });
  const sueno = suenoDe(r1);
  const r2 = s.registrarSuenoConJuego(r1, sueno.id, "levantar", ayer, ts(ayer, "06:00"));
  const r3 = j.reconciliarJuego(r2.state);
  check(
    "marca tardía no suma castigo nuevo",
    r3.juego.suenoFallos.filter((f) => f === `levantar|${ayer}`).length === 1,
  );
}

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${ok} OK, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
