#!/usr/bin/env node
// Módulo Mercado por WhatsApp — STUB (Fase 0.6).
// La Fase 2 implementará aquí: registrar compra/consumo, factura con
// resumen+confirmación (REGLA: nunca registrar directo una factura),
// lista de compras, etc. El router lo invoca como:
//   node scripts/whatsapp-mercado.mjs --q "<texto sin el prefijo>"
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
  modulo: "mercado",
  detalle: "El módulo de Mercado llega en la Fase 2. Tu mensaje quedó así: " +
    (q ? `"${q.slice(0, 140)}"` : "(vacío)") + ". Por ahora no se registró nada.",
}));
process.exit(1);
