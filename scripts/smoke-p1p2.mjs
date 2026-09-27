#!/usr/bin/env node
// Smoke tests de la lógica crítica de Fases P1/P2 — sin dependencias externas.
//
// Compila lib/sync-merge.ts, lib/store.ts, lib/gamificacion.ts, lib/dates.ts,
// lib/event-id.ts (+ lib/types.ts) con el tsc del repo a un directorio temporal
// y aserta:
//   P1.3 last-write-wins: gana updated_at/actualizadoEn mayor; empate → local.
//   P2.6 tombstones: el borrado remoto excluye del merge y purga el local.
//   P2.3 racha unificada: usa objetivoEnFecha; hoy incompleto sin vencidos no rompe.
//   P2.1 guardarHabit no muta los objetos del historial del estado previo.
//   P2.2 registrarCumplimiento persiste subtareasCompletadas en el evento local.
//   P1.3 guardarHabit mueve actualizadoEn; normalizarEstado hace backfill.
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
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-p1p2-"));
try {
  const tscBin = join(root, "node_modules", ".bin", "tsc");
  execFileSync(
    tscBin,
    [
      join(root, "lib", "sync-merge.ts"),
      join(root, "lib", "store.ts"),
      join(root, "lib", "gamificacion.ts"),
      join(root, "lib", "dates.ts"),
      join(root, "lib", "event-id.ts"),
      join(root, "lib", "types.ts"),
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
const { fusionarHidratacion } = req(join(outDir, "sync-merge.js"));
const { guardarHabit, registrarCumplimiento, normalizarEstado } = req(join(outDir, "store.js"));
const { rachaActual, objetivoEnFecha } = req(join(outDir, "gamificacion.js"));

const mkHabit = (over = {}) => ({
  id: "h1",
  nombre: "Test",
  icono: "✅",
  color: "#328b78",
  categoria: "salud",
  dias: [0, 1, 2, 3, 4, 5, 6],
  objetivo: 1,
  momentos: [{ id: "m1", tipo: "hora", hora: "09:00" }],
  estado: "activo",
  creadoEn: "2026-01-01T00:00:00.000Z",
  actualizadoEn: "2026-01-01T00:00:00.000Z",
  tipo: "momento",
  ...over,
});
const mkState = (habits = [], completions = []) => ({
  habits,
  completions,
  settings: { notificaciones: false, horasDescanso: { inicio: "22:00", fin: "07:00" }, tema: "sistema" },
});

// ── P1.3: last-write-wins ────────────────────────────────────────────────
{
  const local = mkHabit({ nombre: "Local", actualizadoEn: "2026-09-20T10:00:00.000Z" });
  const remoto = { ...mkHabit({ nombre: "Remoto" }) };
  const rows = [{ id: "h1", data: remoto, updated_at: "2026-09-25T10:00:00.000Z" }];
  const merged = fusionarHidratacion(mkState([local]), rows, []);
  check("LWW: gana el remoto cuando updated_at > actualizadoEn local", merged && merged.habits[0].nombre === "Remoto");
}
{
  const local = mkHabit({ nombre: "Local", actualizadoEn: "2026-09-26T10:00:00.000Z" });
  const remoto = { ...mkHabit({ nombre: "Remoto" }) };
  const rows = [{ id: "h1", data: remoto, updated_at: "2026-09-20T10:00:00.000Z" }];
  const merged = fusionarHidratacion(mkState([local]), rows, []);
  // Si gana el local y nada cambió, el merge retorna null (conserva referencia).
  check("LWW: gana el local cuando actualizadoEn > updated_at remoto", merged === null || merged.habits[0].nombre === "Local");
}
{
  // Empate exacto → gana local (determinista).
  const local = mkHabit({ nombre: "Local", actualizadoEn: "2026-09-25T10:00:00.000Z" });
  const remoto = { ...mkHabit({ nombre: "Remoto" }) };
  const rows = [{ id: "h1", data: remoto, updated_at: "2026-09-25T10:00:00.000Z" }];
  const merged = fusionarHidratacion(mkState([local]), rows, []);
  check("LWW: en empate gana el local", merged === null || merged.habits[0].nombre === "Local");
}
{
  // actualizadoEn se mueve al guardar; backfill para datos viejos.
  const s0 = mkState([mkHabit()]);
  const s1 = guardarHabit(s0, { ...mkHabit(), nombre: "Editado" });
  check("guardarHabit actualiza actualizadoEn", s1.habits[0].actualizadoEn > "2026-01-01T00:00:00.000Z");
  const viejo = mkState([{ ...mkHabit(), actualizadoEn: undefined }]);
  const norm = normalizarEstado(viejo);
  check("normalizarEstado hace backfill de actualizadoEn", norm.habits[0].actualizadoEn === norm.habits[0].creadoEn);
}

// ── P2.6: tombstones ─────────────────────────────────────────────────────
{
  const local = mkHabit({ id: "borrado" });
  const otro = mkHabit({ id: "vive", nombre: "Vive" });
  const rows = [
    { id: "borrado", data: { ...mkHabit({ id: "borrado", nombre: "Zombie" }) }, updated_at: "2026-09-26T10:00:00.000Z" },
    { id: "vive", data: { ...mkHabit({ id: "vive", nombre: "Vive" }) }, updated_at: "2026-09-26T10:00:00.000Z" },
  ];
  const merged = fusionarHidratacion(mkState([local, otro]), rows, [], new Set(["borrado"]));
  const ids = merged ? merged.habits.map((h) => h.id) : [];
  check("tombstone: excluye el remoto borrado y purga el local", !ids.includes("borrado") && ids.includes("vive"));
}

// ── P2.3: racha unificada ─────────────────────────────────────────────────
{
  const habit = mkHabit({ objetivo: 1 });
  const ev = (fecha, momentId = "m1") => ({
    id: `h1|${momentId}|${fecha}`, eventId: `h1|${momentId}|${fecha}`,
    habitId: "h1", momentId, fecha, timestamp: `${fecha}T09:00:00.000Z`,
  });
  // 3 días seguidos cumpliendo → racha 3 (hoy 2026-09-26 incompleto, sin vencidos a las 08:00).
  const completions = [ev("2026-09-25"), ev("2026-09-24"), ev("2026-09-23")];
  const r = rachaActual(habit, "2026-09-26", completions, [], "08:00");
  check("racha: 3 días seguidos + hoy incompleto sin vencidos = 3", r === 3);
  // Hoy incompleto CON momento vencido (09:00 <= 10:00) → racha 0.
  const r2 = rachaActual(habit, "2026-09-26", completions, [], "10:00");
  check("racha: hoy incompleto con momento vencido = 0", r2 === 0);
  // Objetivo histórico: ayer el objetivo era 2 y solo se hizo 1 → racha 1.
  const habitHist = mkHabit({
    objetivo: 1,
    historialObjetivos: [
      { desde: "2026-01-01", objetivo: 2, hasta: "2026-09-26" },
      { desde: "2026-09-26", objetivo: 1 },
    ],
  });
  check("objetivoEnFecha respeta el historial", objetivoEnFecha(habitHist, "2026-09-25") === 2 && objetivoEnFecha(habitHist, "2026-09-26") === 1);
  const r3 = rachaActual(habitHist, "2026-09-26", [ev("2026-09-26"), ev("2026-09-25")], [], "08:00");
  check("racha: usa el objetivo vigente por fecha (ayer pedía 2, se hizo 1)", r3 === 1);
}

// ── P2.1: sin mutación del historial previo ───────────────────────────────
{
  const tramo = { desde: "2026-01-01", objetivo: 2 };
  const s0 = mkState([mkHabit({ objetivo: 2, historialObjetivos: [tramo] })]);
  guardarHabit(s0, { ...mkHabit(), objetivo: 5 });
  check(
    "guardarHabit no muta el tramo del estado previo",
    tramo.hasta === undefined && s0.habits[0].historialObjetivos[0].hasta === undefined,
  );
}

// ── P2.2: subtareas en el evento local ────────────────────────────────────
{
  const s0 = mkState([mkHabit()]);
  const s1 = registrarCumplimiento(s0, "h1", "m1", "2026-09-26", "2026-09-26T09:00:00.000Z", ["s1", "s2"], "h1|m1|2026-09-26");
  const evLocal = s1.completions.find((c) => c.eventId === "h1|m1|2026-09-26");
  check(
    "registrarCumplimiento persiste subtareasCompletadas en local",
    evLocal && Array.isArray(evLocal.subtareasCompletadas) && evLocal.subtareasCompletadas.join(",") === "s1,s2",
  );
}

// ── Endurecimiento de settings: settings incompleto no rompe ──────────────
{
  // settings sin horasDescanso (el caso que rompía /ajustes)
  const n1 = normalizarEstado({
    habits: [],
    completions: [],
    settings: { notificaciones: true, tema: "oscuro" },
  });
  check(
    "settings sin horasDescanso se rellena con defaults",
    n1.settings.horasDescanso.inicio === "22:00" &&
      n1.settings.horasDescanso.fin === "08:00" &&
      n1.settings.notificaciones === true &&
      n1.settings.tema === "oscuro",
  );
  // settings ausente por completo
  const n2 = normalizarEstado({ habits: [], completions: [] });
  check(
    "settings ausente usa defaults completos",
    n2.settings.tema === "sistema" &&
      n2.settings.horasDescanso.inicio === "22:00" &&
      n2.settings.reducirMovimiento === false,
  );
  // tema inválido vuelve al default
  const n3 = normalizarEstado({
    habits: [],
    completions: [],
    settings: { tema: "neon", horasDescanso: { inicio: "23:00", fin: "06:00" } },
  });
  check(
    "tema inválido se reemplaza por el default y respeta horasDescanso válidas",
    n3.settings.tema === "sistema" &&
      n3.settings.horasDescanso.inicio === "23:00" &&
      n3.settings.horasDescanso.fin === "06:00",
  );
  // horasDescanso parcial (solo inicio)
  const n4 = normalizarEstado({
    habits: [],
    completions: [],
    settings: { horasDescanso: { inicio: "21:30" } },
  });
  check(
    "horasDescanso parcial rellena solo lo que falta",
    n4.settings.horasDescanso.inicio === "21:30" && n4.settings.horasDescanso.fin === "08:00",
  );
}

console.log(`\n${ok} OK, ${fail} FALLAS`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
