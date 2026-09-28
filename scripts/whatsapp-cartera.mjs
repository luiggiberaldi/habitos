#!/usr/bin/env node
// Módulo Cartera por WhatsApp (Fase 6.3): catálogo de productos + clientes con cartera.
//
//   node scripts/whatsapp-cartera.mjs --q "<texto sin el prefijo>"
//   Prefijos en el router: cartera | cliente(s) | producto(s)
//
// Contrato: siempre JSON a stdout. El agente responde SOLO desde el JSON:
//   ok:true                    → confirmar con `mensaje`
//   ok:false + codigo:pregunta → preguntar con `pregunta`
//   ok:false + codigo:resumen  → mostrar `resumen` tal cual y esperar "sí"
//                                (el campo `espera_confirmacion` es true)
//   ok:false                   → decir lo que indica `detalle`
//
// Un solo borrador activo por usuario, persistido en
// ~/.config/habitos/cartera-borrador.json. Nada se crea ni se registra sin
// resumen + "sí" explícito (guardarraíl #1 de Cartera). La confirmación es
// idempotente: antes del RPC el borrador pasa a fase "ejecutando".
//
// Intenciones:
//   "producto añadir queso blanco 5 dolares kg lacteos" → borrador producto
//   "productos" / "productos queso"                    → listar catálogo
//   "cliente añadir Ana Pérez" / "cliente añadir Ana proveedor" → borrador
//   "clientes"                                         → listar con saldos
//   "cartera"                                          → resumen de saldos
//   "cartera Ana"                                      → detalle de Ana
//   "cargo Ana 100 dolares venta de queso"             → borrador cargo
//   "abono Ana 40"                                     → borrador abono
//   "cancelar"                                         → descarta el borrador
//   "ayuda"                                            → ayuda
//
// NOTA PARA EL AGENTE DEL CHAT: después de un `resumen`, el usuario responde
// "sí" SIN prefijo (el router lo mandaría a hábitos). Si hay un borrador
// pendiente para ese usuario, ese "sí" debe enrutarse aquí:
//   node scripts/whatsapp-cartera.mjs --q "sí"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cargarConfig, norm, root } from "./whatsapp-comun.mjs";

const HOME = process.env.HOME || "/home/hatch";

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
if (!q) out({ ok: false, codigo: "args", detalle: "se requiere --q \"<texto>\"" });

let cfg;
try {
  cfg = cargarConfig(args);
} catch (e) {
  out({ ok: false, codigo: "config", detalle: String(e.message || e) });
}

function crearRpcCartera(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) {
      if (fn === "rpc_car_cliente_listar") return [
        { id: "c1", nombre: "Ana Pérez", tipo: "cliente", telefono: null, email: null, notas: null, activo: true, saldos: [{ moneda: "USD", saldo: 60 }] },
        { id: "c2", nombre: "Bodega Cheo", tipo: "proveedor", telefono: null, email: null, notas: null, activo: true, saldos: [{ moneda: "USD", saldo: -25 }] },
      ];
      if (fn === "rpc_car_cartera") return {
        ok: true,
        cliente: { id: "c1", nombre: "Ana Pérez", tipo: "cliente", telefono: null, email: null, activo: true },
        saldos: [{ moneda: "USD", cargos: 100, abonos: 40, saldo: 60 }],
        movimientos: [
          { id: "m1", tipo: "cargo", concepto: "Venta de queso", monto: 100, moneda: "USD", fecha: "2026-09-27" },
          { id: "m2", tipo: "abono", concepto: "Pago parcial", monto: 40, moneda: "USD", fecha: "2026-09-28" },
        ],
      };
      if (fn === "rpc_cat_producto_listar") return [
        { id: "p1", nombre: "Queso blanco", unidad: "kg", categoria: "Lácteos", precio_venta: 5, moneda: "USD", costo: 3, notas: null, activo: true },
      ];
      if (fn === "rpc_car_cliente_upsert") return { ok: true, id: "c-mock", nuevo: true, nombre: params.p_nombre };
      if (fn === "rpc_cat_producto_upsert") return { ok: true, id: "p-mock", nuevo: true, nombre: params.p_nombre };
      if (fn === "rpc_car_movimiento") return { ok: true, id: "m-mock", cliente: "Ana Pérez", saldo_moneda: 160, moneda: "USD" };
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
const rpc = crearRpcCartera(cfg);

// ── Estado: un borrador activo por usuario ───────────────────────────────────
const ESTADO_PATH = join(HOME, ".config", "habitos", "cartera-borrador.json");
function cargarEstado() {
  try {
    if (!existsSync(ESTADO_PATH)) return {};
    return JSON.parse(readFileSync(ESTADO_PATH, "utf8"));
  } catch {
    return {};
  }
}
function guardarEstadoTodo(estado) {
  mkdirSync(join(HOME, ".config", "habitos"), { recursive: true });
  writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
}
const estadoTodo = cargarEstado();
let miDraft = estadoTodo[cfg.USER_ID] || null;
function guardarDraft(d) {
  if (d) estadoTodo[cfg.USER_ID] = d;
  else delete estadoTodo[cfg.USER_ID];
  guardarEstadoTodo(estadoTodo);
}

// ── Formato ──────────────────────────────────────────────────────────────────
const fmtNum = (n) =>
  new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtMoneda = (monto, moneda) => {
  const n = fmtNum(monto);
  if (moneda === "VES") return `Bs ${n}`;
  if (moneda === "USDT") return `${n} USDT`;
  if (moneda === "COP") return `COP ${n}`;
  return `$ ${n}`;
};
const fmtFecha = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
};
/** "me deben $50,00" / "les debo $30,00" / "en cero" */
function textoSaldo(saldo, moneda) {
  const s = Number(saldo);
  if (s > 0) return `me deben ${fmtMoneda(s, moneda)}`;
  if (s < 0) return `les debo ${fmtMoneda(s, moneda)}`;
  return `en cero en ${moneda}`;
}

