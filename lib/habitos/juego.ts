// lib/habitos/juego.ts — Orquestación de los sistemas de juego.
//
// gamificacion.ts contiene la matemática pura; aquí vive el "cuándo":
// qué pasa en el estado cuando el usuario registra un cumplimiento, cómo se
// reconcilian los datos históricos al cargar y cómo se fusiona el progreso
// entre dispositivos. Todo sigue siendo puro (sin I/O): el contexto decide
// cuándo persistir y sincronizar.

import type { AppState, Habit, JuegoState, MarcaSueno, MovimientoXp } from "./types";
import type { NivelActual } from "./gamificacion";
import { completadosPara, esDescanso, inicioSemana, moverFecha, todayKey } from "./dates";
import {
  PUNTOS_OBJETIVO_DIARIO,
  PUNTOS_POR_REGISTRO,
  MAX_CONGELADORES,
  SUENO_FALLO_XP,
  asegurarDesafios,
  congeladorAutomatico,
  diaCompleto,
  diasCumplidosEnSemana,
  logrosNuevos,
  LOGROS,
  mensajeSueno,
  nivelEfectivo,
  nivelParaXp,
  objetivoEnFecha,
  rachaActual,
  tirarCofre,
  xpPorDesafio,
  xpPorRegistro,
  xpSuenoDeEvento,
} from "./gamificacion";

/* ------------------------------ Estado inicial -------------------------- */

export function juegoInicial(): JuegoState {
  return {
    xpTotal: 0,
    xpSemanal: 0,
    semanaXp: inicioSemana(todayKey()),
    nivelMaximo: 1,
    congeladores: 0,
    diasProtegidos: [],
    logros: [],
    logrosReclamados: [],
    ultimoCofre: null,
    cofres: 0,
    desafios: [],
    rachaMaxima: {},
    rachaPremiada: {},
    madrugadas: 0,
    diasCompletos: 0,
    nombreLiga: "",
    suenoFallos: [],
    historialXp: [],
    actualizadoEn: new Date(0).toISOString(),
  };
}

/** Backfill defensivo: datos viejos en localStorage pueden no traer `juego`. */
export function normalizarJuego(value: unknown): JuegoState {
  const base = juegoInicial();
  if (!value || typeof value !== "object") return base;
  const p = value as Partial<JuegoState>;
  // Migración: sin nivelMaximo previo se toma el nivel por XP actual (no se
  // puede recuperar historial perdido por penalizaciones viejas).
  const nivelMigrado =
    typeof p.nivelMaximo === "number" && p.nivelMaximo >= 1 && p.nivelMaximo <= 9
      ? Math.floor(p.nivelMaximo)
      : nivelParaXp(typeof p.xpTotal === "number" ? p.xpTotal : 0).nivel;
  return {
    ...base,
    ...p,
    nivelMaximo: nivelMigrado,
    diasProtegidos: Array.isArray(p.diasProtegidos) ? p.diasProtegidos : [],
    logros: Array.isArray(p.logros) ? p.logros : [],
    // Migración: los logros desbloqueados antes del reclamo por tap ya
    // tenían su XP acreditado, así que nacen marcados como reclamados.
    logrosReclamados: Array.isArray(p.logrosReclamados) ? p.logrosReclamados : Array.isArray(p.logros) ? [...p.logros] : [],
    desafios: Array.isArray(p.desafios) ? p.desafios : [],
    rachaMaxima: p.rachaMaxima && typeof p.rachaMaxima === "object" ? p.rachaMaxima : {},
    rachaPremiada: p.rachaPremiada && typeof p.rachaPremiada === "object" ? p.rachaPremiada : {},
    suenoFallos: Array.isArray(p.suenoFallos) ? p.suenoFallos.filter((x): x is string => typeof x === "string") : [],
    historialXp: normalizarHistorialXp(p.historialXp),
  };
}

/** Tope de movimientos guardados: el historial es una ventana, no un ledger infinito. */
export const TOPE_HISTORIAL_XP = 200;

function esMovimientoXp(x: unknown): x is MovimientoXp {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.ts === "number" &&
    typeof m.fecha === "string" &&
    typeof m.delta === "number" &&
    typeof m.motivo === "string" &&
    typeof m.detalle === "string"
  );
}

