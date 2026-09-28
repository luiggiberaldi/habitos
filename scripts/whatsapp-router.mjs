#!/usr/bin/env node
// Router de WhatsApp por módulo (Fase 0.6).
//
//   node scripts/whatsapp-router.mjs --q "<texto crudo del mensaje>"
//
// Detecta el módulo por prefijo y delega al script del módulo:
//   "finanzas ..." / "fin ..."   → scripts/whatsapp-finanzas.mjs
//   "recibo ..."  / "recibos ..." → scripts/whatsapp-recibos.mjs
//   "mercado ..."  / "merca ..." → scripts/whatsapp-mercado.mjs
//   "cartera" / "cliente(s)" / "producto(s)" → scripts/whatsapp-cartera.mjs
//   (sin prefijo)                → hábitos (comportamiento actual)
//   Tras un `resumen`, el "sí"/"cancelar" sin prefijo se enruta al módulo con
//   borrador pendiente (recibos o cartera, el más reciente).
//
// Imprime el JSON del módulo con `modulo` añadido, para que el agente
// redacte la respuesta. Los módulos corren como subproceso aislado: si
// uno falla, el router responde el error sin caerse.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root, cargarConfig, norm } from "./whatsapp-comun.mjs";

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

const texto = String(args.q ?? "").trim();
if (!texto) out({ ok: false, codigo: "args", modulo: "ninguno", detalle: "se requiere --q \"<texto>\"" });

const PREFIJOS = [
  { modulo: "finanzas", script: "whatsapp-finanzas.mjs", rx: /^(finanzas|fin)\b[\s:,]*/i },
  { modulo: "recibos", script: "whatsapp-recibos.mjs", rx: /^(recibos?)\b[\s:,]*/i },
  { modulo: "mercado", script: "whatsapp-mercado.mjs", rx: /^(mercado|merca)\b[\s:,]*/i },
  { modulo: "control", script: "whatsapp-control.mjs", rx: /^(control|ctrl)\b[\s:,]*/i },
  { modulo: "cartera", script: "whatsapp-cartera.mjs", rx: /^(cartera|clientes?|productos?)\b[\s:,]*/i, pasaKw: true },
];

let modulo = "habitos";
let script = null;
let resto = texto;
let kw = "";
for (const p of PREFIJOS) {
  if (p.rx.test(texto)) {
    modulo = p.modulo;
    script = p.script;
    const mkw = texto.match(p.rx);
    kw = (mkw && mkw[1] ? mkw[1] : "").toLowerCase();
    resto = texto.replace(p.rx, "").trim();
    // "cartera" / "productos" / "clientes" solos: el script necesita la palabra
    // clave para saber qué listar (kw la desambigua).
    if (!resto && p.pasaKw) resto = kw;
    break;
  }
}

// ── Consultas globales (Fase 4): cruzan módulos sin prefijo ──────────────────
// Van antes del fallback de hábitos; los patrones son específicos para no
// robarle intenciones ("cuánto debo", "qué me falta comprar", "cuánto gasté",
// "coach"). Si no matchean, cae al comportamiento actual de hábitos.
if (modulo === "habitos") {
  const g = texto.toLowerCase();
  const esGlobal =
    /cu[aá]nto (debo|deben|me deben|gast[eé])/.test(g) ||
    /qu[eé] (me )?falta comprar/.test(g) ||
    /lista de compras/.test(g) ||
    /^coach\b/.test(g);
  if (esGlobal) {
    modulo = "global";
    script = "whatsapp-global.mjs";
    resto = texto;
  }
}

