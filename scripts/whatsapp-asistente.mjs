#!/usr/bin/env node
// Asistente conversacional de Hábitos por WhatsApp.
//
//   node scripts/whatsapp-asistente.mjs --intencion registrar --q "tomé agua" [--dry-run]
//   node scripts/whatsapp-asistente.mjs --intencion crear --q "créame un hábito de leer 20 minutos en las noches" [--dry-run]
//   node scripts/whatsapp-asistente.mjs --intencion estado
//   node scripts/whatsapp-asistente.mjs --intencion resumen [--dias 7]
//   node scripts/whatsapp-asistente.mjs --intencion racha --q "leer"
//
// Imprime JSON a stdout para que el agente redacte la respuesta.
// "registrar" delega en whatsapp-registrar.mjs (sin tocarlo); el resto usa whatsapp-comun.mjs.

// ── 0. Forzar zona horaria de luigi ──
import { spawnSync } from "node:child_process";
if (process.env.TZ !== "America/Caracas") {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, TZ: "America/Caracas" },
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  root, cargarConfig, crearRpc, cargarLib, norm, expandir, matchHabito,
  cargarEstado, aplicaHoy, uid, DIAS_ES,
} from "./whatsapp-comun.mjs";

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
const fail = (codigo, detalle, extra = {}) => out({ ok: false, codigo, detalle, ...extra });
const intencion = args.intencion || args.i;
if (!intencion) fail("args", 'se requiere --intencion registrar|crear|estado|resumen|racha');

// ── registrar: delega en el puente existente (no se modifica) ────────────────
if (intencion === "registrar") {
  const passthrough = [];
  for (const k of ["q", "habit", "moment", "fecha", "dry-run", "user-id"]) {
    if (args[k] !== undefined) passthrough.push(`--${k}`, ...(args[k] === true ? [] : [String(args[k])]));
  }
  try {
    const res = execFileSync(process.execPath, [join(root, "scripts", "whatsapp-registrar.mjs"), ...passthrough], { encoding: "utf8" });
    process.stdout.write(res);
    process.exit(0);
  } catch (e) {
    process.stdout.write(e.stdout || "");
    process.exit(e.status ?? 1);
  }
}

// ── Parser de creación en lenguaje natural ───────────────────────────────────
const PALETA = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f43f5e", "#84cc16"];
const UNIDADES = { vasos: "vasos", vaso: "vasos", litros: "litros", litro: "litros", paginas: "páginas", página: "páginas", minutos: "minutos", minuto: "minutos", veces: "veces", vez: "veces", tazas: "tazas", taza: "tazas", pasos: "pasos", km: "km", kms: "km", kilometros: "km" };
const CATEGORIAS = [
  [/agua|beber|tomar|desayun|comer|dormir|ejercicio|entrenar|correr|trotar|caminar|yoga|estirar|vitamina|medic/i, "salud"],
  [/leer|estudiar|curso|aprender|idioma|escribir/i, "crecimiento"],
  [/meditar|respirar|agradecer|diario|orar|calma/i, "bienestar"],
  [/trabajar|enfocar|correo|reunion|llamada|proyecto|inbox/i, "productividad"],
  [/familia|amigos|mama|papa|hijo|pareja|llamar/i, "personal"],
];
const DIAS_MAP = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