export function normalizarHistorialXp(value: unknown): MovimientoXp[] {
  if (!Array.isArray(value)) return [];
  const vistos = new Set<string>();
  const out: MovimientoXp[] = [];
  for (const x of value) {
    if (!esMovimientoXp(x) || vistos.has(x.id)) continue;
    vistos.add(x.id);
    out.push({ id: x.id, ts: x.ts, fecha: x.fecha, delta: x.delta, motivo: x.motivo, detalle: x.detalle });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, TOPE_HISTORIAL_XP);
}

/**
 * Añade movimientos al historial con idempotencia por id (un reintento o la
 * llegada del mismo evento desde otro dispositivo no duplica). Ordenado del
 * más reciente al más antiguo, con tope.
 */
export function conMovimientosXp(juego: JuegoState, movs: MovimientoXp[]): JuegoState {
  if (movs.length === 0) return juego;
  return { ...juego, historialXp: normalizarHistorialXp([...movs, ...juego.historialXp]) };
}

/** Totales del historial: cuánto XP se ha ganado y cuánto se ha perdido. */
export function totalesHistorialXp(juego: JuegoState | undefined): { ganado: number; perdido: number } {
  const h = normalizarJuego(juego).historialXp;
  let ganado = 0;
  let perdido = 0;
  for (const m of h) {
    if (m.delta > 0) ganado += m.delta;
    else perdido += -m.delta;
  }
  return { ganado, perdido };
}

/* ------------------------------ Eventos de UI --------------------------- */

export type TipoEventoJuego =
  | "subida-nivel"
  | "logro"
  | "cofre"
  | "desafio"
  | "congelador-ganado"
  | "congelador-usado"
  | "sueno"
  | "recordatorio-ancla";

export interface EventoJuego {
  tipo: TipoEventoJuego;
  titulo: string;
  detalle: string;
  /** Id del logro (solo para tipo "logro"). */
  dato?: string;
}

type Oyente = (evento: EventoJuego) => void;
const oyentes = new Set<Oyente>();

