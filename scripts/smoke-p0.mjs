#!/usr/bin/env node
// Smoke tests de la lógica crítica de Fase P0 — sin dependencias externas.
//
// Compila lib/event-id.ts, lib/store.ts, lib/dates.ts (+ lib/types.ts) con el
// tsc del repo a un directorio temporal y aserta:
//   (a) 5 taps de cantidad generan 5 eventIds únicos con formato h|cantidad|fecha|...
//   (b) el id de momento es determinista (h|momento|fecha)
//   (c) registrarCumplimiento usa el eventId que recibe por parámetro
//       (el mismo que el contexto sube a Supabase — guardarraíl #1)
//   (d) el toggle de un hábito por momento no duplica (idempotencia)
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
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-"));
try {
  const tscBin = join(root, "node_modules", ".bin", "tsc");
  execFileSync(
    tscBin,
    [
      join(root, "lib", "core", "event-id.ts"),
      join(root, "lib", "habitos", "store.ts"),
      join(root, "lib", "habitos", "dates.ts"),
      join(root, "lib", "habitos", "types.ts"),
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
const { construirEventId } = req(join(outDir, "core", "event-id.js"));
const { registrarCumplimiento, crearEstadoInicial } = req(join(outDir, "habitos", "store.js"));

// (a) 5 taps de cantidad → 5 eventIds únicos con formato h|cantidad|fecha|...
const idsCantidad = Array.from({ length: 5 }, () => construirEventId("h1", undefined, "2026-09-26"));
check("5 taps de cantidad generan 5 eventIds únicos", new Set(idsCantidad).size === 5);
check(
  "formato cantidad: h|cantidad|fecha|...",
  idsCantidad.every((id) => /^h1\|cantidad\|2026-09-26\|.+/.test(id)),
);

// (b) id de momento determinista
const m1 = construirEventId("h1", "m1", "2026-09-26");
const m2 = construirEventId("h1", "m1", "2026-09-26");
check("id de momento determinista (h|momento|fecha)", m1 === "h1|m1|2026-09-26" && m1 === m2);

// (c) registrarCumplimiento usa el eventId recibido por parámetro
const base = crearEstadoInicial();
const habCantidad = {
  id: "hc",
  nombre: "Agua",
  tipo: "cantidad",
  objetivo: 8,
  unidad: "vasos",
  estado: "activo",
  momentos: [],
  dias: [0, 1, 2, 3, 4, 5, 6],
  creadoEn: "2026-09-26T00:00:00.000Z",
  historialObjetivos: [{ desde: "2026-09-26", objetivo: 8 }],
};
let s = { ...base, habits: [habCantidad], completions: [] };
const eid = construirEventId("hc", undefined, "2026-09-26");
s = registrarCumplimiento(s, "hc", undefined, "2026-09-26", "2026-09-26T12:00:00.000Z", undefined, eid);
const ev = s.completions[s.completions.length - 1];
check(
  "registrarCumplimiento usa el eventId recibido (local == remoto)",
  Boolean(ev) && ev.eventId === eid && ev.id === eid,
);

// (d) el toggle de momento no duplica
const habMomento = {
  id: "hm",
  nombre: "Leer",
  tipo: "momento",
  objetivo: 1,
  estado: "activo",
  momentos: [{ id: "m1", tipo: "hora", hora: "08:00" }],
  dias: [0, 1, 2, 3, 4, 5, 6],
  creadoEn: "2026-09-26T00:00:00.000Z",
  historialObjetivos: [{ desde: "2026-09-26", objetivo: 1 }],
};
let s2 = { ...base, habits: [habMomento], completions: [] };
const e2 = construirEventId("hm", "m1", "2026-09-26");
s2 = registrarCumplimiento(s2, "hm", "m1", "2026-09-26", "2026-09-26T12:00:00.000Z", undefined, e2);
const n1 = s2.completions.length;
s2 = registrarCumplimiento(s2, "hm", "m1", "2026-09-26", "2026-09-26T12:00:00.000Z", undefined, e2);
check("toggle de momento no duplica (idempotente)", n1 === 1 && s2.completions.length === 1);

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${ok} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