function parsearCreacion(qRaw) {
  let resto = String(qRaw || "").trim();
  resto = resto.replace(/^(cr[eé]a(?:me)?|agrega|a[ñn]ade|pon(?:me)?|quiero|nuevo)\b\s*(un\s+)?(h[aá]bito\s*(de|:)?)?\s*/i, "");
  resto = resto.replace(/^h[aá]bito\s*(de|:)?\s*/i, "");
  const original = resto;

  // Cantidad: "8 vasos", "20 minutos"
  let tipo = "momento", objetivo = 1, unidad;
  const mCant = resto.match(/(\d+)\s*(vasos?|litros?|p[aá]ginas?|minutos?|kms?|kil[oó]metros?|veces?|tazas?|pasos?)\b/i);
  if (mCant) {
    tipo = "cantidad";
    objetivo = parseInt(mCant[1], 10);
    unidad = UNIDADES[norm(mCant[2])] || norm(mCant[2]);
  }

  // Hora: "a las 7", "19:00", "7pm", "7 de la noche"
  let hora = null;
  const mHora = resto.match(/(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (mHora && !mCant) {
    let h = parseInt(mHora[1], 10);
    const min = mHora[2] || "00";
    const ap = (mHora[3] || "").replace(/\./g, "").toLowerCase();
    const noche = /de la noche/i.test(resto);
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && noche && h <= 12) h += 12;
    if (h >= 0 && h <= 23) hora = `${String(h).padStart(2, "0")}:${min}`;
  }

  // Ventana del día
  let ventana = "cualquier";
  if (/\bmañana\b/i.test(resto)) ventana = "manana";
  else if (/\btarde\b/i.test(resto)) ventana = "tarde";
  else if (/\bnoches?\b/i.test(resto)) ventana = "noche";

  // Días
  let dias = [0, 1, 2, 3, 4, 5, 6];
  let diasTexto = "todos los días";
  if (/lunes a viernes/i.test(resto)) { dias = [1, 2, 3, 4, 5]; diasTexto = "lunes a viernes"; }
  else if (/fines?\s+de\s+semana/i.test(resto)) { dias = [0, 6]; diasTexto = "fines de semana"; }
  else {
    const mencionados = Object.keys(DIAS_MAP).filter((d) => new RegExp(`\\b${d}\\b`, "i").test(expandir(resto)));
    if (mencionados.length > 0) { dias = mencionados.map((d) => DIAS_MAP[d]).sort(); diasTexto = mencionados.join(", "); }
  }

  // Nombre: quitar los fragmentos ya interpretados
  let nombre = resto;
  for (const m of [mCant?.[0], mHora && !mCant ? mHora[0] : null]) if (m) nombre = nombre.replace(m, " ");
  nombre = nombre.replace(/\b(mañana|tardes?|noches?)\b/gi, " ");
  nombre = nombre.replace(/\b(lunes a viernes|fines?\s+de\s+semana|todos los d[ií]as|a diario|diarios?|al d[ií]a|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/gi, " ");
  nombre = nombre.replace(/\b(en|de|del|la|las|el|los|por|para|un|una|al)\b/gi, " ");
  nombre = nombre.replace(/[.,;:!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (!nombre) return { error: "falta-nombre", detalle: `no pude extraer el nombre del hábito de "${original}"` };
  nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);

  const categoria = (CATEGORIAS.find(([re]) => re.test(nombre)) || [])[1] || "otro";
  const color = PALETA[[...nombre].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETA.length];

  return {
    nombre, tipo, objetivo, unidad, categoria, color, dias, diasTexto, ventana, hora,
    momentos: hora
      ? [{ id: uid(), tipo: "hora", hora }]
      : [{ id: uid(), tipo: "ventana", ventana }],
  };
}

// ── Intenciones ──────────────────────────────────────────────────────────────
const main = async () => {
  if (intencion === "crear") {
    if (!args.q) fail("args", 'crear requiere --q "descripción del hábito"');
    const p = parsearCreacion(args.q);
    if (p.error) { fail(p.error, p.detalle); return; }
    const cfg = cargarConfig(args);
    const rpc = crearRpc(cfg);
    const ahora = new Date().toISOString();
    const habit = {
      id: uid(), nombre: p.nombre, descripcion: "", icono: "", color: p.color,
      categoria: p.categoria, dias: p.dias, objetivo: p.objetivo,
      ...(p.unidad ? { unidad: p.unidad } : {}),
      momentos: p.momentos, estado: "activo", creadoEn: ahora, actualizadoEn: ahora, tipo: p.tipo,
    };
    if (!args["dry-run"]) {
      await rpc("rpc_habitos_upsert", { p_user_id: cfg.USER_ID, p_id: habit.id, p_data: habit });
    }
    out({
      ok: true, intencion: "crear", dryRun: !!args["dry-run"],
      habito: {
        nombre: p.nombre, tipo: p.tipo, objetivo: p.objetivo, unidad: p.unidad || null,
        momento: p.hora ? `a las ${p.hora}` : { manana: "en la mañana", tarde: "en la tarde", noche: "en la noche", cualquier: "cualquier momento" }[p.ventana],
        dias: p.diasTexto, categoria: p.categoria,
      },
      detalle: `"${p.nombre}" creado: ${p.tipo === "cantidad" ? `${p.objetivo} ${p.unidad || "veces"}/día` : "1 vez/día"}, ${p.diasTexto}`,
    });
    return;
  }

  const cfg = cargarConfig(args);
  const rpc = crearRpc(cfg);
  const lib = cargarLib();
  const { d, g, j } = lib;
  const { habits, completions, juego, hoy } = await cargarEstado(rpc, cfg.USER_ID, lib);
  const nivel = g.nivelEfectivo(juego.xpTotal ?? 0, juego.nivelMaximo ?? 1).nivel;

  if (intencion === "estado") {
    const dow = new Date(`${hoy}T12:00:00`).getDay();
    const deHoy = habits.filter((h) => aplicaHoy(h, hoy));
    const filas = deHoy.map((h) => {
      const hechos = d.completadosPara(h, hoy, completions).size;
      const objetivo = g.objetivoEnFecha(h, hoy);
      return { nombre: h.nombre, hechos, objetivo, completo: hechos >= objetivo };
    });
    const puntosHoy = g.puntosTotalesParaFecha(habits, hoy, completions, nivel);
    const pendientes = filas.filter((f) => !f.completo);
    out({
      ok: true, intencion: "estado", fecha: hoy, dia: DIAS_ES[dow],
      puntosHoy,
      habitos: filas,
      resumen: `${filas.filter((f) => f.completo).length}/${filas.length} hábitos completos`,
      pendientes: pendientes.map((f) => `${f.nombre} (${f.hechos}/${f.objetivo})`),
    });
    return;
  }

  if (intencion === "resumen") {
    const n = Math.max(1, Math.min(60, parseInt(args.dias || "7", 10) || 7));
    const diasArr = [];
    for (let i = n - 1; i >= 0; i--) {
      const fecha = d.todayKey(d.addDays(new Date(`${hoy}T12:00:00`), -i));
      const registros = completions.filter((c) => c.fecha === fecha).length;
      const puntos = g.puntosTotalesParaFecha(habits, fecha, completions, nivel);
      diasArr.push({ fecha, dia: DIAS_ES[new Date(`${fecha}T12:00:00`).getDay()], registros, puntos });
    }
    const totalPuntos = diasArr.reduce((a, x) => a + x.puntos, 0);
    const totalRegistros = diasArr.reduce((a, x) => a + x.registros, 0);
    const mejor = [...diasArr].sort((a, b) => b.puntos - a.puntos)[0];
    out({
      ok: true, intencion: "resumen", dias: n, desde: diasArr[0].fecha, hasta: hoy,
      totalPuntos, totalRegistros,
      promedioDiario: Math.round(totalPuntos / n),
      mejorDia: mejor.puntos > 0 ? `${mejor.dia} (${mejor.puntos} pts)` : "ninguno",
      xpSemanal: juego.xpSemanal || 0,
      detalle: diasArr,
    });
    return;
  }

  if (intencion === "racha") {
    if (!args.q) fail("args", 'racha requiere --q "nombre del hábito"');
    if (habits.length === 0) fail("sin-habitos", "el RPC no devolvió hábitos");
    const rank = matchHabito(habits, args.q);
    if (rank.length === 0) { fail("sin-match", `ningún hábito activo matchea "${args.q}"`); return; }
    if (rank.length > 1 && rank[0].score === rank[1].score) {
      out({ ok: false, codigo: "ambiguo", detalle: `varios hábitos matchean "${args.q}"`, candidatos: rank.slice(0, 4).map((x) => x.h.nombre) });
      return;
    }
    const h = rank[0].h;
    const racha = g.rachaActual(h, hoy, completions, juego.diasProtegidos || []);
    const maxima = juego.rachaMaxima?.[h.id] ?? racha;
    out({ ok: true, intencion: "racha", habito: h.nombre, racha, rachaMaxima: maxima });
    return;
  }

  fail("args", `intención desconocida: ${intencion}`);
};

main().catch((err) => fail("excepcion", String((err && err.message) || err).slice(0, 500)));
