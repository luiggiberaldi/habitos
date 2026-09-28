#!/usr/bin/env node
// Consultas globales por WhatsApp (Fase 4 — Inteligencia cruzada).
//
//   node scripts/whatsapp-global.mjs --q "<texto sin prefijo de módulo>"
//
// Responde preguntas que cruzan módulos sin que el usuario tenga que saber
// el prefijo correcto:
//   "¿cuánto debo en total?" / "¿cuánto debo?"   → deudas pendientes (Control)
//   "¿qué me falta comprar?" / "lista"            → pendientes de mercado
//   "¿cuánto gasté esta semana?" / "¿este mes?"   → egresos (Finanzas)
//   "coach"                                      → mini-briefing cruzado
//
// Contrato: siempre JSON a stdout (ok / ambiguo / sin-match / error).
// Nunca se confirma sin ejecutar el RPC.

import { cargarConfig, norm } from "./whatsapp-comun.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
const out = (obj) => { console.log(JSON.stringify(obj)); process.exit(obj.ok ? 0 : 1); };
const q = String(args.q ?? "").trim();
if (!q) out({ ok: false, codigo: "args", detalle: 'se requiere --q "<texto>"' });

const cfg = cargarConfig({});
const P = { p_user_id: cfg.USER_ID };
const bajo = norm(q);

async function rpc(fn, params) {
  const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: cfg.ANON_KEY,
      Authorization: `Bearer ${cfg.ANON_KEY}`,
      "x-fin-rpc-secret": cfg.secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  // ── ¿cuánto debo en total? ──
  // Combina la cartera comercial (Fase 6: car_clientes) con las deudas de
  // Control (Fase 3: fin_deudas). Signo: positivo = me deben, negativo = les debo.
  if (/cu[aá]nto (debo|deben|me deben)/.test(bajo)) {
    let porPagar = [], porCobrar = [];
    try {
      const deudas = await rpc("rpc_fin_deudas", P);
      const pend = (Array.isArray(deudas) ? deudas : []).filter((d) => d.estado === "pendiente");
      porPagar = pend.filter((d) => d.tipo === "por_pagar")
        .map((d) => ({ contraparte: d.contraparte, pendiente: d.pendiente, moneda: d.moneda, origen: "control" }));
      porCobrar = pend.filter((d) => d.tipo === "por_cobrar")
        .map((d) => ({ contraparte: d.contraparte, pendiente: d.pendiente, moneda: d.moneda, origen: "control" }));
    } catch { /* Control aún sin deudas: se ignora */ }
    try {
      const cartera = await rpc("rpc_car_cartera", { p_user_id: cfg.USER_ID, p_cliente_id: null, p_limite_movimientos: 1 });
      for (const c of cartera.clientes || []) {
        for (const s of c.saldos || []) {
          const v = Number(s.saldo);
          if (!v) continue;
          const item = { contraparte: c.nombre, pendiente: Math.abs(v), moneda: s.moneda, origen: "cartera" };
          if (v > 0) porCobrar.push(item); else porPagar.push(item);
        }
      }
    } catch { /* cartera vacía o sin acceso: se ignora */ }
    return out({ ok: true, codigo: "deuda_total", por_pagar: porPagar, por_cobrar: porCobrar });
  }

  // ── ¿qué me falta comprar? ──
  if (/qu[eé] me falta comprar|lista( de compras)?|qu[eé] falta comprar/.test(bajo)) {
    const lista = await rpc("rpc_mer_lista", P);
    const pend = (Array.isArray(lista) ? lista : []).filter((l) => l.estado === "pendiente");
    return out({
      ok: true,
      codigo: "lista_compras",
      pendientes: pend.map((l) => ({ producto: l.producto || l.nombre, cantidad: l.cantidad, unidad: l.unidad })),
    });
  }

  // ── ¿cuánto gasté esta semana / este mes? ──
  let m = bajo.match(/cu[aá]nto gast[eé]( esta semana| este mes)?/);
  if (m) {
    const b = await rpc("rpc_coach_briefing", P);
    const semana = m[1] && m[1].includes("mes");
    return out({
      ok: true,
      codigo: "gasto",
      periodo: semana ? "mes" : "semana",
      egresos_7d_usd: b.finanzas.egresos_7d_usd,
      egresos_7d_prev_usd: b.finanzas.egresos_7d_prev_usd,
      top_categorias: b.finanzas.top_categorias,
      nota_mes: semana ? "El desglose mensual completo está en Finanzas." : undefined,
    });
  }

  // ── coach ──
  if (/^coach\b/.test(bajo)) {
    const b = await rpc("rpc_coach_briefing", P);
    return out({
      ok: true,
      codigo: "coach",
      ventana: b.ventana,
      resumen: {
        habitos_7d: b.habitos.completados_7d,
        egresos_7d_usd: b.finanzas.egresos_7d_usd,
        deudas_pendientes: b.control.deudas_pendientes,
        lista_pendientes: b.mercado.lista_pendientes,
        recordatorios_vencidos: b.control.recordatorios_vencidos,
      },
      correlaciones: b.correlaciones,
    });
  }

  return out({ ok: false, codigo: "sin-match", detalle: "No es una consulta global que reconozca." });
}

main().catch((e) => out({ ok: false, codigo: "error", detalle: e.message.slice(0, 200) }));
