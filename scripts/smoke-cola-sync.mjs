#!/usr/bin/env node
// Smoke tests de lib/core/sync-queue.ts (cola offline genérica) — sin dependencias externas.
//
// Compila lib/core/sync-queue.ts con el tsc del repo a un directorio temporal
// y aserta la semántica heredada de la cola original de Hábitos:
//   - FIFO: las operaciones se ejecutan en orden.
//   - Tope: en disco se conservan las últimas N; al encolar con la cola llena
//     se avisa por alDesbordar.
//   - La operación que falla (false o excepción) vuelve a la cola y NO aborta
//     el lote: se sigue con la siguiente.
//   - reenviar concurrente no duplica el flush (guardia en curso).
//   - puedeReenviar=false y antesDeReenviar se respetan.
//   - vaciar() limpia memoria y disco.
//   - La cola persiste en localStorage entre instancias (nueva identidad lee
//     la clave activa).
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

// localStorage mínimo para Node.
const tienda = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (tienda.has(k) ? tienda.get(k) : null),
    setItem: (k, v) => tienda.set(k, String(v)),
    removeItem: (k) => tienda.delete(k),
  },
};

// 1. Compilar la fuente pura con el tsc del repo.
const outDir = mkdtempSync(join(tmpdir(), "habitos-smoke-cola-"));
try {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      join(root, "lib", "core", "sync-queue.ts"),
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
  console.log(String(e.stderr || e.message).slice(0, 2000));
  process.exit(1);
}

const req = createRequire(join(outDir, "cargador.cjs"));
const { crearColaSync } = req(join(outDir, "sync-queue.js"));

const orden = [];
const cola = crearColaSync({
  clave: "test-cola",
  tope: 3,
  ejecutar: async (op) => {
    orden.push(op.id);
    if (op.id === "falla") return false;
    if (op.id === "explota") throw new Error("boom");
    return true;
  },
});

const t = async () => {
  // FIFO + la que falla no aborta el lote.
  cola.encolar({ id: "a" });
  cola.encolar({ id: "falla" });
  cola.encolar({ id: "explota" });
  cola.encolar({ id: "b" }); // 4ta con tope 3 -> desborda en disco
  // Tope en disco: solo las últimas 3 (antes del flush).
  const enDisco = JSON.parse(tienda.get("test-cola"));
  check("disco recorta al tope", enDisco.length === 3 && enDisco[0].id === "falla" && enDisco[2].id === "b");
  await cola.reenviar();
  check("FIFO en orden", orden.join(",") === "a,falla,explota,b");
  check("las fallidas vuelven a la cola", cola.pendientes().map((o) => o.id).join(",") === "falla,explota");
  // Tras el flush, en disco quedan las restantes.
  const enDiscoTras = JSON.parse(tienda.get("test-cola"));
  check("disco guarda las restantes", enDiscoTras.length === 2 && enDiscoTras[0].id === "falla");

  // alDesbordar se llama al encolar sobre el tope.
  let aviso = 0;
  const c2 = crearColaSync({ clave: "test-desborde", tope: 2, ejecutar: async () => true, alDesbordar: () => aviso++ });
  c2.encolar({ id: 1 });
  c2.encolar({ id: 2 });
  c2.encolar({ id: 3 });
  check("aviso de desborde", aviso === 1);

  // Guardia de flush simultáneo.
  let ejecuciones = 0;
  const c3 = crearColaSync({
    clave: "test-sim",
    ejecutar: async () => { ejecuciones++; await new Promise((r) => setTimeout(r, 20)); return true; },
  });
  c3.encolar({ id: "x" });
  await Promise.all([c3.reenviar(), c3.reenviar()]);
  check("flush simultáneo no duplica", ejecuciones === 1);

  // puedeReenviar / antesDeReenviar.
  let gancho = 0;
  const c4 = crearColaSync({
    clave: "test-ganchos",
    puedeReenviar: () => false,
    antesDeReenviar: async () => { gancho++; },
    ejecutar: async () => true,
  });
  c4.encolar({ id: "y" });
  await c4.reenviar();
  check("puedeReenviar=false no reenvía", c4.pendientes().length === 1 && gancho === 0);

  const c5 = crearColaSync({
    clave: "test-gancho2",
    antesDeReenviar: async () => { gancho++; },
    ejecutar: async () => true,
  });
  c5.encolar({ id: "z" });
  await c5.reenviar();
  check("antesDeReenviar se ejecuta", gancho === 1 && c5.pendientes().length === 0);

  // Persistencia entre instancias + vaciar.
  const c6 = crearColaSync({ clave: "test-persist", ejecutar: async () => true });
  check("nueva instancia lee el disco", c6.pendientes().length === 0);
  c6.encolar({ id: "w" });
  const c7 = crearColaSync({ clave: "test-persist", ejecutar: async () => true });
  check("la cola sobrevive entre instancias", c7.pendientes().length === 1);
  c7.vaciar();
  check("vaciar limpia memoria y disco", c7.pendientes().length === 0 && tienda.get("test-persist") === "[]");

  console.log(`\n${ok} OK, ${fail} FALLAS`);
  rmSync(outDir, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
};

t().catch((e) => {
  console.log("FALLA: excepción", String(e && e.message || e).slice(0, 500));
  process.exit(1);
});
