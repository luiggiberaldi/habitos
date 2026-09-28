#!/usr/bin/env node
// Módulo Mercado por WhatsApp (Fase 2).
//
//   node scripts/whatsapp-mercado.mjs --q "<texto sin el prefijo>"
//   node scripts/whatsapp-mercado.mjs --confirmar '<json del resumen>'
//
// Contrato: siempre JSON a stdout. El agente responde SOLO desde el JSON.
//
// Intenciones:
//   "factura 2kg arroz 8$, 1L leche 150bs en Makro" → RESUMEN (no ejecuta)
//   --confirmar '<json>'                             → ejecuta la factura
//   "compré 2kg de arroz en 8$"                      → resumen (igual que factura)
//   "gasté 1L de leche" / "consumí 2 huevos"         → consumo directo
//   "se acabó el arroz"                              → stock a 0
//   "se dañó 1kg de arroz"                           → dañado
//   "inventario" / "qué hay"                         → stock con alertas
//   "lista"                                          → lista de compras
//   "agrega 2kg de arroz a la lista"                 → agrega a la lista
//   "presupuesto"                                    → presupuesto mensual
//   "precio del arroz" / "cuánto cuesta el arroz"    → último precio y rango
//   "ayuda"
//
// REGLA DE luigi: una factura SIEMPRE se presenta como resumen y espera
// confirmación explícita antes de ejecutar. Nunca se registra directo.
// Los productos nuevos exigen unidad + categoría (los 4 obligatorios).

import { createHash } from "node:crypto";
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