/** La home se suscribe para mostrar celebraciones; el contexto emite. */
export function suscribirEventosJuego(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function emitirEventosJuego(eventos: EventoJuego[]): void {
  for (const e of eventos) {
    for (const o of [...oyentes]) o(e);
  }
}

/* --------------------------- Aplicar recompensas ------------------------ */

interface RegistroCtx {
  habitId: string;
  /** Fecha del registro (normalmente hoy). */
  fecha: string;
  timestamp: string;
  /** Id del evento de cumplimiento (para ids deterministas del historial). */
  eventId?: string;
  /** XP base personalizado (sueño: por puntualidad, puede ser negativo). */
  xpBase?: number;
  /** Minutos de retraso vs la hora objetivo (solo sueño, para el mensaje). */
  retrasoMin?: number;
  /** Qué marca de sueño fue ("levantar" | "acostar"). */
  cualSueno?: MarcaSueno;
}

/**
 * Aplica toda la capa de juego después de un registro exitoso.
 * Recibe el estado ANTES y DESPUÉS de registrarCumplimiento para detectar qué
 * se completó con este tap (objetivo del día, día completo, etc.).
 * Puro: devuelve el estado nuevo + eventos para celebrar en la UI.
 */
export function aplicarRecompensas(
  antes: AppState,
  despues: AppState,
  ctx: RegistroCtx,
): { state: AppState; eventos: EventoJuego[] } {
  const { habitId, fecha, timestamp } = ctx;
  const habit = despues.habits.find((h) => h.id === habitId);
  if (!habit) return { state: despues, eventos: [] };

  const eventos: EventoJuego[] = [];
  let juego: JuegoState = normalizarJuego(despues.juego);
  const hoy = fecha;
  const nivelAntes = nivelEfectivo(juego.xpTotal, juego.nivelMaximo).nivel;

  // 1. La semana de XP rueda los lunes.
  const semana = inicioSemana(hoy);
  if (juego.semanaXp !== semana) {
    juego = { ...juego, semanaXp: semana, xpSemanal: 0 };
  }

  // 2. XP base del registro (+ bonus si con este tap se cumplió el objetivo).
  // El XP base escala con el nivel efectivo (10–18). Sueño: el XP base viene
  // por puntualidad (puede ser negativo) y NO lleva el bonus de objetivo
  // diario: el acuerdo es solo el XP por puntualidad.
  let xpGanado = ctx.xpBase ?? xpPorRegistro(nivelAntes);
  const objetivo = objetivoEnFecha(habit, fecha);
  const compAntes = completadosPara(habit, fecha, antes.completions).size;
  const compDespues = completadosPara(habit, fecha, despues.completions).size;
  const cruzoObjetivo = habit.tipo !== "sueno" && compAntes < objetivo && compDespues >= objetivo;
  if (cruzoObjetivo) {
    xpGanado += PUNTOS_OBJETIVO_DIARIO;
  }

  // Historial de XP: cada fuente de XP deja su movimiento con motivo.
  const tsMov = new Date(timestamp).getTime();
  // El id lleva el timestamp: una corrección de sueño re-registra el mismo
  // eventId con otra hora y debe quedar como movimiento aparte (no pisar el
  // original); el deshacer previo ya dejó su movimiento "revertido".
  const idReg = `reg:${ctx.eventId ?? `${habitId}|${fecha}|${timestamp}`}:${tsMov}`;
  const movs: MovimientoXp[] = [];
  const baseRegistro = ctx.xpBase ?? xpPorRegistro(nivelAntes);
  if (baseRegistro !== 0) {
    movs.push({
      id: idReg,
      ts: tsMov,
      fecha: hoy,
      delta: baseRegistro,
      motivo: habit.tipo === "sueno" ? "sueno" : "registro",
      detalle:
        habit.tipo === "sueno" && ctx.cualSueno
          ? `${ctx.cualSueno === "levantar" ? "Me levanté" : "Me acosté"} · ${habit.nombre}`
          : habit.nombre,
    });
  }
  if (cruzoObjetivo) {
    movs.push({
      id: `obj:${idReg}`,
      ts: tsMov,
      fecha: hoy,
      delta: PUNTOS_OBJETIVO_DIARIO,
      motivo: "objetivo",
      detalle: habit.nombre,
    });
  }

  // 2b. Sueño: evento inmediato con el resultado (va primero en la cola).
  if (habit.tipo === "sueno" && ctx.xpBase !== undefined && ctx.cualSueno) {
    const xp = ctx.xpBase;
    eventos.unshift({
      tipo: "sueno",
      titulo: xp >= 0 ? `+${xp} XP` : `${xp} XP`,
      detalle: mensajeSueno(ctx.cualSueno, xp, ctx.retrasoMin ?? 0),
      dato: ctx.cualSueno,
    });
  }

  // 3. Madrugador: registrar antes de las 8:00 a. m.
  if (new Date(timestamp).getHours() < 8) {
    juego = { ...juego, madrugadas: juego.madrugadas + 1 };
  }

  // 4. Racha máxima histórica + congelador cada 7 días de racha.
  const racha = rachaActual(habit, hoy, despues.completions, juego.diasProtegidos, undefined, despues.habits);
  const rachaMaxPrev = juego.rachaMaxima[habitId] ?? 0;
  if (racha > rachaMaxPrev) {
    juego = { ...juego, rachaMaxima: { ...juego.rachaMaxima, [habitId]: racha } };
  }
  if (
    racha > 0 &&
    racha % 7 === 0 &&
    (juego.rachaPremiada[habitId] ?? 0) < racha &&
    juego.congeladores < MAX_CONGELADORES
  ) {
    juego = {
      ...juego,
      congeladores: juego.congeladores + 1,
      rachaPremiada: { ...juego.rachaPremiada, [habitId]: racha },
    };
    eventos.push({
      tipo: "congelador-ganado",
      titulo: "¡Congelador ganado!",
      detalle: "Si un día fallas, tu racha se protege sola.",
    });
  }

  // 5. Auto-proteger días pasados sin actividad (consume congeladores).
  const congAntes = juego.congeladores;
  juego = congeladorAutomatico(juego, despues.habits, despues.completions, hoy);
  if (juego.congeladores < congAntes) {
    eventos.push({
      tipo: "congelador-usado",
      titulo: "Congelador usado",
      detalle: "Un día sin registros quedó protegido. Tu racha sigue viva.",
    });
  }

  // 6. Desafíos de la semana: generar si toca y evaluar progreso.
  juego = asegurarDesafios(juego, despues.habits, despues.completions, semana, hoy);
  {
    let desafios = juego.desafios;
    let hubo = false;
    desafios = desafios.map((d) => {
      if (d.semana !== semana || d.completado) return d;
      const h = despues.habits.find((x) => x.id === d.habitId);
      if (!h) return d;
      const prog = diasCumplidosEnSemana(h, semana, hoy, despues.completions, juego.diasProtegidos);
      if (prog >= d.meta) {
        hubo = true;
        const xpDesafio = xpPorDesafio(d.meta);
        xpGanado += xpDesafio;
        movs.push({
          id: `desafio:${d.id}`,
          ts: tsMov,
          fecha: hoy,
          delta: xpDesafio,
          motivo: "desafio",
          detalle: `${h.nombre}: ${d.meta} días esta semana`,
        });
        eventos.push({
          tipo: "desafio",
          titulo: "¡Desafío completado!",
          detalle: `${h.nombre}: ${d.meta} días esta semana (+${xpDesafio} XP).`,
        });
        return { ...d, completado: true };
      }
      return d;
    });
    if (hubo) juego = { ...juego, desafios };
  }

  // 7. Día completo → cofre sorpresa (una vez por fecha).
  if (diaCompleto(despues.habits, fecha, despues.completions, juego.diasProtegidos) && juego.ultimoCofre !== fecha) {
    const premio = tirarCofre(juego.congeladores, nivelAntes);
    juego = {
      ...juego,
      diasCompletos: juego.diasCompletos + 1,
      ultimoCofre: fecha,
      cofres: juego.cofres + 1,
      congeladores: premio.congelador ? juego.congeladores + 1 : juego.congeladores,
    };
    xpGanado += premio.xp;
    if (premio.xp > 0) {
      movs.push({
        id: `cofre:${fecha}`,
        ts: tsMov,
        fecha: hoy,
        delta: premio.xp,
        motivo: "cofre",
        detalle: "Día completo",
      });
    }
    eventos.push({
      tipo: "cofre",
      titulo: "¡Cofre del día!",
      detalle: premio.congelador
        ? "Día completo: ganaste un congelador de racha."
        : `Día completo: bonus sorpresa de +${premio.xp} XP.`,
      dato: premio.congelador ? "congelador" : `xp:${premio.xp}`,
    });
  }

  // 8. Aplicar el XP ganado. El sueño puede restar: el total nunca baja de 0.
  juego = {
    ...juego,
    xpTotal: Math.max(0, juego.xpTotal + xpGanado),
    xpSemanal: Math.max(0, juego.xpSemanal + xpGanado),
  };
  juego = conMovimientosXp(juego, movs);

  // 9. Logros recién desbloqueados. El XP NO se acredita solo: el usuario
  // lo reclama tocando el logro en su sala de trofeos.
  for (const id of logrosNuevos({ juego, habits: despues.habits, completions: despues.completions, hoy })) {
    juego = { ...juego, logros: [...juego.logros, id] };
    const def = LOGROS.find((l) => l.id === id);
    if (def) {
      eventos.push({
        tipo: "logro",
        titulo: `¡Logro: ${def.nombre}!`,
        detalle: `Tócalo en tu sala de trofeos para reclamar +${def.xp} XP · ${def.mensaje}`,
        dato: id,
      });
    }
  }

  // 10. ¿Subió de nivel? El nivel efectivo nunca baja: se guarda el máximo
  // alcanzado y solo se celebra cuando ese máximo crece.
  const nivelMaximo = Math.max(juego.nivelMaximo, nivelParaXp(juego.xpTotal).nivel);
  juego = { ...juego, nivelMaximo };
  const nivelDespues = nivelEfectivo(juego.xpTotal, nivelMaximo);
  if (nivelDespues.nivel > nivelAntes) {
    eventos.push({
      tipo: "subida-nivel",
      titulo: `¡Nivel ${nivelDespues.nivel}: ${nivelDespues.nombre}!`,
      detalle: "Tu constancia está dando frutos.",
      dato: String(nivelDespues.nivel),
    });
  }

  juego = { ...juego, actualizadoEn: new Date().toISOString() };
  return { state: { ...despues, juego }, eventos };
}

/**
 * Reclama el premio de XP de un logro desbloqueado (tap en la sala de
 * trofeos). El XP se otorga UNA sola vez: si el logro no está desbloqueado
 * o ya fue reclamado, no hace nada. El reclamo suma al XP de por vida pero
 * NO al semanal: la liga mide actividad reciente, no trofeos viejos.
 */
export function reclamarLogro(
  state: AppState,
  logroId: string,
): { state: AppState; xpGanado: number; subioNivel: NivelActual | null } {
  const juego = normalizarJuego(state.juego);
  const def = LOGROS.find((l) => l.id === logroId);
  if (!def || !juego.logros.includes(logroId) || juego.logrosReclamados.includes(logroId)) {
    return { state, xpGanado: 0, subioNivel: null };
  }
  const nivelAntes = nivelEfectivo(juego.xpTotal, juego.nivelMaximo).nivel;
  const xpTotal = juego.xpTotal + def.xp;
  const nivelMaximo = Math.max(juego.nivelMaximo, nivelParaXp(xpTotal).nivel);
  const ahora = new Date();
  const juego2: JuegoState = conMovimientosXp(
    {
      ...juego,
      logrosReclamados: [...juego.logrosReclamados, logroId],
      xpTotal,
      nivelMaximo,
      actualizadoEn: ahora.toISOString(),
    },
    [
      {
        id: `logro:${logroId}`,
        ts: ahora.getTime(),
        fecha: todayKey(),
        delta: def.xp,
        motivo: "logro",
        detalle: def.nombre,
      },
    ],
  );
  const nivelDespues = nivelEfectivo(xpTotal, nivelMaximo);
  return {
    state: { ...state, juego: juego2 },
    xpGanado: def.xp,
    subioNivel: nivelDespues.nivel > nivelAntes ? nivelDespues : null,
  };
}

/** Cuántos logros desbloqueados tienen su premio pendiente de reclamo. */
export function premiosPendientes(juego: JuegoState | undefined): number {
  const j = normalizarJuego(juego);
  return j.logros.filter((id) => !j.logrosReclamados.includes(id)).length;
}

/* ------------------------- Reconciliación al cargar ---------------------- */

/**
 * Backfill idempotente al cargar el estado (local o tras rehidratar):
 * - XP histórico si nunca se calculó (usuarios existentes).
 * - Rodaje de la semana de XP.
 * - Racha máxima por hábito.
 * - Congelador automático por días pasados sin abrir la app.
 * - Desafíos de la semana vigente.
 * - Logros (en silencio: sin eventos de celebración en la carga).
 *
 * Devuelve el MISMO objeto si no hubo cambios (evita renders inútiles).
 */
export function reconciliarJuego(state: AppState): AppState {
  const hoy = todayKey();
  const semana = inicioSemana(hoy);
  let juego = normalizarJuego(state.juego);
  let cambió = false;
  const marcar = (): void => {
    cambió = true;
  };

  // XP histórico: base por registro (escalada por nivel) + 5 por cada
  // día-hábito con objetivo cumplido. Dos pasadas: la primera con base 10
  // estima el nivel, la segunda reescala con ese nivel (aproximación
  // documentada: el nivel real de cada registro histórico no se guarda).
  if (juego.xpTotal === 0 && state.completions.length > 0) {
    const calcular = (nivel: number): { xp: number; xpSem: number } => {
      let xp = 0;
      let xpSem = 0;
      const porDia = new Map<string, { habit: Habit; ids: Set<string> }>();
      for (const c of state.completions) {
        const habit = state.habits.find((h) => h.id === c.habitId);
        if (!habit) continue;
        // Sueño: el XP histórico respeta la puntualidad (puede ser negativo).
        const pts = habit.tipo === "sueno" ? xpSuenoDeEvento(habit, c) : xpPorRegistro(nivel);
        xp += pts;
        if (c.fecha >= semana) xpSem += pts;
        const key = `${c.habitId}|${c.fecha}`;
        let grupo = porDia.get(key);
        if (!grupo) {
          grupo = { habit, ids: new Set() };
          porDia.set(key, grupo);
        }
        grupo.ids.add(habit.tipo === "cantidad" ? c.eventId : (c.momentId ?? c.eventId));
      }
      for (const [key, grupo] of porDia) {
        const fecha = key.split("|").slice(-1)[0];
        if (grupo.ids.size >= objetivoEnFecha(grupo.habit, fecha)) {
          xp += PUNTOS_OBJETIVO_DIARIO;
          if (fecha >= semana) xpSem += PUNTOS_OBJETIVO_DIARIO;
        }
      }
      return { xp, xpSem };
    };
    const plano = calcular(1);
    const nivelEst = nivelParaXp(plano.xp).nivel;
    const { xp, xpSem } = nivelEst > 1 ? calcular(nivelEst) : plano;
    juego = { ...juego, xpTotal: Math.max(0, xp), xpSemanal: Math.max(0, xpSem), semanaXp: semana };
    // El pasado anterior al historial queda como una única entrada estimada.
    juego = conMovimientosXp(juego, [
      {
        id: "backfill",
        ts: 1,
        fecha: "1970-01-01",
        delta: Math.max(0, Math.round(xp)),
        motivo: "historial",
        detalle: "XP acumulado antes del historial (estimado)",
      },
    ]);
    marcar();
  }

  if (juego.semanaXp !== semana) {
    juego = { ...juego, semanaXp: semana, xpSemanal: 0 };
    marcar();
  }

  // Sueño: −10 XP por marca olvidada (una sola vez por marca+fecha, en
  // silencio). Solo se revisa lo más reciente —ayer (levantar) y la
  // ante-noche (acostar)—: sin castigos acumulados por días sin abrir la app,
  // y nunca antes de que el hábito existiera.
  for (const h of state.habits) {
    if (h.tipo !== "sueno" || h.estado !== "activo") continue;
    const creado = (h.creadoEn ?? "").slice(0, 10);
    const pendientes: { cual: MarcaSueno; fecha: string }[] = [
      { cual: "levantar", fecha: moverFecha(hoy, -1) },
      { cual: "acostar", fecha: moverFecha(hoy, -2) },
    ];
    for (const { cual, fecha } of pendientes) {
      const clave = `${cual}|${fecha}`;
      if (juego.suenoFallos.includes(clave)) continue;
      if (creado && fecha < creado) continue;
      if (esDescanso(h, fecha)) continue;
      const marcada = state.completions.some(
        (c) => c.habitId === h.id && c.momentId === cual && c.fecha === fecha,
      );
      if (marcada) continue;
      juego = {
        ...juego,
        suenoFallos: [...juego.suenoFallos, clave].sort(),
        xpTotal: Math.max(0, juego.xpTotal + SUENO_FALLO_XP),
        xpSemanal:
          inicioSemana(fecha) === juego.semanaXp
            ? Math.max(0, juego.xpSemanal + SUENO_FALLO_XP)
            : juego.xpSemanal,
      };
      juego = conMovimientosXp(juego, [
        {
          id: `fallo:${clave}`,
          ts: Date.parse(`${fecha}T12:00:00`),
          fecha,
          delta: SUENO_FALLO_XP,
          motivo: "sueno-olvido",
          detalle: `${cual === "levantar" ? "Me levanté" : "Me acosté"} sin marcar`,
        },
      ]);
      marcar();
    }
  }

  // Siembra: fallos de sueño antiguos (anteriores al historial) también
  // aparecen como movimientos; la idempotencia por id evita duplicarlos.
  {
    const semilla: MovimientoXp[] = juego.suenoFallos
      .filter((clave) => !juego.historialXp.some((m) => m.id === `fallo:${clave}`))
      .map((clave) => {
        const [cual, fecha] = clave.split("|");
        return {
          id: `fallo:${clave}`,
          ts: Date.parse(`${fecha}T12:00:00`),
          fecha,
          delta: SUENO_FALLO_XP,
          motivo: "sueno-olvido" as const,
          detalle: `${cual === "levantar" ? "Me levanté" : "Me acosté"} sin marcar`,
        };
      });
    if (semilla.length > 0) {
      juego = conMovimientosXp(juego, semilla);
      marcar();
    }
  }

  for (const h of state.habits) {
    const r = rachaActual(h, hoy, state.completions, juego.diasProtegidos, undefined, state.habits);
    if ((juego.rachaMaxima[h.id] ?? 0) < r) {
      juego = { ...juego, rachaMaxima: { ...juego.rachaMaxima, [h.id]: r } };
      marcar();
    }
  }

  {
    const j2 = congeladorAutomatico(juego, state.habits, state.completions, hoy);
    if (j2 !== juego) {
      juego = j2;
      marcar();
    }
  }

  {
    const j3 = asegurarDesafios(juego, state.habits, state.completions, semana, hoy);
    if (j3 !== juego) {
      juego = j3;
      marcar();
    }
  }

  {
    const nuevos = logrosNuevos({ juego, habits: state.habits, completions: state.completions, hoy });
    if (nuevos.length > 0) {
      // Se desbloquean en silencio; su XP queda pendiente de reclamo por tap.
      juego = { ...juego, logros: [...juego.logros, ...nuevos] };
      marcar();
    }
  }

  // El nivel máximo nunca baja aunque el XP total haya retrocedido.
  {
    const porXp = nivelParaXp(juego.xpTotal).nivel;
    if (juego.nivelMaximo < porXp) {
      juego = { ...juego, nivelMaximo: porXp };
      marcar();
    }
  }

  if (!cambió) return state;
  return { ...state, juego: { ...juego, actualizadoEn: new Date().toISOString() } };
}

/* ------------------------- Fusión entre dispositivos --------------------- */

/**
 * Merge de game_state entre dispositivos. Todo es monótono: contadores por
 * máximo, colecciones por unión. Converge sin conflictos ni pérdida de
 * progreso (el XP ganado en otro dispositivo no se pierde).
 */
export function fusionarJuego(local: JuegoState, remoto: JuegoState | null): JuegoState {
  const a = normalizarJuego(local);
  if (!remoto) return a;
  const b = normalizarJuego(remoto);
  const semana = inicioSemana(todayKey());

  const maxRecord = (x: Record<string, number>, y: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  const union = (x: string[], y: string[]): string[] => [...new Set([...x, ...y])].sort();
  const unionDesafios = (): typeof a.desafios => {
    const porId = new Map(a.desafios.map((d) => [d.id, d]));
    for (const d of b.desafios) {
      const prev = porId.get(d.id);
      porId.set(d.id, prev ? { ...d, completado: prev.completado || d.completado } : d);
    }
    return [...porId.values()];
  };

  // xpSemanal solo vale si pertenece a la semana en curso.
  const xpSemanal =
    a.semanaXp === semana && b.semanaXp === semana
      ? Math.max(a.xpSemanal, b.xpSemanal)
      : a.semanaXp === semana
        ? a.xpSemanal
        : b.semanaXp === semana
          ? b.xpSemanal
          : 0;

  return {
    xpTotal: Math.max(a.xpTotal, b.xpTotal),
    xpSemanal,
    semanaXp: semana,
    nivelMaximo: Math.max(a.nivelMaximo, b.nivelMaximo),
    congeladores: Math.max(a.congeladores, b.congeladores),
    diasProtegidos: union(a.diasProtegidos, b.diasProtegidos),
    logros: union(a.logros, b.logros),
    logrosReclamados: union(a.logrosReclamados, b.logrosReclamados),
    suenoFallos: union(a.suenoFallos, b.suenoFallos),
    historialXp: normalizarHistorialXp([...a.historialXp, ...b.historialXp]),
    ultimoCofre: a.ultimoCofre && b.ultimoCofre
      ? (a.ultimoCofre > b.ultimoCofre ? a.ultimoCofre : b.ultimoCofre)
      : (a.ultimoCofre ?? b.ultimoCofre),
    cofres: Math.max(a.cofres, b.cofres),
    desafios: unionDesafios(),
    rachaMaxima: maxRecord(a.rachaMaxima, b.rachaMaxima),
    rachaPremiada: maxRecord(a.rachaPremiada, b.rachaPremiada),
    madrugadas: Math.max(a.madrugadas, b.madrugadas),
    diasCompletos: Math.max(a.diasCompletos, b.diasCompletos),
    nombreLiga: a.nombreLiga || b.nombreLiga,
    actualizadoEn: new Date().toISOString(),
  };
}