// ── Parseo ───────────────────────────────────────────────────────────────────
/** Monto: acepta 1.234,56 (es-VE), 1,234.56 y 1234.56. Devuelve number o null. */
function extraerMonto(texto) {
  const m = texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1];
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}
const montoRaw = (texto) =>
  (texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/) || [])[1] || null;

function detectarMoneda(texto) {
  const n = norm(texto);
  if (/\b(usdt|tether)\b/.test(n)) return "USDT";
  if (/\b(bs|bolivares?|ves)\b/.test(n)) return "VES";
  if (/\b(cop|pesos?)\b/.test(n)) return "COP";
  if (/\$|\b(dolar(es)?|bucks?)\b/.test(n)) return "USD";
  return null;
}

const UNIDADES_RX = /\b(und|unidad(?:es)?|kg|kilos?|g|gramos?|l|litros?|ml|paquete(?:s)?|caja(?:s)?|servicio(?:s)?)\b/i;
function detectarUnidad(texto) {
  const m = norm(texto).match(UNIDADES_RX);
  if (!m) return null;
  const u = m[1].toLowerCase();
  if (/^und|unidad/.test(u)) return "und";
  if (/^kg|kilo/.test(u)) return "kg";
  if (/^g|gramo/.test(u)) return "g";
  if (/^l|litro/.test(u)) return "L";
  if (/^ml/.test(u)) return "ml";
  if (/^paquete/.test(u)) return "paquete";
  if (/^caja/.test(u)) return "caja";
  if (/^servicio/.test(u)) return "servicio";
  return "und";
}

/** Quita el monto y palabras de moneda/unidad ya interpretadas. */
function limpiarResto(texto) {
  return texto
    .replace(montoRaw(texto) || "∅", " ")
    .replace(/\b(usdt|tether|bs|bolivares?|ves|cop|pesos?|dolares?|bucks?)\b/gi, " ")
    .replace(/\$/g, " ")
    .replace(UNIDADES_RX, " ")
    .replace(/\s+/g, " ").trim();
}

/** Match difuso de un nombre contra una lista {id, nombre}. */
function buscarPorNombre(lista, texto) {
  const n = norm(texto);
  if (!n) return [];
  return lista
    .filter((x) => x.activo !== false)
    .map((x) => ({ x, nx: norm(x.nombre) }))
    .filter(({ nx }) => nx && (n.includes(nx) || nx.includes(n)))
    .sort((a, b) => b.nx.length - a.nx.length)
    .map(({ x }) => x);
}

// ── Principal ────────────────────────────────────────────────────────────────
const nq = norm(q);