function crearRpc(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) {
      if (fn === "rpc_mer_inventario") return [
        { id: "p1", nombre: "Arroz", unidad: "kg", categoria: "granos", stock: 0.5, dias_agotamiento: 5, sugerido_comprar: 1.5, precio_usd_unitario: 0.8, ultima_moneda: "USD" },
        { id: "p2", nombre: "Leche", unidad: "L", categoria: "lacteos", stock: 3, dias_agotamiento: 40, sugerido_comprar: 0, precio_usd_unitario: 1.2, ultima_moneda: "USD" },
      ];
      if (fn === "rpc_mer_lista") return [
        { id: "l1", producto_id: "p1", nombre: "Arroz", unidad: "kg", cantidad: 2, estado: "pendiente" },
      ];
      if (fn === "rpc_mer_lista_toggle") return { ok: true, estado: params.p_estado, producto: "Arroz", cantidad: params.p_cantidad };
      if (fn === "rpc_mer_producto_upsert") return { ok: true, id: "mock-p", nombre: params.p_nombre };
      if (fn === "rpc_mer_movimiento") return { ok: true, id: "mock-m", tipo: params.p_tipo, producto: "Arroz", cantidad: params.p_cantidad, unidad: "kg", fin_movimiento_id: params.p_tipo === "compra" && params.p_cuenta_id ? "mock-fin" : null };
      if (fn === "rpc_mer_presupuesto") return { total_usd: 12.5, items: [{ producto: "Arroz", unidad: "kg", consumo_mensual: 2, precio_usd_unitario: 0.8, costo_mensual_usd: 1.6 }] };
      if (fn === "rpc_fin_saldos") return [
        { id: "c1", nombre: "Efectivo", moneda: "USD", saldo_moneda: "120.50" },
        { id: "c2", nombre: "Bolívares", moneda: "VES", saldo_moneda: "4500.00" },
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

// ── Parseo ───────────────────────────────────────────────────────────────────
function numEsVe(s) {
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return n > 0 ? n : null;
}

const UNIDADES = {
  kg: "kg", kilo: "kg", kilos: "kg",
  g: "g", gr: "g", gramo: "g", gramos: "g",
  l: "L", lt: "L", litro: "L", litros: "L",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  und: "und", u: "und", unidad: "und", unidades: "und",
  paq: "paquete", paquete: "paquete", paquetes: "paquete",
  caja: "caja", cajas: "caja",
};

function detectarMonedaChunk(chunk) {
  const n = norm(chunk);
  if (/\$|\busd\b|\bdolares?\b/.test(n)) return "USD";
  if (/\b(bs|bolivares?|ves)\b/.test(n)) return "VES";
  if (/\busdt\b/.test(n)) return "USDT";
  if (/\bcop\b|\bpesos?\b/.test(n)) return "COP";
  return null;
}

const MONEDA_TXT = {
  "$": "USD", usd: "USD", dolar: "USD", dolares: "USD",
  bs: "VES", bolivar: "VES", bolivares: "VES", ves: "VES",
  usdt: "USDT", cop: "COP", peso: "COP", pesos: "COP",
};

/** "2kg arroz 8$" → {cantidad, unidad, nombre, precio, moneda}. `crudo` conserva el $. */
function parsearItem(chunk, crudo) {
  const m = norm(chunk).match(/^([\d.,]+)\s*([a-z]+)\b\.?\s*(.+)$/);
  if (!m) return null;
  const cantidad = numEsVe(m[1]);
  const unidad = UNIDADES[m[2]];
  if (!cantidad || !unidad) return null;
  let resto = m[3].trim();
  // Precio al final: "arroz 8$" / "arroz en 8 dolares".
  let precio = null, moneda = null;
  const mp = resto.match(/([\d.,]+)\s*(bs|bolivares?|ves|\$|usd|dolares?|usdt|cop|pesos?)?\s*$/);
  if (mp) {
    precio = numEsVe(mp[1]);
    if (mp[2]) moneda = MONEDA_TXT[mp[2]] ?? null;
    resto = resto.slice(0, mp.index).trim().replace(/\ben\s*$/, "").trim();
  }
  // norm() borra el $: detectarlo en el texto crudo.
  if (!moneda && crudo && crudo.includes("$")) moneda = "USD";
  let nombre = resto.replace(/^de\s+/, "").trim();
  if (nombre.length < 2) return null;
  return { cantidad: Math.round(cantidad * 1000) / 1000, unidad, nombre, precio, moneda };
}

function dividirItems(texto) {
  return texto
    .split(/;|,(?=\s*\d)|\s+y\s+(?=\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchProducto(inventario, nombre) {
  const n = norm(nombre);
  const scored = inventario.map((p) => {
    const np = norm(p.nombre);
    let score = 0;
    if (np === n) score = 100;
    else if (np.startsWith(n) || n.startsWith(np)) score = 80;
    else if (np.includes(n) || n.includes(np)) score = 50;
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].p : null;
}

function matchCuenta(cuentas, texto) {
  const n = norm(texto);
  return cuentas.filter((c) => {
    const nc = norm(c.nombre);
    return nc && new RegExp(`\\b${nc.replace(/ /g, "\\s+")}\\b`).test(n);
  });
}

const fmtN = (n) => new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(n);
const fmtPrecio = (precio, moneda) => {
  const s = moneda === "VES" ? "Bs" : moneda === "COP" ? "COP" : moneda === "USDT" ? "USDT" : "$";
  return moneda === "USDT" ? `${fmtN(precio)} USDT` : `${s} ${fmtN(precio)}`;
};

// ── Principal ────────────────────────────────────────────────────────────────
let cfg;
try {
  cfg = cargarConfig(args);
} catch (e) {
  out({ ok: false, codigo: "config", detalle: String(e.message || e) });
}
const rpc = crearRpc(cfg);

try {
  // ── confirmar factura (el agente la invoca directo, no por el router) ──
  if (args.confirmar) {
    const payload = JSON.parse(String(args.confirmar));
    const items = payload.items ?? [];
    const cuenta = payload.cuenta;
    if (!items.length) out({ ok: false, codigo: "args", detalle: "la factura no trae artículos" });
    if (!cuenta) out({ ok: false, codigo: "args", detalle: "falta la cuenta del pago" });
    // Clave estable por factura: el mismo resumen confirmado dos veces no duplica.
    const huella = createHash("sha256")
      .update(JSON.stringify({ items, cuenta, comercio: payload.comercio ?? null }))
      .digest("hex")
      .slice(0, 16);
    const registrados = [];
    let idx = 0;
    for (const it of items) {
      if (!it.producto_id) {
        if (!it.categoria) {
          out({ ok: false, codigo: "falta_categoria", pregunta: `¿En qué categoría va "${it.nombre}"?`, detalle: "producto nuevo sin categoría" });
        }
        const up = await rpc("rpc_mer_producto_upsert", {
          p_user_id: cfg.USER_ID, p_nombre: it.nombre, p_unidad: it.unidad,
          p_categoria: it.categoria, p_precio_ref: null,
        });
        it.producto_id = up.id;
      }
      const clave = `mer-wa-${huella}-${idx++}`;
      const r = await rpc("rpc_mer_movimiento", {
        p_user_id: cfg.USER_ID,
        p_producto_id: it.producto_id,
        p_tipo: "compra",
        p_cantidad: it.cantidad,
        p_precio_total: it.precio,
        p_moneda: it.moneda,
        p_comercio: payload.comercio ?? null,
        p_cuenta_id: cuenta,
        p_nota: "factura por WhatsApp",
        p_clave_evento: clave,
      });
      registrados.push({ producto: r.producto, cantidad: it.cantidad, unidad: it.unidad, egreso: !!r.fin_movimiento_id, duplicado: !!r.duplicado });
    }
    const nDup = registrados.filter((r) => r.duplicado).length;
    if (nDup === registrados.length) {
      out({ ok: true, codigo: "factura_duplicada", items: registrados,
        mensaje: `Esta factura ya estaba registrada (${registrados.length} artículos). No se duplicó nada.` });
    }
    const lineas = registrados.map((r) => `• ${fmtN(r.cantidad)} ${r.unidad} ${r.producto}`);
    out({
      ok: true, codigo: "factura_registrada", items: registrados,
      mensaje: `Factura registrada (${registrados.length} artículos):\n${lineas.join("\n")}\nEgreso creado en Finanzas.`,
    });
  }

  if (!q) out({ ok: false, codigo: "args", detalle: "se requiere --q \"<texto>\"" });
  const nq = norm(q);

  // ── ayuda ──
  if (/^ayuda$/.test(nq)) {
    out({
      ok: true, codigo: "ayuda", modulo: "mercado",
      mensaje: "Mercado por WhatsApp:\n• factura 2kg arroz 8$, 1L leche 150bs en Makro → te muestro el resumen y lo confirmas\n• compré 2kg de arroz en 8$ → igual que factura\n• gasté 1L de leche → registra consumo\n• se acabó el arroz → stock a cero\n• se dañó 1kg de arroz\n• inventario → qué hay y qué se acaba\n• lista → lista de compras\n• agrega 2kg de arroz a la lista\n• presupuesto → gasto mensual estimado\n• precio del arroz → último precio y rango",
    });
  }

  // ── inventario ──
  if (/^(inventario|que hay|stock|existencias)\b/.test(nq)) {
    const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
    if (!inv.length) out({ ok: true, codigo: "inventario", items: [], mensaje: "Inventario vacío. Agrega productos en la app (Mercado → Registrar)." });
    const lineas = inv.map((p) => {
      const alerta = p.dias_agotamiento !== null && p.dias_agotamiento <= 7 ? " ⚠" : "";
      return `• ${p.nombre}: ${fmtN(p.stock)} ${p.unidad}${alerta}`;
    });
    const criticos = inv.filter((p) => p.dias_agotamiento !== null && p.dias_agotamiento <= 7);
    out({
      ok: true, codigo: "inventario", items: inv,
      mensaje: `Inventario (${inv.length}):\n${lineas.join("\n")}` +
        (criticos.length ? `\n\nPor agotarse: ${criticos.map((p) => p.nombre).join(", ")}.` : ""),
    });
  }

  // ── lista ──
  if (/^lista\b/.test(nq) && !/agrega/.test(nq)) {
    const lista = await rpc("rpc_mer_lista", { p_user_id: cfg.USER_ID });
    const pend = lista.filter((l) => l.estado === "pendiente");
    if (!pend.length) out({ ok: true, codigo: "lista", items: lista, mensaje: "La lista de compras está vacía." });
    const lineas = pend.map((l) => `• ${fmtN(l.cantidad)} ${l.unidad} ${l.nombre}`);
    out({ ok: true, codigo: "lista", items: lista, mensaje: `Lista de compras:\n${lineas.join("\n")}` });
  }

  // ── agrega a la lista ──
  {
    const mAg = nq.match(/^(?:agrega|anade|mete|pon)\s+(.+?)\s+a\s+la\s+lista$/);
    if (mAg) {
      const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
      const it = parsearItem(mAg[1]) ?? { cantidad: 1, unidad: "und", nombre: mAg[1].trim() };
      const prod = matchProducto(inv, it.nombre);
      if (!prod) {
        out({ ok: false, codigo: "producto_no_encontrado", pregunta: `No encontré "${it.nombre}" en el inventario. ¿Lo creas primero en la app (Mercado → Registrar)?`, detalle: "producto inexistente" });
      }
      const r = await rpc("rpc_mer_lista_toggle", {
        p_user_id: cfg.USER_ID, p_producto_id: prod.id,
        p_cantidad: it.cantidad, p_estado: "pendiente",
      });
      out({ ok: true, codigo: "lista_agregado", mensaje: `${r.producto} agregado a la lista (${fmtN(it.cantidad)} ${prod.unidad}).` });
    }
  }

  // ── presupuesto ──
  if (/^presupuesto\b/.test(nq)) {
    const pb = await rpc("rpc_mer_presupuesto", { p_user_id: cfg.USER_ID });
    const lineas = (pb.items ?? []).slice(0, 8).map((i) => `• ${i.producto}: $${fmtN(i.costo_mensual_usd)}/mes`);
    out({
      ok: true, codigo: "presupuesto", total: pb.total_usd,
      mensaje: `Presupuesto mensual estimado: $${fmtN(pb.total_usd)}${lineas.length ? `\n${lineas.join("\n")}` : ""}`,
    });
  }

  // ── consumo directo ──
  {
    const mCons = nq.match(/^(?:gaste|consumi|use)\s+(.+)$/);
    if (mCons) {
      const it = parsearItem(mCons[1]);
      if (!it) out({ ok: false, codigo: "ambiguo", pregunta: "¿Qué consumiste y cuánto? Ej. «gasté 1L de leche».", detalle: "no se pudo parsear el consumo" });
      const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
      const prod = matchProducto(inv, it.nombre);
      if (!prod) out({ ok: false, codigo: "producto_no_encontrado", pregunta: `No encontré "${it.nombre}" en el inventario.`, detalle: "producto inexistente" });
      const r = await rpc("rpc_mer_movimiento", {
        p_user_id: cfg.USER_ID, p_producto_id: prod.id, p_tipo: "consumo",
        p_cantidad: it.cantidad, p_nota: "consumo por WhatsApp",
      });
      out({ ok: true, codigo: "consumo", mensaje: `Consumo registrado: ${fmtN(it.cantidad)} ${prod.unidad} de ${r.producto}.` });
    }
  }

  // ── se acabó ──
  {
    const mFin = nq.match(/^se\s+acab[óo]\s+(?:el|la|los|las)?\s*(.+)$/);
    if (mFin) {
      const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
      const prod = matchProducto(inv, mFin[1].trim());
      if (!prod) out({ ok: false, codigo: "producto_no_encontrado", pregunta: `No encontré "${mFin[1].trim()}" en el inventario.`, detalle: "producto inexistente" });
      if (!prod.stock || prod.stock <= 0) {
        out({ ok: true, codigo: "sin_stock", mensaje: `${prod.nombre} ya está en cero.` });
      }
      await rpc("rpc_mer_movimiento", {
        p_user_id: cfg.USER_ID, p_producto_id: prod.id, p_tipo: "consumo",
        p_cantidad: prod.stock, p_nota: "se acabó (WhatsApp)",
      });
      out({ ok: true, codigo: "agotado", mensaje: `${prod.nombre} marcado como agotado (stock a 0).` });
    }
  }

  // ── se dañó ──
  {
    const mDan = nq.match(/^se\s+da[nñ][oó]\s+(.+)$/);
    if (mDan) {
      const it = parsearItem(mDan[1]);
      if (!it) out({ ok: false, codigo: "ambiguo", pregunta: "¿Qué se dañó y cuánto? Ej. «se dañó 1kg de arroz».", detalle: "no se pudo parsear" });
      const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
      const prod = matchProducto(inv, it.nombre);
      if (!prod) out({ ok: false, codigo: "producto_no_encontrado", pregunta: `No encontré "${it.nombre}" en el inventario.`, detalle: "producto inexistente" });
      await rpc("rpc_mer_movimiento", {
        p_user_id: cfg.USER_ID, p_producto_id: prod.id, p_tipo: "danado",
        p_cantidad: it.cantidad, p_nota: "se dañó (WhatsApp)",
      });
      out({ ok: true, codigo: "danado", mensaje: `Registrado: se dañaron ${fmtN(it.cantidad)} ${prod.unidad} de ${prod.nombre}. No afecta el historial de precios.` });
    }
  }

  // ── precio de X ──
  {
    const mPr = nq.match(/^(?:precio|costo|cuesta|cu[aá]nto cuesta|a ?como est[aá]|en cuanto est[aá])\s+(?:el|la|los|las|de)?\s*(.+)$/);
    if (mPr && !/factura|compr[eé]/.test(nq)) {
      const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
      const prod = matchProducto(inv, mPr[1].trim());
      if (!prod) {
        out({ ok: false, codigo: "producto_no_encontrado", pregunta: `No encontré "${mPr[1].trim()}" en el inventario.`, detalle: "producto inexistente" });
      }
      if (prod.precio_usd_unitario === null || prod.precio_usd_unitario === undefined) {
        out({ ok: true, codigo: "precio", mensaje: `${prod.nombre}: sin compras registradas todavía.` });
      }
      const rango = (prod.precio_min_usd !== null && prod.precio_max_usd !== null && prod.precio_min_usd !== prod.precio_max_usd)
        ? ` (rango $${fmtN(prod.precio_min_usd)}–$${fmtN(prod.precio_max_usd)})` : "";
      const variacion = (prod.variacion_pct !== null && prod.variacion_pct !== undefined && prod.variacion_pct !== 0)
        ? ` ${prod.variacion_pct > 0 ? "▲" : "▼"}${Math.abs(prod.variacion_pct)}% vs prom.` : "";
      out({
        ok: true, codigo: "precio",
        mensaje: `${prod.nombre}: $${fmtN(prod.precio_usd_unitario)}/${prod.unidad}${rango}${variacion}` +
          (prod.ultimo_comercio ? ` · últ. en ${prod.ultimo_comercio}` : ""),
      });
    }
  }

  // ── factura / compré → RESUMEN (nunca se ejecuta directo) ──
  const esFactura = /^(factura|compre|compra)\b/.test(nq);
  if (esFactura) {
    let cuerpo = q.replace(/^(factura|compr[ée]|compra)\b[:,]?\s*/i, "").trim();
    // Comercio al final: "en Makro".
    let comercio = null;
    const mCom = cuerpo.match(/\ben\s+([a-záéíóúñü]{2,}(?:\s+[a-záéíóúñü]{2,})?)\s*$/i);
    if (mCom && !/\d/.test(mCom[1])) { comercio = mCom[1].trim(); cuerpo = cuerpo.slice(0, mCom.index).trim(); }
    const chunks = dividirItems(cuerpo);
    if (!chunks.length) {
      out({ ok: false, codigo: "ambiguo", pregunta: "¿Qué compraste? Ej. «factura 2kg arroz 8$, 1L leche 150bs en Makro».", detalle: "sin artículos" });
    }
    const items = [];
    for (const ch of chunks) {
      const it = parsearItem(ch, ch);
      if (!it) {
        out({ ok: false, codigo: "ambiguo", pregunta: `No entendí "${ch}". Usa el formato «2kg arroz 8$».`, detalle: "artículo sin parsear" });
      }
      if (!it.precio) {
        out({ ok: false, codigo: "ambiguo", pregunta: `¿En cuánto salió "${it.nombre}"?`, detalle: "artículo sin precio" });
      }
      it.moneda = it.moneda ?? detectarMonedaChunk(ch) ?? "VES";
      items.push(it);
    }

    const inventario = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
    const saldos = await rpc("rpc_fin_saldos", { p_user_id: cfg.USER_ID });
    const cuentas = saldos.map((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda }));

    for (const it of items) {
      const prod = matchProducto(inventario, it.nombre);
      if (prod) {
        it.producto_id = prod.id;
        it.nombre = prod.nombre; // nombre canónico
        it.unidad = prod.unidad; // la unidad del producto manda
      } else {
        it.nuevo = true;
      }
    }

    // Cuenta mencionada o pregunta (nunca se adivina).
    const mc = matchCuenta(cuentas, q);
    let cuentaId = null, preguntaCuenta = null;
    if (mc.length === 1) cuentaId = mc[0].id;
    else if (mc.length > 1) {
      preguntaCuenta = `¿Con qué cuenta lo pago? ${mc.map((c) => c.nombre).join(", ")}.`;
    } else if (cuentas.length === 1) cuentaId = cuentas[0].id;
    else if (cuentas.length > 1) {
      preguntaCuenta = `¿Con qué cuenta lo pago? ${cuentas.map((c) => `${c.nombre} (${c.moneda})`).join(", ")}.`;
    }

    const nuevosSinCategoria = items.filter((it) => it.nuevo);
    const lineas = items.map((it) =>
      `• ${fmtN(it.cantidad)} ${it.unidad} ${it.nombre} — ${fmtPrecio(it.precio, it.moneda)}${it.nuevo ? " (nuevo)" : ""}`);
    const porMoneda = {};
    for (const it of items) porMoneda[it.moneda] = (porMoneda[it.moneda] ?? 0) + it.precio;
    const totales = Object.entries(porMoneda).map(([m, t]) => fmtPrecio(t, m)).join(" + ");

    const preguntas = [];
    if (preguntaCuenta) preguntas.push(preguntaCuenta);
    for (const it of nuevosSinCategoria) preguntas.push(`"${it.nombre}" es nuevo: ¿en qué categoría va? (ej. granos, lacteos, limpieza)`);

    const mensaje =
      `Resumen de factura${comercio ? ` — ${comercio}` : ""} (${items.length} artículo${items.length === 1 ? "" : "s"}):\n` +
      `${lineas.join("\n")}\nTotal: ${totales}` +
      (preguntas.length ? `\n\n${preguntas.join("\n")}` : "") +
      `\n\n¿Lo confirmas?`;

    out({
      ok: true, codigo: "resumen_factura",
      items, comercio, cuenta_id: cuentaId, totales_por_moneda: porMoneda,
      confirmar_con: {
        items: items.map((it) => ({
          nombre: it.nombre, cantidad: it.cantidad, unidad: it.unidad,
          precio: it.precio, moneda: it.moneda,
          producto_id: it.producto_id ?? null, categoria: null,
        })),
        cuenta: cuentaId,
        comercio,
      },
      mensaje,
    });
  }

  out({ ok: false, codigo: "sin-match", detalle: `no entendí "${q}". Escribe "mercado ayuda" para ver los comandos.` });
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes("producto_no_encontrado")) {
    out({ ok: false, codigo: "producto_no_encontrado", detalle: "No encontré ese producto en el inventario." });
  }
  out({ ok: false, codigo: "error", detalle: msg.slice(0, 300) });
}
