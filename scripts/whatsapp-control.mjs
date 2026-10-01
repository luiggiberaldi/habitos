#!/usr/bin/env node
// Módulo Control por WhatsApp (Fase 3).
//
//   node scripts/whatsapp-control.mjs --q "<texto sin el prefijo>"
//
// Contrato: siempre JSON a stdout. El agente responde SOLO desde el JSON:
//   ok:true            → confirmar con los datos devueltos
//   ok:false + ambiguo → preguntar (el campo `pregunta` trae el texto)
//   ok:false           → decir lo que indica `detalle`
//
// Intenciones:
//   "pagué internet" / "pagar alquiler"          → paga el recordatorio
//   "estado" / "resumen"                         → próximos pagos + alertas + deudas
//   "deudas" / "cuánto debo"                     → deudas pendientes
//   "presupuestos"                              → estado de presupuestos del mes
//   "ayuda"                                     → comandos
//
// Reglas: nunca se confirma sin ejecutar el RPC; la ambigüedad (varios
// recordatorios con el mismo nombre) se pregunta, no se adivina. El secreto
// viaja en el header `x-fin-rpc-secret` (el mismo valor que el de hábitos).

import { writeSync } from "node:fs";
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
const out = (obj) => { writeSync(1, JSON.stringify(obj) + "\n"); process.exit(obj.ok ? 0 : 1); };
const q = String(args.q ?? "").trim();
if (!q) out({ ok: false, codigo: "args", detalle: 'se requiere --q "<texto>"' });

function crearRpc(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) {
      if (fn === "rpc_fin_recordatorios") return [];
      if (fn === "rpc_fin_recordatorio_upsert") return { ok: true, id: "mock-rec" };
      if (fn === "rpc_fin_recordatorio_toggle") return { ok: true, id: params.p_id, activo: params.p_activo };
      if (fn === "rpc_fin_recordatorio_pagar") return { ok: true, monto: 30, moneda: "USD", proximo: "2026-10-27" };
      if (fn === "rpc_fin_deudas") return [];
      if (fn === "rpc_fin_deuda_upsert") return { ok: true, id: "mock-deuda" };
      if (fn === "rpc_fin_deuda_abonar") return { ok: true, abonado_total: params.p_monto, saldada: false };
      if (fn === "rpc_fin_presupuestos") return [];
      if (fn === "rpc_fin_presupuesto_upsert") return { ok: true, id: "mock-pres", mes: "2026-10-01" };
      if (fn === "rpc_fin_saldos") return [
        { id: "c-bdv", nombre: "BDV", moneda: "VES", tipo: "banco" },
        { id: "c-bin", nombre: "Binance", moneda: "USDT", tipo: "cripto" },
      ];
      throw new Error(`mock sin datos para ${fn}`);
    }
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
  };
}

const cfg = cargarConfig({});
const rpc = crearRpc(cfg);
const P = { p_user_id: cfg.USER_ID };
const bajo = norm(q);