// ── Continuación de borrador sin prefijo ────────────────────────────────────
// Después de un `resumen`, el usuario responde "sí" SIN prefijo (iría a
// hábitos). Si hay un borrador pendiente (recibos o cartera), ese texto se
// enruta al módulo dueño del borrador más reciente:
//   - fase "resumen": solo palabras de cierre ("sí", "cancelar", ...)
//   - fase "completar" (el módulo pidió un dato): cualquier texto sin prefijo
//     es la respuesta a esa pregunta.
if (modulo === "habitos") {
  let uid = null;
  try { uid = cargarConfig({}).USER_ID; } catch { /* sin config: no se intercepta */ }
  if (uid) {
    const leerDraft = (archivo) => {
      try {
        const p = join(process.env.HOME || "/home/hatch", ".config", "habitos", archivo);
        if (!existsSync(p)) return null;
        const d = JSON.parse(readFileSync(p, "utf8"))[uid];
        return d && (d.fase === "resumen" || d.fase === "completar") ? d : null;
      } catch { return null; }
    };
    const drafts = [
      { modulo: "recibos", script: "whatsapp-recibos.mjs", d: leerDraft("recibo-borrador.json") },
      { modulo: "cartera", script: "whatsapp-cartera.mjs", d: leerDraft("cartera-borrador.json") },
    ]
      .filter((c) => c.d)
      .sort((a, b) => String(b.d.actualizado || "").localeCompare(String(a.d.actualizado || "")));
    const nq0 = norm(texto);
    const esCierre = /^(si|confirmo|confirmar|dale|crealo|ok|de una|hazlo|va|cancelar|cancela|olvida|olvidalo|descarta|no)$/.test(nq0);
    const cand = drafts.find((c) => c.d.fase === "completar") || (esCierre ? drafts.find((c) => c.d.fase === "resumen") : null);
    if (cand) {
      modulo = cand.modulo;
      script = cand.script;
      resto = texto;
      kw = "";
    }
  }
}

// ── Hábitos por defecto: conserva el comportamiento actual ──────────────────
// Comandos explícitos → intencion del asistente; lo demás → registrar.
if (modulo === "habitos") {
  const bajo = texto.toLowerCase();
  let intencion = "registrar";
  if (/^(cr[eé]a(?:me)?|agrega|a[ñn]ade|nuevo h[aá]bito)\b/.test(bajo)) intencion = "crear";
  else if (/^(c[oó]mo voy|estado)\b/.test(bajo)) intencion = "estado";
  else if (/^resumen\b/.test(bajo)) intencion = "resumen";
  else if (/^racha\b/.test(bajo)) intencion = "racha";
  script = "whatsapp-asistente.mjs";
  resto = texto;
  try {
    const res = execFileSync(process.execPath, [join(root, "scripts", script), "--intencion", intencion, "--q", resto], { encoding: "utf8" });
    const obj = JSON.parse(res);
    out({ ...obj, modulo });
  } catch (e) {
    const crudo = e.stdout || "";
    try {
      out({ ...JSON.parse(crudo), modulo });
    } catch {
      out({ ok: false, codigo: "modulo_error", modulo, detalle: crudo.slice(0, 300) || e.message });
    }
  }
}

// ── Módulos finanzas/mercado/control/cartera ────────────────────────────────
if (!resto) {
  out({
    ok: false, codigo: "ayuda", modulo,
    detalle: modulo === "finanzas"
      ? 'Escribe p. ej. "finanzas gasté 5$ en pan" (disponible en Fase 1).'
      : modulo === "recibos"
      ? 'Escribe p. ej. "recibo para Ana: reparación laptop 150" o "recibo ayuda".'
      : modulo === "cartera"
      ? 'Escribe p. ej. "cartera", "clientes", "productos" o "cartera ayuda".'
      : 'Escribe p. ej. "mercado compré 2kg de arroz" (disponible en Fase 2).',
  });
}
try {
  const argv = [join(root, "scripts", script), "--q", resto];
  if (kw) argv.push("--kw", kw);
  const res = execFileSync(process.execPath, argv, { encoding: "utf8" });
  out({ ...JSON.parse(res), modulo });
} catch (e) {
  const crudo = e.stdout || "";
  try {
    out({ ...JSON.parse(crudo), modulo });
  } catch {
    out({ ok: false, codigo: "modulo_error", modulo, detalle: crudo.slice(0, 300) || e.message });
  }
}
