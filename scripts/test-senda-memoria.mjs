// test-senda-memoria.mjs — Tests DETERMINISTAS de senda-memoria.mjs.
//
// 100% sin red en el sentido de servicios externos: HABITOS_MOCK=1 (tienda
// en memoria) + embedder e5 LOCAL (el modelo ya está descargado en
// ~/workspace/senda-memoria/.model-cache). Nada aquí depende de hora,
// azar ni APIs: la misma corrida da el mismo resultado siempre (el modelo
// es determinista bit a bit en CPU).
//
//   node --test scripts/test-senda-memoria.mjs
//
// Nota: con e5 los documentos se embeben con "passage: " y las consultas
// con "query: ". El mismo texto crudo en guardar vs buscar da distancia
// ~0.05 (no 0): T5 lo tiene en cuenta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

process.env.HABITOS_MOCK = "1";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://mock.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock";
process.env.HABITOS_USER_ID = "test-user";

const { embed, embedDoc, embedQuery, coseno, crearStore, DIMS } = await import("./senda-memoria.mjs");

const cfg = (u) => ({ USER_ID: u });

// ── T1: determinismo bit a bit ─────────────────────────────────────────────
test("T1 embed es determinista: mismo texto ⇒ vector idéntico", async () => {
  const a = await embed("El arroz lo compro en Makro los lunes");
  const b = await embed("El arroz lo compro en Makro los lunes");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.length, DIMS);
  assert.equal(DIMS, 384);
});

// ── T2: normalización L2 ───────────────────────────────────────────────────
test("T2 vectores con norma L2 = 1", async () => {
  for (const t of ["hola mundo", "café con leche", "123 $%&"]) {
    const v = await embed(t);
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(n - 1) < 1e-6, `${t}: norma=${n}`);
  }
});

// ── T3: textos distintos ⇒ vectores distintos ──────────────────────────────
test("T3 textos distintos dan vectores distintos", async () => {
  const a = await embed("me gusta el café");
  const b = await embed("el condominio subió de precio");
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

// ── T4: ranking semántico + estable entre corridas ─────────────────────────
test("T4 buscar ordena por similitud semántica y el ranking es estable", async () => {
  const store = crearStore(cfg("u-t4"));
  const textos = [
    "me gusta el café negro en la mañana",
    "el café lo compro en el mercado",
    "el arroz está caro esta semana",
    "ayer pagué el condominio",
  ];
  for (const t of textos) await store.guardar("u-t4", t, "general");
  const res = await store.buscar("u-t4", "café", 10, null);

  // Los dos de café deben quedar arriba (invariante semántica)
  const top2 = new Set(res.slice(0, 2).map((r) => r.texto));
  assert.ok(top2.has(textos[0]) && top2.has(textos[1]), `top2=${[...top2]}`);

  // El modelo es determinista: el ranking no cambia entre corridas
  const res2 = await store.buscar("u-t4", "café", 10, null);
  assert.deepEqual(
    res.map((r) => r.texto),
    res2.map((r) => r.texto)
  );
});

// ── T4b: prefijos e5 — doc y query del mismo texto son cercanos ────────────
test("T4b embedDoc y embedQuery del mismo texto quedan cerca", async () => {
  const d = await embedDoc("recuerda comprar harina pan");
  const q = await embedQuery("recuerda comprar harina pan");
  assert.equal(d.length, 384);
  assert.equal(q.length, 384);
  const dist = 1 - coseno(d, q);
  assert.ok(dist < 0.15, `distancia=${dist}`);
});

// ── T5: texto idéntico queda primero, distancia pequeña ────────────────────
test("T5 texto idéntico queda primero con distancia < 0.15", async () => {
  const store = crearStore(cfg("u-t5"));
  await store.guardar("u-t5", "recuerda comprar harina pan", "mercado");
  await store.guardar("u-t5", "el condominio se paga mañana", "finanzas");
  const res = await store.buscar("u-t5", "recuerda comprar harina pan", 5, null);
  assert.equal(res[0].texto, "recuerda comprar harina pan");
  assert.ok(res[0].distancia < 0.15, `distancia=${res[0].distancia}`);
  assert.ok(res.every((r) => r.distancia >= 0 && r.distancia <= 2));
});

// ── T6: filtro por módulo ──────────────────────────────────────────────────
test("T6 buscar filtra por módulo", async () => {
  const store = crearStore(cfg("u-t6"));
  await store.guardar("u-t6", "pagué 100 dólares de alquiler", "finanzas");
  await store.guardar("u-t6", "compré 2 kilos de queso", "mercado");
  const res = await store.buscar("u-t6", "pagué", 10, "mercado");
  assert.equal(res.length, 1);
  assert.equal(res[0].modulo, "mercado");
});

// ── T7: límite se respeta ─────────────────────────────────────────────────
test("T7 buscar respeta el límite", async () => {
  const store = crearStore(cfg("u-t7"));
  for (let i = 0; i < 8; i++) await store.guardar("u-t7", `dato número ${i} para probar`, "general");
  const res = await store.buscar("u-t7", "dato", 3, null);
  assert.equal(res.length, 3);
});

// ── T8: borrar ────────────────────────────────────────────────────────────
test("T8 borrar elimina y borrar inexistente ⇒ false", async () => {
  const store = crearStore(cfg("u-t8"));
  const id = await store.guardar("u-t8", "esto se va a borrar", "general");
  assert.equal(await store.borrar("u-t8", id), true);
  assert.equal(await store.borrar("u-t8", id), false);
  const res = await store.buscar("u-t8", "esto se va a borrar", 5, null);
  assert.equal(res.length, 0);
});

// ── T9: aislamiento por usuario ───────────────────────────────────────────
test("T9 un usuario no ve memorias de otro", async () => {
  const store = crearStore(cfg("u-t9"));
  await store.guardar("u-t9", "secreto de u-t9", "general");
  const res = await store.buscar("otro-usuario", "secreto", 5, null);
  assert.equal(res.length, 0);
});

// ── T10: CLI falla cerrado sin --q ────────────────────────────────────────
test("T10 CLI guardar sin --q ⇒ ok:false sin-texto", () => {
  let out;
  try {
    out = execFileSync("node", ["scripts/senda-memoria.mjs", "guardar"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env },
      encoding: "utf8",
    });
  } catch (e) {
    out = e.stdout; // el CLI sale con código 1 pero el JSON va a stdout
  }
  const j = JSON.parse(out);
  assert.equal(j.ok, false);
  assert.equal(j.codigo, "sin-texto");
});

// ── T11: CLI guardar ⇒ ok:true con id ─────────────────────────────────────
test("T11 CLI guardar devuelve id", () => {
  const out = execFileSync("node", ["scripts/senda-memoria.mjs", "guardar", "--q", "probar el cli"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env },
    encoding: "utf8",
  });
  const j = JSON.parse(out);
  assert.equal(j.ok, true);
  assert.ok(j.id);
});

// ── T12: coseno simétrico y acotado ────────────────────────────────────────
test("T12 coseno simétrico en [-1,1]", async () => {
  const a = await embed("el perro corre rápido");
  const b = await embed("rápido corre el perro");
  const ab = coseno(a, b);
  const ba = coseno(b, a);
  assert.ok(Math.abs(ab - ba) < 1e-15);
  assert.ok(ab >= -1 && ab <= 1);
});