/** Parsea un monto suelto en formato es-VE (1.234,56) o simple. */
function parseMontoEsVe(s) {
  if (!s) return null;
  let t = String(s).trim();
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Moneda: la explícita manda; si no hay, usa `defecto` (deudas → VES por la regla Bs→BDV; recordatorios → USD). */
function detectarMonedaControl(texto, defecto = "VES") {
  const n = norm(texto);
  if (/\b(usdt|tether)\b/.test(n)) return "USDT";
  if (/\$|\b(dolar(es)?|usd|bucks?)\b/.test(n)) return "USD";
  if (/\b(cop|pesos?)\b/.test(n)) return "COP";
  if (/\b(bs|bolivares?|ves)\b/.test(n)) return "VES";
  return defecto;
}

/** Extrae { monto, resto } del primer número en el texto crudo (norm() rompe decimales). */
function extraerMontoYResto(texto) {
  const m = texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return { monto: null, resto: texto };
  const monto = parseMontoEsVe(m[1]);
  const resto = (texto.slice(0, m.index) + " " + texto.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { monto, resto };
}

/** Limpia la contraparte: quita "a", monedas y conectores. */
function limpiarContraparte(resto) {
  let s = ` ${norm(resto)} `;
  s = s.replace(/\b(a|al|de|del|en|el|la|los|las|un|una|por|me|le)\b/g, " ");
  s = s.replace(/\b(bs|bolivares?|ves|dolares?|usd|usdt|cop|pesos?)\b/g, " ");
  s = s.replace(/\$/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s : null;
}

/** Cuenta por defecto según moneda (VES → BDV, por la regla de luigi). */
async function cuentaPorMoneda(moneda) {
  try {
    const saldos = await rpc("rpc_fin_saldos", P);
    const c = saldos.find((x) => x.moneda === moneda) || saldos[0];
    return c ? c.id : null;
  } catch {
    return null;
  }
}

function fmtMonto(m, moneda) {
  try {
    return new Intl.NumberFormat("es-VE", { style: "currency", currency: moneda, maximumFractionDigits: 2 }).format(Number(m));
  } catch {
    return `${m} ${moneda}`;
  }
}

async function main() {
  // ── ayuda ──
  if (/^ayuda\b/.test(bajo)) {
    return out({
      ok: true,
      codigo: "ayuda",
      comandos: [
        "control pagué internet — marca el recordatorio como pagado",
        "control estado — próximos pagos, presupuestos y deudas",
        "control deudas — deudas pendientes",
        "control presupuestos — estado del mes",
        "control me debe Ezequiel 4300 — anota un por cobrar",
        "control me pagó Ezequiel 1000 — registra un cobro",
        "control recuerda internet 30 cada 27 — crea recordatorio mensual",
        "control no recordar internet — desactiva un recordatorio",
        "control presupuesto mercado 200 — tope mensual de la categoría",
      ],
    });
  }

  // ── me debe <nombre> <monto> / le presté <monto> a <nombre> — mejora 2 (plan 2026-10-01) ──
  if (/^(me debe|le preste)\b/.test(bajo)) {
    const restoQ = q.replace(/^\s*(me debe|le prest[ée])(?=\s|$)/i, "").trim();
    const { monto, resto } = extraerMontoYResto(restoQ);
    if (monto === null) {
      return out({ ok: false, codigo: "ambiguo", pregunta: "¿Cuánto te debe? Ej. «control me debe Ezequiel 4300».", detalle: "no se encontró un monto" });
    }
    const contraparte = limpiarContraparte(resto);
    if (!contraparte) {
      return out({ ok: false, codigo: "ambiguo", pregunta: "¿Quién te debe? Ej. «control me debe Ezequiel 4300».", detalle: "no se encontró la contraparte" });
    }
    const moneda = detectarMonedaControl(restoQ);
    try {
      const r = await rpc("rpc_fin_deuda_upsert", {
        ...P, p_tipo: "por_cobrar", p_contraparte: contraparte,
        p_monto: monto, p_moneda: moneda,
        p_cuenta_id: await cuentaPorMoneda(moneda),
        p_nota: "registrado por WhatsApp",
      });
      const fmt = fmtMonto(monto, moneda);
      return out({
        ok: true, codigo: "deuda_creada", id: r.id, tipo: "por_cobrar",
        contraparte, monto, moneda,
        mensaje: `Anotado: ${contraparte} te debe ${fmt}. Cuando te pague di «control me pagó ${contraparte} <monto>».`,
      });
    } catch (e) {
      return out({ ok: false, codigo: "error", detalle: String(e.message || e).replace(/^.*?: /, "").slice(0, 200) });
    }
  }

  // ── me pagó <nombre> <monto> — abona a un por_cobrar (mejora 2) ──
  if (/^me pag[óo](?=\s|$)/.test(bajo)) {
    const restoQ = q.replace(/^\s*me pag[óo](?=\s|$)/i, "").trim();
    const { monto, resto } = extraerMontoYResto(restoQ);
    if (monto === null) {
      return out({ ok: false, codigo: "ambiguo", pregunta: "¿Cuánto te pagó? Ej. «control me pagó Ezequiel 1000».", detalle: "no se encontró un monto" });
    }
    const contraparte = limpiarContraparte(resto);
    if (!contraparte) {
      return out({ ok: false, codigo: "ambiguo", pregunta: "¿Quién te pagó? Ej. «control me pagó Ezequiel 1000».", detalle: "no se encontró la contraparte" });
    }
    const deudas = await rpc("rpc_fin_deudas", P);
    const cands = deudas.filter((d) => d.tipo === "por_cobrar" && d.estado === "pendiente" && norm(d.contraparte).includes(contraparte));
    if (!cands.length) {
      return out({ ok: false, codigo: "sin-match", detalle: `No hay un por cobrar pendiente de "${contraparte}".` });
    }
    if (cands.length > 1) {
      return out({ ok: false, codigo: "ambiguo", pregunta: `¿Cuál? ${cands.map((c) => `${c.contraparte} (${fmtMonto(c.pendiente, c.moneda)} pendiente)`).join(", ")}.`, detalle: "varias deudas coinciden" });
    }
    const d = cands[0];
    try {
      const r = await rpc("rpc_fin_deuda_abonar", { ...P, p_id: d.id, p_monto: monto, p_nota: "cobro por WhatsApp" });
      return out({
        ok: true, codigo: "deuda_abonada", contraparte: d.contraparte, monto, moneda: d.moneda,
        saldada: r.saldada === true, pendiente: Math.round((Number(d.pendiente) - monto) * 100) / 100,
        mensaje: r.saldada
          ? `✅ ${d.contraparte} saldó su deuda (${fmtMonto(monto, d.moneda)}). Ingreso registrado.`
          : `Cobro registrado: ${fmtMonto(monto, d.moneda)} de ${d.contraparte}. Le quedan ${fmtMonto(Math.round((Number(d.pendiente) - monto) * 100) / 100, d.moneda)}.`,
      });
    } catch (e) {
      return out({ ok: false, codigo: "error", detalle: String(e.message || e).replace(/^.*?: /, "").slice(0, 200) });
    }
  }

  // ── recuerda <nombre> <monto> cada <día> — mejora 5 (plan 2026-10-01) ──
  if (/^(recuerda|recordatorio|aviso)\b/.test(bajo)) {
    const restoQ = q.replace(/^\s*(recuerda|recordatorio|aviso)\b/i, "").trim();
    const mDia = restoQ.match(/(?:cada|dia|el)\s+(\d{1,2})\b/i);
    const dia = mDia ? parseInt(mDia[1], 10) : null;
    const sinDia = mDia ? (restoQ.slice(0, mDia.index) + " " + restoQ.slice(mDia.index + mDia[0].length)) : restoQ;
    const { monto, resto } = extraerMontoYResto(sinDia);
    const nombre = limpiarContraparte(resto);
    if (monto === null || !nombre || dia === null || dia < 1 || dia > 31) {
      return out({ ok: false, codigo: "args", detalle: 'Di «control recuerda <nombre> <monto> cada <día del mes>». Ej. «control recuerda internet 30 cada 27».' });
    }
    const moneda = detectarMonedaControl(restoQ, "USD");
    try {
      // Si ya existe un recordatorio activo con ese nombre, se actualiza (no se duplica).
      const existentes = await rpc("rpc_fin_recordatorios", P);
      const mismo = existentes.filter((r) => r.activo && norm(r.nombre) === nombre);
      const r = await rpc("rpc_fin_recordatorio_upsert", {
        ...P, p_nombre: nombre, p_monto: monto, p_moneda: moneda,
        p_dia_mes: dia, p_dias_aviso: 3, p_tipo: "egreso",
        p_categoria: "servicios",
        p_cuenta_id: await cuentaPorMoneda(moneda),
        ...(mismo.length === 1 ? { p_id: mismo[0].id } : {}),
      });
      return out({
        ok: true, codigo: "recordatorio_creado", id: r.id, nombre, monto, moneda, dia,
        actualizado: mismo.length === 1,
        mensaje: mismo.length === 1
          ? `Recordatorio "${nombre}" actualizado: ${fmtMonto(monto, moneda)} cada día ${dia}.`
          : `Recordatorio creado: ${nombre} ${fmtMonto(monto, moneda)} cada día ${dia} (aviso 3 días antes). Para pagarlo di «control pagué ${nombre}».`,
      });
    } catch (e) {
      return out({ ok: false, codigo: "error", detalle: String(e.message || e).replace(/^.*?: /, "").slice(0, 200) });
    }
  }

  // ── no recordar <nombre> — desactiva un recordatorio ──
  if (/^no recordar\b/.test(bajo)) {
    const nombreQ = norm(q.replace(/^\s*no recordar\b/i, "").trim());
    if (!nombreQ) return out({ ok: false, codigo: "args", detalle: 'Di «control no recordar <nombre>».' });
    const recs = await rpc("rpc_fin_recordatorios", P);
    const cands = recs.filter((r) => r.activo && norm(r.nombre).includes(nombreQ));
    if (!cands.length) return out({ ok: false, codigo: "sin-match", detalle: `No hay un recordatorio activo llamado "${nombreQ}".` });
    if (cands.length > 1) {
      return out({ ok: false, codigo: "ambiguo", pregunta: `¿Cuál desactivo? ${cands.map((c) => c.nombre).join(", ")}.`, detalle: "varios coinciden" });
    }
    const nombreOff = cands[0].nombre;
    await rpc("rpc_fin_recordatorio_toggle", { ...P, p_id: cands[0].id, p_activo: false });
    return out({ ok: true, codigo: "recordatorio_off", nombre: nombreOff, mensaje: `Recordatorio "${nombreOff}" desactivado.` });
  }

  // ── presupuesto <categoría> <monto> — mejora 7 (plan 2026-10-01) ──
  if (/^presupuesto\b/.test(bajo)) {
    const restoQ = q.replace(/^\s*presupuesto\b/i, "").trim();
    const { monto, resto } = extraerMontoYResto(restoQ);
    const categoria = limpiarContraparte(resto);
    if (monto === null || !categoria) {
      return out({ ok: false, codigo: "args", detalle: 'Di «control presupuesto <categoría> <monto>». Ej. «control presupuesto mercado 200».' });
    }
    // Presupuestos en USD por defecto; "bs" lo pone en bolívares.
    let moneda = detectarMonedaControl(restoQ);
    if (moneda === "VES" && !/\b(bs|bolivares?|ves)\b/i.test(restoQ)) moneda = "USD";
    try {
      await rpc("rpc_fin_presupuesto_upsert", { ...P, p_categoria: categoria, p_monto_limite: monto, p_moneda: moneda });
      return out({
        ok: true, codigo: "presupuesto_creado", categoria, monto, moneda,
        mensaje: `Presupuesto de ${categoria}: ${fmtMonto(monto, moneda)} para este mes. Te avisaré al registrar gastos que lo acerquen al límite.`,
      });
    } catch (e) {
      return out({ ok: false, codigo: "error", detalle: String(e.message || e).replace(/^.*?: /, "").slice(0, 200) });
    }
  }

  // ── pagar <nombre> ──
  let m = bajo.match(/^(pag[uo][ée]?|marcar (como )?(pagado|cobrado)|cobrado?)\s+(.+)$/);
  if (m) {
    const nombreQ = norm(m[4]);
    const recs = await rpc("rpc_fin_recordatorios", P);
    const cands = recs.filter((r) => r.activo && norm(r.nombre).includes(nombreQ));
    if (cands.length === 0) {
      return out({ ok: false, codigo: "sin-match", detalle: `No encontré un recordatorio activo que se llame "${m[4]}".` });
    }
    if (cands.length > 1) {
      return out({
        ok: false,
        codigo: "ambiguo",
        pregunta: `¿Cuál de estos? ${cands.map((c) => `"${c.nombre}" (${fmtMonto(c.monto, c.moneda)})`).join(", ")}`,
        candidatos: cands.map((c) => ({ id: c.id, nombre: c.nombre })),
      });
    }
    const r = cands[0];
    try {
      const pago = await rpc("rpc_fin_recordatorio_pagar", { ...P, p_id: r.id });
      return out({
        ok: true,
        codigo: "pagado",
        recordatorio: r.nombre,
        tipo: r.tipo,
        monto: pago.monto,
        moneda: pago.moneda,
        proximo: pago.proximo,
        duplicado: pago.duplicado === true,
      });
    } catch (e) {
      return out({ ok: false, codigo: "error", detalle: e.message.replace(/^.*?: /, "") });
    }
  }

  // ── deudas ──
  if (/^(deudas|cu[aá]nto debo|qu[eé] me deben)\b/.test(bajo)) {
    const deudas = await rpc("rpc_fin_deudas", P);
    const pendientes = deudas.filter((d) => d.estado === "pendiente");
    const items = pendientes.map((d) => ({
      contraparte: d.contraparte,
      tipo: d.tipo,
      pendiente: d.pendiente,
      moneda: d.moneda,
      fecha_limite: d.fecha_limite,
    }));
    const lineas = items.map((d) => {
      const quien = d.tipo === "por_cobrar" ? `${d.contraparte} te debe` : `le debes a ${d.contraparte}`;
      const limite = d.fecha_limite ? ` (límite ${d.fecha_limite})` : "";
      return `• ${quien} ${fmtMonto(d.pendiente, d.moneda)}${limite}`;
    });
    return out({
      ok: true,
      codigo: "deudas",
      deudas: items,
      mensaje: lineas.length ? `Deudas pendientes:\n${lineas.join("\n")}` : "Sin deudas pendientes.",
    });
  }

  // ── presupuestos ──
  if (/^presupuestos?\b/.test(bajo)) {
    const pres = await rpc("rpc_fin_presupuestos", P);
    return out({
      ok: true,
      codigo: "presupuestos",
      presupuestos: pres.map((p) => ({
        categoria: p.categoria,
        gastado_usd: p.gastado_usd,
        limite_usd: p.limite_usd,
        pct: p.pct,
        estado: p.estado,
      })),
    });
  }

  // ── estado / resumen ──
  if (/^(estado|resumen|c[oó]mo voy)\b/.test(bajo)) {
    const [recs, pres, deudas] = await Promise.all([
      rpc("rpc_fin_recordatorios", P),
      rpc("rpc_fin_presupuestos", P),
      rpc("rpc_fin_deudas", P),
    ]);
    const proximos = recs
      .filter((r) => r.activo && (r.estado === "vencido" || r.estado === "por_vencer"))
      .map((r) => ({ nombre: r.nombre, tipo: r.tipo, monto: r.monto, moneda: r.moneda, proximo: r.proximo, estado: r.estado }));
    const alertas = pres
      .filter((p) => p.estado !== "ok")
      .map((p) => ({ categoria: p.categoria, pct: p.pct, estado: p.estado }));
    const pendientes = deudas
      .filter((d) => d.estado === "pendiente")
      .map((d) => ({ contraparte: d.contraparte, tipo: d.tipo, pendiente: d.pendiente, moneda: d.moneda }));
    return out({ ok: true, codigo: "estado", proximos, alertas, pendientes });
  }

  return out({
    ok: false,
    codigo: "sin-match",
    detalle: 'No entendí. Prueba con "control ayuda".',
  });
}

main().catch((e) => out({ ok: false, codigo: "error", detalle: e.message.slice(0, 200) }));
