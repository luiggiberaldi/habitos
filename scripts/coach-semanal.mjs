#!/usr/bin/env node
// Coach semanal de Hábitos: analiza los datos reales de Supabase y genera
// 2-3 acciones concretas. Solo lee, nunca escribe.
//
//   node scripts/coach-semanal.mjs [--dias 90] [--texto]
//   --texto: imprime el informe listo para WhatsApp además del JSON.

import { spawnSync } from "node:child_process";
if (process.env.TZ !== "America/Caracas") {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, TZ: "America/Caracas" },
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

import {
  cargarConfig, crearRpc, cargarLib, cargarEstado, aplicaHoy, DIAS_ES,
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

const main = async () => {
  const cfg = cargarConfig(args);
  const rpc = crearRpc(cfg);
  const lib = cargarLib();
  const { d, g } = lib;
  const N = Math.max(30, Math.min(400, parseInt(args.dias || "90", 10) || 90));
  const { habits, completions, juego, hoy } = await cargarEstado(rpc, cfg.USER_ID, lib, N);
  const activos = habits.filter((h) => h.estado === "activo");
  if (activos.length === 0) out({ ok: false, codigo: "sin-habitos", detalle: "no hay hábitos activos" });

  const fechasAtras = (n) => {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) arr.push(d.todayKey(d.addDays(new Date(`${hoy}T12:00:00`), -i)));
    return arr;
  };
  const programado = (h, fecha) => {
    if (h.pospuestoHasta && h.pospuestoHasta > fecha) return false;
    const dow = new Date(`${fecha}T12:00:00`).getDay();
    const base = (h.dias || []).includes(dow) || h.pospuestoHasta === fecha;
    if (!base) return false;
    try { return !d.esDescanso(h, fecha); } catch { return true; }
  };
  const completo = (h, fecha) =>
    d.completadosPara(h, fecha, completions).size >= g.objetivoEnFecha(h, fecha);

  // ── Métricas ─────────────────────────────────────────────────────────────
  const ultimos14 = fechasAtras(14);
  const previos14 = fechasAtras(28).slice(0, 14);

  const tasa = (h, fechas) => {
    const prog = fechas.filter((f) => programado(h, f));
    if (prog.length === 0) return null;
    return Math.round((prog.filter((f) => completo(h, f)).length / prog.length) * 100);
  };

  const porHabito = activos.map((h) => {
    const t14 = tasa(h, ultimos14);
    const tPrev = tasa(h, previos14);
    return {
      nombre: h.nombre, id: h.id,
      tasa14: t14, tasaPrevia: tPrev,
      delta: t14 !== null && tPrev !== null ? t14 - tPrev : null,
      racha: g.rachaActual(h, hoy, completions, juego.diasProtegidos || []),
      rachaMax: juego.rachaMaxima?.[h.id] ?? 0,
    };
  });

  // Día de la semana más flojo / más fuerte (últimas 8 semanas)
  const ultimas8sem = fechasAtras(56);
  const porDiaSem = DIAS_ES.map((nombre, dow) => {
    let prog = 0, ok = 0;
    for (const f of ultimas8sem) {
      if (new Date(`${f}T12:00:00`).getDay() !== dow) continue;
      for (const h of activos) {
        if (!programado(h, f)) continue;
        prog++;
        if (completo(h, f)) ok++;
      }
    }
    return { dia: nombre, tasa: prog > 0 ? Math.round((ok / prog) * 100) : null, muestras: prog };
  }).filter((x) => x.tasa !== null);
  const peorDia = [...porDiaSem].sort((a, b) => a.tasa - b.tasa)[0];
  const mejorDia = [...porDiaSem].sort((a, b) => b.tasa - a.tasa)[0];

  // XP dejado en la mesa (últimos 7 días)
  let xpPerdido = 0, incompletos = 0;
  for (const f of fechasAtras(7)) {
    for (const h of activos) {
      if (!programado(h, f) || completo(h, f)) continue;
      const obj = g.objetivoEnFecha(h, f);
      const hechos = d.completadosPara(h, f, completions).size;
      const proporcion = obj > 0 ? (obj - hechos) / obj : 1;
      xpPerdido += Math.round((obj * 10 + 5) * proporcion);
      incompletos++;
    }
  }

  const puntos7 = ultimos14.slice(7).reduce((a, f) => a + g.puntosTotalesParaFecha(activos, f, completions), 0);
  const puntosPrev7 = ultimos14.slice(0, 7).reduce((a, f) => a + g.puntosTotalesParaFecha(activos, f, completions), 0);

  // ── Acciones (reglas deterministas) ───────────────────────────────────────
  const acciones = [];
  if (peorDia && mejorDia && peorDia.tasa < 60 && mejorDia.tasa - peorDia.tasa >= 30) {
    acciones.push(
      `Los ${peorDia.dia} son tu hueco (${peorDia.tasa}% vs ${mejorDia.tasa}% los ${mejorDia.dia}). ` +
      `Ese día baja la exigencia: mueve el hábito más pesado o acepta un modo liviano.`
    );
  }
  const caidas = porHabito.filter((h) => h.delta !== null && h.delta <= -20).sort((a, b) => a.delta - b.delta);
  if (caidas[0]) {
    acciones.push(
      `"${caidas[0].nombre}" cayó de ${caidas[0].tasaPrevia}% a ${caidas[0].tasa14}% en 14 días. ` +
      `Bájale el objetivo a la mitad por 2 semanas antes de que se muera del todo.`
    );
  }
  const rachaRiesgo = [...porHabito].filter((h) => h.racha >= 5).sort((a, b) => b.racha - a.racha)[0];
  if (rachaRiesgo) {
    const h = activos.find((x) => x.id === rachaRiesgo.id);
    if (h && !completo(h, hoy)) {
      acciones.push(
        `Protege la racha de "${rachaRiesgo.nombre}": ${rachaRiesgo.racha} días seguidos y hoy aún no la marcas. ` +
        `Es tu racha activa más larga.`
      );
    }
  }
  if (xpPerdido >= 100) {
    acciones.push(
      `Dejaste ~${xpPerdido} XP en la mesa esta semana (${incompletos} hábitos incompletos). ` +
      `No es flojera: es el objetivo mal calibrado. Ajusta el que más se repite.`
    );
  }
  if (acciones.length === 0) {
    acciones.push(
      `Semana sólida: ${puntos7} puntos en 7 días` +
      (puntos7 >= puntosPrev7 ? `, mejor que la anterior (${puntosPrev7}).` : `.`) +
      ` Siguiente nivel: sube el objetivo de tu hábito más fácil un 25%.`
    );
  }

  const informe = {
    ok: true,
    periodo: { desde: fechasAtras(14)[0], hasta: hoy },
    habitosActivos: activos.length,
    puntosUltimos7: puntos7,
    puntosPrevios7: puntosPrev7,
    xpPerdido7d: xpPerdido,
    diaMasFlojo: peorDia || null,
    diaMasFuerte: mejorDia || null,
    porHabito,
    acciones: acciones.slice(0, 3),
  };

  if (args.texto) {
    const lineas = [
      `*Coach semanal* (${informe.periodo.desde} → ${hoy})`,
      ``,
      `• Puntos últimos 7 días: ${puntos7} (anteriores: ${puntosPrev7})`,
      peorDia && mejorDia && peorDia.dia !== mejorDia.dia
        ? `• Día más flojo: ${peorDia.dia} (${peorDia.tasa}%) · más fuerte: ${mejorDia.dia} (${mejorDia.tasa}%)`
        : peorDia
          ? `• Regularidad pareja entre días (${peorDia.tasa}%)`
          : `• Sin datos por día todavía`,
      xpPerdido > 0 ? `• XP dejado en la mesa: ~${xpPerdido}` : `• Nada dejado en la mesa esta semana`,
      ``,
      ...informe.acciones.map((a, i) => `${i + 1}. ${a}`),
    ];
    console.log(JSON.stringify({ ...informe, texto: lineas.join("\n") }));
    process.exit(0);
  }
  out(informe);
};

main().catch((err) => out({ ok: false, codigo: "excepcion", detalle: String((err && err.message) || err).slice(0, 500) }));
