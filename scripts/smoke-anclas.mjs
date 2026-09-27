#!/usr/bin/env node
// Smoke tests de momentos anclados al sueño — sin dependencias externas.
//
// Compila lib/types.ts, lib/dates.ts, lib/anclas.ts y lib/gamificacion.ts
// con el tsc del repo a un directorio temporal y aserta:
//   - horaAncla: hora real marcada > hora objetivo > null sin sueño.
//   - etiquetaAncla: "Al levantarte · 6:40".
//   - habitosAnclaPendientes: solo activos de tipo momento, con el ancla
//     sin marcar en la fecha.
//   - rachaActual: un momento anclado no marcado y vencido (según la hora
//     efectiva del sueño) cuenta como vencido; marcado, no vence.
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
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-anclas-"));
try {
  const tscBin = join(root, "node_modules", ".bin", "tsc");
  execFileSync(
    tscBin,
    [
      join(root, "lib", "types.ts"),
      join(root, "lib", "dates.ts"),
      join(root, "lib", "anclas.ts"),
      join(root, "lib", "gamificacion.ts"),
      "--outDir", outDir,
      "--module", "commonjs",
      "--target", "es2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  console.error("FALLA: no se pudo compilar lib/*.ts");
  console.error(String(e.stdout ?? e.message).slice(0, 2000));
  process.exit(1);
}
const require = createRequire(join(outDir, "x.js"));
const anclas = require(join(outDir, "anclas.js"));
const g = require(join(outDir, "gamificacion.js"));

// 2. Fixtures.
const sueno = {
  id: "h-sueno", nombre: "Sueño", tipo: "sueno", estado: "activo",
  dias: [0, 1, 2, 3, 4, 5, 6], objetivo: 2, momentos: [],
  horaLevantar: "06:00", horaAcostar: "22:00",
};
const dientes = {
  id: "h-dientes", nombre: "Cepillarme los dientes", tipo: "momento",
  estado: "activo", dias: [0, 1, 2, 3, 4, 5, 6], objetivo: 2,
  momentos: [
    { id: "m-manana", tipo: "ancla", ancla: "levantar" },
    { id: "m-noche", tipo: "ancla", ancla: "acostar" },
  ],
};
const habits = [sueno, dientes];
const ev = (habitId, momentId, fecha, timestamp) => ({
  id: `${habitId}|${momentId}|${fecha}`, eventId: `${habitId}|${momentId}|${fecha}`,
  habitId, momentId, fecha, timestamp,
});

// 3. horaAncla.
check(
  "horaAncla sin marca usa la hora objetivo",
  anclas.horaAncla(habits, [], "levantar", "2026-09-27") === "06:00" &&
    anclas.horaAncla(habits, [], "acostar", "2026-09-27") === "22:00",
);
check(
  "horaAncla prefiere la hora real marcada",
  anclas.horaAncla(habits, [ev("h-sueno", "levantar", "2026-09-27", "2026-09-27T06:40:00")], "levantar", "2026-09-27") === "06:40",
);
check(
  "horaAncla es null sin hábito sueño",
  anclas.horaAncla([dientes], [], "levantar", "2026-09-27") === null,
);

// 4. etiquetaAncla.
check(
  "etiquetaAncla con hora",
  anclas.etiquetaAncla("levantar", "06:40") === "Al levantarte · 6:40 a. m." ||
    anclas.etiquetaAncla("levantar", "06:40").startsWith("Al levantarte · 6:40"),
);
check(
  "etiquetaAncla sin hora",
  anclas.etiquetaAncla("acostar", null) === "Al acostarte",
);

// 5. habitosAnclaPendientes.
check(
  "pendientes: los dos momentos sin marcar",
  anclas.habitosAnclaPendientes(habits, [], "levantar", "2026-09-27").length === 1 &&
    anclas.habitosAnclaPendientes(habits, [], "acostar", "2026-09-27").length === 1,
);
check(
  "pendientes: marcado ya no sale",
  anclas.habitosAnclaPendientes(
    habits,
    [ev("h-dientes", "m-manana", "2026-09-27", "2026-09-27T07:00:00")],
    "levantar",
    "2026-09-27",
  ).length === 0,
);
check(
  "pendientes: ignora hábitos pausados o de otro tipo",
  anclas.habitosAnclaPendientes(
    [{ ...dientes, estado: "pausado" }, { ...dientes, id: "h2", tipo: "cantidad", momentos: [] }],
    [],
    "levantar",
    "2026-09-27",
  ).length === 0,
);

// 6. rachaActual con anclas (vencido por hora efectiva del sueño).
// Hábito de un solo momento anclado, objetivo 1.
const unAncla = {
  ...dientes,
  id: "h-dientes1",
  objetivo: 1,
  momentos: [{ id: "m-manana", tipo: "ancla", ancla: "levantar" }],
};
const habits1 = [sueno, unAncla];
// Hoy 2026-09-27, ahora 10:00, ancla levantar resuelve a 06:00 (objetivo):
// sin marcar → vencido → la racha empieza ayer (ayer sí se marcó).
const rVencido = g.rachaActual(
  unAncla,
  "2026-09-27",
  [ev("h-dientes1", "m-manana", "2026-09-26", "2026-09-26T07:00:00")],
  [],
  "10:00",
  habits1,
);
check("ancla vencida no marcada: hoy rompe la racha", rVencido === 0);

// Marcado hoy a las 7 → no vencido; hoy completo (objetivo 1): racha 2.
const rOk = g.rachaActual(
  unAncla,
  "2026-09-27",
  [
    ev("h-dientes1", "m-manana", "2026-09-26", "2026-09-26T07:00:00"),
    ev("h-dientes1", "m-manana", "2026-09-27", "2026-09-27T07:00:00"),
  ],
  [],
  "10:00",
  habits1,
);
check("ancla marcada hoy no vence", rOk === 2);

// 7. Limpieza.
rmSync(outDir, { recursive: true, force: true });

console.log(`\n${ok} OK, ${fail} FALLAS`);
process.exit(fail === 0 ? 0 : 1);