try {
  // ── ayuda ──
  if (/^ayuda$/.test(nq)) {
    out({
      ok: true, codigo: "ayuda",
      mensaje: [
        "Cartera por WhatsApp:",
        "• «producto añadir queso blanco 5 dolares kg» → agrega al catálogo",
        "• «productos» → ver el catálogo",
        "• «cliente añadir Ana Pérez» → registra un cliente",
        "• «clientes» → clientes con sus saldos",
        "• «cartera» → resumen de cuánto te deben / debes",
        "• «cartera Ana» → detalle de su cartera",
        "• «cargo Ana 100 dolares venta de queso» → le cargas (te debe)",
        "• «abono Ana 40» → registra su pago",
        "• «cancelar» → descarta el borrador",
        "Nada se guarda sin tu «sí» después del resumen.",
      ].join("\n"),
    });
  }

  // ── cancelar ──
  if (/^cancelar$/.test(nq)) {
    guardarDraft(null);
    out({ ok: true, codigo: "cancelado", mensaje: "Borrador descartado." });
  }

  // ── confirmar lo pendiente ──
  const esConfirmacion = /^(si|confirmo|confirmar|dale|crealo|ok|de una|hazlo|va)$/.test(nq);
  if (esConfirmacion) {
    if (!miDraft || miDraft.fase !== "resumen") {
      out({ ok: false, codigo: "sin-pendiente", detalle: "No hay nada pendiente de confirmación." });
    }
    if (miDraft.fase === "ejecutando") {
      out({ ok: false, codigo: "en-curso", detalle: "Ya se está procesando, dame un momento." });
    }
    miDraft.fase = "ejecutando";
    guardarDraft(miDraft);
    try {
      if (miDraft.tipo === "producto") {
        const p = miDraft.producto;
        const r = await rpc("rpc_cat_producto_upsert", {
          p_user_id: cfg.USER_ID, p_nombre: p.nombre, p_unidad: p.unidad,
          p_categoria: p.categoria, p_precio_venta: p.precio, p_moneda: p.moneda,
          p_costo: null, p_notas: null, p_hogar_id: null,
        });
        guardarDraft(null);
        out({
          ok: true, codigo: "producto_creado",
          mensaje: `${r.nuevo ? "Producto agregado" : "Producto actualizado"}: ${r.nombre} — ${fmtMoneda(p.precio, p.moneda)} (${p.unidad}).`,
        });
      }
      if (miDraft.tipo === "cliente") {
        const c = miDraft.cliente;
        const r = await rpc("rpc_car_cliente_upsert", {
          p_user_id: cfg.USER_ID, p_nombre: c.nombre, p_tipo: c.tipo,
          p_telefono: null, p_email: null, p_notas: null, p_hogar_id: null,
        });
        guardarDraft(null);
        const tipoTxt = c.tipo === "proveedor" ? "proveedor" : c.tipo === "ambos" ? "cliente/proveedor" : "cliente";
        out({
          ok: true, codigo: "cliente_creado",
          mensaje: `${r.nuevo ? "Cliente agregado" : "Cliente actualizado"}: ${r.nombre} (${tipoTxt}).`,
        });
      }
      if (miDraft.tipo === "movimiento") {
        const mv = miDraft.movimiento;
        const r = await rpc("rpc_car_movimiento", {
          p_user_id: cfg.USER_ID, p_cliente_id: mv.clienteId, p_tipo: mv.tipo,
          p_concepto: mv.concepto, p_monto: mv.monto, p_moneda: mv.moneda,
          p_fecha: null, p_recibo_id: null,
        });
        guardarDraft(null);
        const verbo = mv.tipo === "cargo" ? "Cargo registrado" : "Abono registrado";
        out({
          ok: true, codigo: "movimiento_registrado",
          mensaje: `${verbo}: ${fmtMoneda(mv.monto, mv.moneda)} ${mv.tipo === "cargo" ? "a" : "de"} ${r.cliente} (${mv.concepto}). Ahora ${textoSaldo(r.saldo_moneda, mv.moneda)}.`,
        });
      }
      throw new Error("borrador_desconocido");
    } catch (e) {
      if (e.message === "borrador_desconocido") throw e;
      miDraft.fase = "resumen";
      guardarDraft(miDraft);
      throw e;
    }
  }

  // Si hay un borrador en fase "completar", esta entrada continúa la conversación.
  // (Por ahora solo el borrador de producto/cliente pide datos por texto libre.)

  // ── producto añadir (antes del listado: "queso 5 dolares" es añadir) ──
  {
    const mAdd = q.match(/^(?:producto\s+)?(a[nñ]adir|agregar|nuevo)\s+([\s\S]+)$/i);
    let restoProd = mAdd ? mAdd[2].replace(/^producto\s+/i, "").trim() : null;
    if (!restoProd && extraerMonto(q) !== null && !/^(cargo|cargar|abono|abonar|cartera|clientes?|productos?|resumen|ayuda|cancelar|si)\b/.test(nq)) {
      restoProd = q; // "queso 5 dolares" (sin palabra clave) → añadir producto
    }
    if (restoProd) {
      const precio = extraerMonto(restoProd);
      if (precio === null) {
        out({ ok: false, codigo: "pregunta", pregunta: "¿A qué precio lo vendes? Ej. «producto añadir queso blanco 5 dolares».", detalle: "falta el precio" });
      }
      const moneda = detectarMoneda(restoProd) || "USD";
      const unidad = detectarUnidad(restoProd) || "und";
      let categoria = "General";
      const mc = restoProd.match(/categor[ií]a\s+([\p{L}\s]+)/iu);
      if (mc) categoria = mc[1].trim().replace(/\s+/g, " ");
      let nombre = limpiarResto(restoProd).replace(/categor[ií]a\s+[\p{L}\s]+/iu, "").trim();
      if (!nombre) {
        out({ ok: false, codigo: "pregunta", pregunta: "¿Cómo se llama el producto? Ej. «producto añadir queso blanco 5 dolares».", detalle: "falta el nombre" });
      }
      nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
      const draft = {
        tipo: "producto", fase: "resumen",
        producto: { nombre, precio, moneda, unidad, categoria },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          "Agregar al catálogo:",
          `Producto: ${nombre}`,
          `Precio: ${fmtMoneda(precio, moneda)} · Unidad: ${unidad} · Categoría: ${categoria}`,
          "",
          '¿Lo guardo? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  // ── productos: listar ──
  {
    const m = nq.match(/^(productos?|catalogo)(\s+(.+))?$/);
    if (m) {
      const filtro = (m[3] || "").trim();
      const lista = await rpc("rpc_cat_producto_listar", { p_user_id: cfg.USER_ID, p_solo_activos: true });
      const items = filtro ? buscarPorNombre(lista, filtro) : lista;
      if (!items.length) {
        out({ ok: false, codigo: "sin-productos", detalle: filtro ? `No hay productos que coincidan con «${filtro}».` : "El catálogo está vacío. Agrégalo con «producto añadir nombre precio»." });
      }
      const lineas = items.slice(0, 20).map((p) => `• ${p.nombre} — ${fmtMoneda(p.precio_venta, p.moneda)} (${p.unidad})`);
      out({
        ok: true, codigo: "productos",
        mensaje: [`Catálogo (${items.length}):`, ...lineas].join("\n"),
      });
    }
  }

  // ── clientes: listar ──
  {
    const m = nq.match(/^clientes(\s+(.+))?$/);
    if (m) {
      const filtro = (m[2] || "").trim();
      const lista = await rpc("rpc_car_cliente_listar", { p_user_id: cfg.USER_ID });
      const items = filtro ? buscarPorNombre(lista, filtro) : lista.filter((c) => c.activo);
      if (!items.length) {
        out({ ok: false, codigo: "sin-clientes", detalle: filtro ? `No hay clientes que coincidan con «${filtro}».` : "Aún no tienes clientes. Agrégalos con «cliente añadir nombre»." });
      }
      const lineas = items.slice(0, 20).map((c) => {
        const saldos = (c.saldos || []).filter((s) => Number(s.saldo) !== 0);
        const txt = saldos.length ? saldos.map((s) => textoSaldo(s.saldo, s.moneda)).join(" · ") : "en cero";
        return `• ${c.nombre}: ${txt}`;
      });
      out({ ok: true, codigo: "clientes", mensaje: [`Clientes (${items.length}):`, ...lineas].join("\n") });
    }
  }

  // ── cliente añadir ──
  {
    const m = q.match(/^cliente\s+([\s\S]+)$/i);
    if (m) {
      let resto = m[1].trim().replace(/^(a[nñ]adir|agregar|nuevo)\s+/i, "").trim();
      let tipo = "cliente";
      if (/\bproveedor\b/i.test(resto)) { tipo = "proveedor"; resto = resto.replace(/\bproveedor\b/i, "").trim(); }
      else if (/\bambos\b/i.test(resto)) { tipo = "ambos"; resto = resto.replace(/\bambos\b/i, "").trim(); }
      else resto = resto.replace(/\bcliente\b/i, "").trim();
      const nombre = resto.replace(/\s+/g, " ").trim();
      if (!nombre) {
        out({ ok: false, codigo: "pregunta", pregunta: "¿Cómo se llama el cliente? Ej. «cliente añadir Ana Pérez».", detalle: "falta el nombre" });
      }
      const draft = {
        tipo: "cliente", fase: "resumen",
        cliente: { nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), tipo },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      const tipoTxt = tipo === "proveedor" ? "Proveedor (le debo)" : tipo === "ambos" ? "Cliente y proveedor" : "Cliente (me debe)";
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          "Agregar cliente:",
          `Nombre: ${draft.cliente.nombre}`,
          `Tipo: ${tipoTxt}`,
          "",
          '¿Lo guardo? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  // ── cartera: resumen / detalle ──
  {
    const m = nq.match(/^cartera(\s+(.+))?$/);
    if (m) {
      const filtro = (m[2] || "").trim();
      if (!filtro) {
        const r = await rpc("rpc_car_cartera", { p_user_id: cfg.USER_ID, p_cliente_id: null, p_limite_movimientos: 1 });
        const clientes = r.clientes || [];
        const conSaldo = clientes.filter((c) => (c.saldos || []).some((s) => Number(s.saldo) !== 0));
        if (!conSaldo.length) {
          out({ ok: true, codigo: "cartera_vacia", mensaje: "Tu cartera está en cero: nadie te debe y no debes nada." });
        }
        const porMoneda = {};
        for (const c of conSaldo) {
          for (const s of c.saldos || []) {
            const v = Number(s.saldo);
            if (!v) continue;
            porMoneda[s.moneda] = porMoneda[s.moneda] || { meDeben: 0, lesDebo: 0 };
            if (v > 0) porMoneda[s.moneda].meDeben += v;
            else porMoneda[s.moneda].lesDebo += -v;
          }
        }
        const lineas = Object.entries(porMoneda).map(([mon, t]) => {
          const partes = [];
          if (t.meDeben > 0) partes.push(`te deben ${fmtMoneda(t.meDeben, mon)}`);
          if (t.lesDebo > 0) partes.push(`debes ${fmtMoneda(t.lesDebo, mon)}`);
          return `• ${mon}: ${partes.join(" · ")}`;
        });
        const detalle = conSaldo.slice(0, 15).map((c) => {
          const txt = (c.saldos || []).filter((s) => Number(s.saldo) !== 0).map((s) => textoSaldo(s.saldo, s.moneda)).join(" · ");
          return `• ${c.nombre}: ${txt}`;
        });
        out({
          ok: true, codigo: "cartera_resumen",
          mensaje: ["Resumen de cartera:", ...lineas, "", ...detalle].join("\n"),
        });
      }
      // Detalle de un cliente
      const lista = await rpc("rpc_car_cliente_listar", { p_user_id: cfg.USER_ID });
      const cands = buscarPorNombre(lista, filtro);
      if (!cands.length) {
        out({ ok: false, codigo: "no-encontrado", detalle: `No encontré ningún cliente con «${filtro}».` });
      }
      if (cands.length > 1) {
        out({
          ok: false, codigo: "pregunta",
          pregunta: `¿Cuál de estos?\n${cands.slice(0, 5).map((c) => `• ${c.nombre}`).join("\n")}`,
          opciones: cands.slice(0, 5).map((c) => c.nombre),
          detalle: "cliente ambiguo",
        });
      }
      const det = await rpc("rpc_car_cartera", { p_user_id: cfg.USER_ID, p_cliente_id: cands[0].id, p_limite_movimientos: 10 });
      const l = [
        `Cartera de ${det.cliente.nombre}:`,
        ...(det.saldos.length
          ? det.saldos.map((s) => `• ${s.moneda}: cargos ${fmtMoneda(s.cargos, s.moneda)} · abonos ${fmtMoneda(s.abonos, s.moneda)} → ${textoSaldo(s.saldo, s.moneda)}`)
          : ["Sin movimientos todavía."]),
      ];
      if (det.movimientos.length) {
        l.push("", "Últimos movimientos:");
        for (const mv of det.movimientos.slice(0, 8)) {
          l.push(`• ${mv.tipo === "cargo" ? "+" : "−"}${fmtMoneda(mv.monto, mv.moneda)} — ${mv.concepto} (${fmtFecha(mv.fecha)})`);
        }
      }
      out({ ok: true, codigo: "cartera_detalle", mensaje: l.join("\n") });
    }
  }

  // ── cargo / abono ──
  {
    const m = nq.match(/^(cargo|cargar|abono|abonar)\b([\s\S]*)$/);
    if (m) {
      const tipo = /^(cargo|cargar)/.test(m[1]) ? "cargo" : "abono";
      const resto = (m[2] || "").trim();
      const monto = extraerMonto(q);
      if (monto === null) {
        out({ ok: false, codigo: "pregunta", pregunta: `¿Cuánto ${tipo === "cargo" ? "le cargas" : "abona"}? Ej. «${tipo} Ana 100 dolares venta de queso».`, detalle: "falta el monto" });
      }
      const moneda = detectarMoneda(q) || "USD";
      const lista = await rpc("rpc_car_cliente_listar", { p_user_id: cfg.USER_ID });
      // Quita monto/moneda del texto para buscar el nombre
      const paraNombre = limpiarResto(resto.replace(/^(cargo|cargar|abono|abonar)\b/i, "").trim());
      let cands = buscarPorNombre(lista, paraNombre);
      if (!cands.length) {
        // Intento 2: las primeras palabras podrían ser el nombre
        const palabras = paraNombre.split(/\s+/).slice(0, 2).join(" ");
        cands = buscarPorNombre(lista, palabras);
      }
      if (!cands.length) {
        const nombres = lista.filter((c) => c.activo).slice(0, 8).map((c) => c.nombre);
        out({
          ok: false, codigo: "pregunta",
          pregunta: `¿A qué cliente ${tipo === "cargo" ? "le cargo" : "le abono"} ${fmtMoneda(monto, moneda)}?${nombres.length ? `\n${nombres.map((x) => `• ${x}`).join("\n")}` : ""}`,
          opciones: nombres,
          detalle: "no se identificó el cliente",
        });
      }
      if (cands.length > 1) {
        out({
          ok: false, codigo: "pregunta",
          pregunta: `¿Cuál de estos?\n${cands.slice(0, 5).map((c) => `• ${c.nombre}`).join("\n")}`,
          opciones: cands.slice(0, 5).map((c) => c.nombre),
          detalle: "cliente ambiguo",
        });
      }
      const cliente = cands[0];
      // Concepto: lo que queda tras quitar el nombre del cliente
      let concepto = paraNombre;
      const nx = norm(cliente.nombre);
      const idx = norm(concepto).indexOf(nx);
      if (idx >= 0) concepto = (concepto.slice(0, idx) + concepto.slice(idx + cliente.nombre.length)).replace(/\s+/g, " ").trim();
      if (!concepto) concepto = tipo === "cargo" ? "Cargo" : "Abono";
      const draft = {
        tipo: "movimiento", fase: "resumen",
        movimiento: { clienteId: cliente.id, clienteNombre: cliente.nombre, tipo, concepto, monto, moneda },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      const verbo = tipo === "cargo" ? "Cargar a" : "Abonar a";
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          `${verbo} ${cliente.nombre}:`,
          `${tipo === "cargo" ? "Cargo (me debe)" : "Abono (paga)"}: ${fmtMoneda(monto, moneda)}`,
          `Concepto: ${concepto}`,
          "",
          '¿Lo registro? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  out({
    ok: false, codigo: "sin-match",
    detalle: "No entendí. Prueba «cartera ayuda» para ver qué puedo hacer.",
  });
} catch (e) {
  const msg = String(e.message || e);
  const codigo =
    msg.includes("no_autorizado") ? "no_autorizado" :
    msg.includes("moneda_invalida") ? "moneda_invalida" :
    msg.includes("cliente_no_encontrado") ? "no-encontrado" :
    "error";
  out({ ok: false, codigo, detalle: msg.slice(0, 300) });
}
