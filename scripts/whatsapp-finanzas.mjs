#!/usr/bin/env node
// Módulo Finanzas por WhatsApp — STUB (Fase 0.6).
// La Fase 1 implementará aquí: registrar gasto/ingreso, consultar saldo,
// programar recordatorio de pago, etc. El router lo invoca como:
//   node scripts/whatsapp-finanzas.mjs --q "<texto sin el prefijo>"
// Contrato: siempre JSON a stdout.
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
const q = String(args.q ?? "").trim();
console.log(JSON.stringify({
  ok: false,
  codigo: "proximamente",
  modulo: "finanzas",
  detalle: "El módulo de Finanzas llega en la Fase 1. Tu mensaje quedó así: " +
    (q ? `"${q.slice(0, 140)}"` : "(vacío)") + ". Por ahora no se registró nada.",
}));
process.exit(1);
