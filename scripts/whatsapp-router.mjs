#!/usr/bin/env node
// Router de WhatsApp por módulo (Fase 0.6).
//
//   node scripts/whatsapp-router.mjs --q "<texto crudo del mensaje>"
//
// Detecta el módulo por prefijo y delega al script del módulo:
//   "finanzas ..." / "fin ..."   → scripts/whatsapp-finanzas.mjs
//   "recibo ..."  / "recibos ..." → scripts/whatsapp-recibos.mjs
//   "mercado ..."  / "merca ..." → scripts/whatsapp-mercado.mjs
//   (sin prefijo)                → hábitos (comportamiento actual)
//
// Imprime el JSON del módulo con `modulo` añadido, para que el agente
// redacte la respuesta. Los módulos corren como subproceso aislado: si
// uno falla, el router responde el error sin caerse.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./whatsapp-comun.mjs";

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
];

let modulo = "habitos";
let script = null;
let resto = texto;
for (const p of PREFIJOS) {
  if (p.rx.test(texto)) {
    modulo = p.modulo;
    script = p.script;
    resto = texto.replace(p.rx, "").trim();
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

// ── Módulos finanzas/mercado ───────────────────────────────────────────────
if (!resto) {
  out({
    ok: false, codigo: "ayuda", modulo,
    detalle: modulo === "finanzas"
      ? 'Escribe p. ej. "finanzas gasté 5$ en pan" (disponible en Fase 1).'
      : modulo === "recibos"
      ? 'Escribe p. ej. "recibo para Ana: reparación laptop 150" o "recibo ayuda".'
      : 'Escribe p. ej. "mercado compré 2kg de arroz" (disponible en Fase 2).',
  });
}
try {
  const res = execFileSync(process.execPath, [join(root, "scripts", script), "--q", resto], { encoding: "utf8" });
  out({ ...JSON.parse(res), modulo });
} catch (e) {
  const crudo = e.stdout || "";
  try {
    out({ ...JSON.parse(crudo), modulo });
  } catch {
    out({ ok: false, codigo: "modulo_error", modulo, detalle: crudo.slice(0, 300) || e.message });
  }
}
