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

function crearRpc(cfg) {
  return async function rpc(fn, params) {
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
      ],
    });
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
    return out({
      ok: true,
      codigo: "deudas",
      deudas: pendientes.map((d) => ({
        contraparte: d.contraparte,
        tipo: d.tipo,
        pendiente: d.pendiente,
        moneda: d.moneda,
        fecha_limite: d.fecha_limite,
      })),
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
