// lib/juego.ts — Orquestación de los sistemas de juego.
//
// gamificacion.ts contiene la matemática pura; aquí vive el "cuándo":
// qué pasa en el estado cuando el usuario registra un cumplimiento, cómo se
// reconcilian los datos históricos al cargar y cómo se fusiona el progreso
// entre dispositivos. Todo sigue siendo puro (sin I/O): el contexto decide
// cuándo persistir y sincronizar.

import type { AppState, Habit, JuegoState } from "./types";
import { completadosPara, inicioSemana, todayKey } from "./dates";
import {
  PUNTOS_OBJETIVO_DIARIO,
  PUNTOS_POR_REGISTRO,
  MAX_CONGELADORES,
  XP_DESAFIO,
  asegurarDesafios,
  congeladorAutomatico,
  diaCompleto,
  diasCumplidosEnSemana,
  logrosNuevos,
  LOGROS,
  nivelParaXp,
  objetivoEnFecha,
  rachaActual,
  tirarCofre,
} from "./gamificacion";

/* ------------------------------ Estado inicial -------------------------- */

export function juegoInicial(): JuegoState {
  return {
    xpTotal: 0,
    xpSemanal: 0,
    semanaXp: inicioSemana(todayKey()),
    congeladores: 0,
    diasProtegidos: [],
    logros: [],
    ultimoCofre: null,
    cofres: 0,
    desafios: [],
    rachaMaxima: {},
    rachaPremiada: {},
    madrugadas: 0,
    diasCompletos: 0,
    nombreLiga: "",
    actualizadoEn: new Date(0).toISOString(),
  };
}

/** Backfill defensivo: datos viejos en localStorage pueden no traer `juego`. */
export function normalizarJuego(value: unknown): JuegoState {
  const base = juegoInicial();
  if (!value || typeof value !== "object") return base;
  const p = value as Partial<JuegoState>;
  return {
    ...base,
    ...p,
    diasProtegidos: Array.isArray(p.diasProtegidos) ? p.diasProtegidos : [],
    logros: Array.isArray(p.logros) ? p.logros : [],
    desafios: Array.isArray(p.desafios) ? p.desafios : [],
    rachaMaxima: p.rachaMaxima && typeof p.rachaMaxima === "object" ? p.rachaMaxima : {},
    rachaPremiada: p.rachaPremiada && typeof p.rachaPremiada === "object" ? p.rachaPremiada : {},
  };
}

/* ------------------------------ Eventos de UI --------------------------- */

export type TipoEventoJuego =
  | "subida-nivel"
  | "logro"
  | "cofre"
  | "desafio"
  | "congelador-ganado"
  | "congelador-usado";

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
  const nivelAntes = nivelParaXp(juego.xpTotal).nivel;

  // 1. La semana de XP rueda los lunes.
  const semana = inicioSemana(hoy);
  if (juego.semanaXp !== semana) {
    juego = { ...juego, semanaXp: semana, xpSemanal: 0 };
  }

  // 2. XP base del registro (+ bonus si con este tap se cumplió el objetivo).
  let xpGanado = PUNTOS_POR_REGISTRO;
  const objetivo = objetivoEnFecha(habit, fecha);
  const compAntes = completadosPara(habit, fecha, antes.completions).size;
  const compDespues = completadosPara(habit, fecha, despues.completions).size;
  if (compAntes < objetivo && compDespues >= objetivo) {
    xpGanado += PUNTOS_OBJETIVO_DIARIO;
  }

  // 3. Madrugador: registrar antes de las 8:00 a. m.
  if (new Date(timestamp).getHours() < 8) {
    juego = { ...juego, madrugadas: juego.madrugadas + 1 };
  }

  // 4. Racha máxima histórica + congelador cada 7 días de racha.
  const racha = rachaActual(habit, hoy, despues.completions, juego.diasProtegidos);
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
        xpGanado += XP_DESAFIO;
        eventos.push({
          tipo: "desafio",
          titulo: "¡Desafío completado!",
          detalle: `${h.nombre}: ${d.meta} días esta semana (+${XP_DESAFIO} XP).`,
        });
        return { ...d, completado: true };
      }
      return d;
    });
    if (hubo) juego = { ...juego, desafios };
  }

  // 7. Día completo → cofre sorpresa (una vez por fecha).
  if (diaCompleto(despues.habits, fecha, despues.completions, juego.diasProtegidos) && juego.ultimoCofre !== fecha) {
    const premio = tirarCofre(juego.congeladores);
    juego = {
      ...juego,
      diasCompletos: juego.diasCompletos + 1,
      ultimoCofre: fecha,
      cofres: juego.cofres + 1,
      congeladores: premio.congelador ? juego.congeladores + 1 : juego.congeladores,
    };
    xpGanado += premio.xp;
    eventos.push({
      tipo: "cofre",
      titulo: "¡Cofre del día!",
      detalle: premio.congelador
        ? "Día completo: ganaste un congelador de racha."
        : `Día completo: bonus sorpresa de +${premio.xp} XP.`,
    });
  }

  // 8. Aplicar el XP ganado.
  juego = { ...juego, xpTotal: juego.xpTotal + xpGanado, xpSemanal: juego.xpSemanal + xpGanado };

  // 9. ¿Subió de nivel?
  const nivelDespues = nivelParaXp(juego.xpTotal);
  if (nivelDespues.nivel > nivelAntes) {
    eventos.push({
      tipo: "subida-nivel",
      titulo: `¡Nivel ${nivelDespues.nivel}: ${nivelDespues.nombre}!`,
      detalle: "Tu constancia está dando frutos.",
      dato: String(nivelDespues.nivel),
    });
  }

  // 10. Logros recién desbloqueados.
  for (const id of logrosNuevos({ juego, habits: despues.habits, completions: despues.completions, hoy })) {
    juego = { ...juego, logros: [...juego.logros, id] };
    const def = LOGROS.find((l) => l.id === id);
    if (def) {
      eventos.push({ tipo: "logro", titulo: `¡Logro: ${def.nombre}!`, detalle: def.descripcion, dato: id });
    }
  }

  juego = { ...juego, actualizadoEn: new Date().toISOString() };
  return { state: { ...despues, juego }, eventos };
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

  // XP histórico: 10 por registro + 5 por cada día-hábito con objetivo cumplido.
  if (juego.xpTotal === 0 && state.completions.length > 0) {
    let xp = 0;
    let xpSem = 0;
    const porDia = new Map<string, { habit: Habit; ids: Set<string> }>();
    for (const c of state.completions) {
      const habit = state.habits.find((h) => h.id === c.habitId);
      if (!habit) continue;
      xp += PUNTOS_POR_REGISTRO;
      if (c.fecha >= semana) xpSem += PUNTOS_POR_REGISTRO;
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
    juego = { ...juego, xpTotal: xp, xpSemanal: xpSem, semanaXp: semana };
    marcar();
  }

  if (juego.semanaXp !== semana) {
    juego = { ...juego, semanaXp: semana, xpSemanal: 0 };
    marcar();
  }

  for (const h of state.habits) {
    const r = rachaActual(h, hoy, state.completions, juego.diasProtegidos);
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
      juego = { ...juego, logros: [...juego.logros, ...nuevos] };
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
    congeladores: Math.max(a.congeladores, b.congeladores),
    diasProtegidos: union(a.diasProtegidos, b.diasProtegidos),
    logros: union(a.logros, b.logros),
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
