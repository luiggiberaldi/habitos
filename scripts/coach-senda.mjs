#!/usr/bin/env node
// Coach de Senda (Fase 4 — Inteligencia cruzada).
//
//   node scripts/coach-senda.mjs [--texto]
//
// Lee `rpc_coach_briefing` (solo lectura, alcance propio/hogar) y genera el
// informe cruzado de la suite: hábitos + finanzas + mercado + control + tasas.
//   --texto  → informe listo para WhatsApp (sin emojis)
//   (sin)    → JSON del briefing crudo
//
// Las correlaciones las genera el RPC con reglas sobre datos reales; cada una
// trae `ver_en` (ruta de la app donde se verifica) y `datos` (las cifras).

import { cargarConfig } from "./whatsapp-comun.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
const out = (obj) => { console.log(JSON.stringify(obj)); process.exit(obj.ok === false ? 1 : 0); };

const cfg = cargarConfig({});

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

const fmtUsd = (n) =>
  n === null || n === undefined
    ? "—"
    : "$" + Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function informeTexto(b) {
  const L = [];
  const v = b.ventana;
  L.push(`Coach Senda · ${v.desde} al ${v.hasta}`);
  L.push("");
  const h = b.habitos;
  L.push(`Hábitos: ${h.completados_7d} registros esta semana (${h.completados_7d_prev} la anterior).`);
  const f = b.finanzas;
  L.push(`Gastos: ${fmtUsd(f.egresos_7d_usd)} esta semana (${fmtUsd(f.egresos_7d_prev_usd)} la anterior).`);
  if (f.top_categorias.length > 0) {
    const t = f.top_categorias[0];
    L.push(`Categoría top: ${t.categoria} (${fmtUsd(t.actual)}).`);
  }
  const c = b.control;
  if (c.recordatorios_vencidos > 0) L.push(`Atención: ${c.recordatorios_vencidos} pago(s) vencido(s).`);
  if (c.deudas_pendientes > 0)
    L.push(`Deudas pendientes: ${fmtUsd(c.deudas_pendientes_usd)} (${c.deudas_vencen_7d} vencen esta semana).`);
  const m = b.mercado;
  if (m.lista_pendientes > 0) L.push(`Lista de mercado: ${m.lista_pendientes} pendiente(s).`);
  const t = b.tasas;
  if (t.pct_7d !== null && t.pct_7d !== undefined)
    L.push(`Paralelo: Bs ${t.paralelo_hoy} (${t.pct_7d >= 0 ? "+" : ""}${t.pct_7d}% en 7 días).`);
  const cors = b.correlaciones || [];
  if (cors.length > 0) {
    L.push("");
    L.push("Correlaciones:");
    for (const cor of cors) L.push(`- ${cor.titulo}. ${cor.detalle}`);
  } else {
    L.push("");
    L.push("Sin correlaciones esta semana: aún hay pocos datos. Sigue registrando.");
  }
  return L.join("\n");
}

async function main() {
  const b = await rpc("rpc_coach_briefing", { p_user_id: cfg.USER_ID });
  if (args.texto) {
    console.log(informeTexto(b));
    return;
  }
  out({ ok: true, briefing: b });
}

main().catch((e) => out({ ok: false, codigo: "error", detalle: e.message.slice(0, 200) }));
