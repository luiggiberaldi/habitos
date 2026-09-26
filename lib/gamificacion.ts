import type { CompletionEvent, DesafioSemanal, Habit, JuegoState } from "./types";
import { addDays, completadosPara, esDescanso, inicioSemana, todayKey } from "./dates";

export const PUNTOS_POR_REGISTRO = 10;
export const PUNTOS_OBJETIVO_DIARIO = 5;

export interface PuntosDiarios {
  habitId: string;
  fecha: string;
  puntos: number;
  registros: number;
}

/** Objetivo vigente en una fecha; el historial registra cortes efectivos inclusivos. */
export function objetivoEnFecha(habit: Habit, fecha: string): number {
  const cambios = [...(habit.historialObjetivos ?? [])].sort((a, b) => a.desde.localeCompare(b.desde));
  let objetivo = cambios[0]?.objetivo ?? habit.objetivo;
  for (const cambio of cambios) {
    if (cambio.desde <= fecha) objetivo = cambio.objetivo;
    else break;
  }
  return objetivo;
}

export function puntosParaFecha(habit: Habit, fecha: string, completions: CompletionEvent[]): number {
  if (esDescanso(habit, fecha)) return 0;
  const eventos = completions.filter((c) => c.habitId === habit.id && c.fecha === fecha);
  // Para cantidad cada registro cuenta individualmente; para momentos se cuentan momentos únicos.
  const ids = new Set(habit.tipo === "cantidad" ? eventos.map((c) => c.eventId) : eventos.map((c) => c.momentId));
  const objetivo = objetivoEnFecha(habit, fecha);
  return ids.size * PUNTOS_POR_REGISTRO + (objetivo > 0 && ids.size >= objetivo ? PUNTOS_OBJETIVO_DIARIO : 0);
}

export function puntosTotalesParaFecha(habits: Habit[], fecha: string, completions: CompletionEvent[]): number {
  return habits.reduce((sum, habit) => sum + puntosParaFecha(habit, fecha, completions), 0);
}

export function puntosEnRango(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): number {
  const fechas = new Set(completions.filter((c) => c.fecha >= inicio && c.fecha <= fin).map((c) => c.fecha));
  return [...fechas].reduce((sum, fecha) => sum + puntosTotalesParaFecha(habits, fecha, completions), 0);
}

export function registrosEnRango(habit: Habit, inicio: string, fin: string, completions: CompletionEvent[]): number {
  return new Set(completions.filter((c) => c.habitId === habit.id && c.fecha >= inicio && c.fecha <= fin).map((c) => c.eventId)).size;
}

export function consistenciaEnRango(habit: Habit, inicio: string, fin: string, completions: CompletionEvent[]): number {
  let programados = 0;
  let completos = 0;
  const date = new Date(`${inicio}T12:00:00`);
  const end = new Date(`${fin}T12:00:00`);
  while (date <= end) {
    const key = todayKey(date);
    if (!esDescanso(habit, key)) {
      programados++;
      if (completadosPara(habit, key, completions).size >= objetivoEnFecha(habit, key)) completos++;
    }
    date.setDate(date.getDate() + 1);
  }
  return programados ? Math.round((completos / programados) * 100) : 0;
}

export function diasActivosEnRango(_habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): string[] {
  return [...new Set(completions.filter((c) => c.fecha >= inicio && c.fecha <= fin).map((c) => c.fecha))].sort();
}

/** Días en que un hábito debería haberse completado dentro del rango (sin descansos). */
export function diasPrevistosEnRango(habit: Habit, inicio: string, fin: string): string[] {
  const dias: string[] = [];
  const date = new Date(`${inicio}T12:00:00`);
  const end = new Date(`${fin}T12:00:00`);
  while (date <= end) {
    const key = todayKey(date);
    if (!esDescanso(habit, key)) dias.push(key);
    date.setDate(date.getDate() + 1);
  }
  return dias;
}

/** Resumen semanal de registros realizados frente a la suma de objetivos diarios. */
export function resumenSemanal(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): {
  habit: Habit;
  previstos: number;
  completados: number;
}[] {
  return habits
    .filter((h) => h.estado === "activo")
    .map((habit) => {
      const fechasPrevistas = diasPrevistosEnRango(habit, inicio, fin);
      const previstos = fechasPrevistas.reduce((total, fecha) => total + objetivoEnFecha(habit, fecha), 0);
      const completados = new Set(completions
        .filter((c) => c.habitId === habit.id && c.fecha >= inicio && c.fecha <= fin)
        .map((c) => c.eventId)).size;
      return { habit, previstos, completados };
    })
    .sort((a, b) => b.completados - a.completados);
}

export interface EstadisticasHabit {
  habit: Habit;
  totalRegistros: number;
  consistencia: number;
}

export function estadisticasPorHabit(habits: Habit[], inicio: string, fin: string, completions: CompletionEvent[]): EstadisticasHabit[] {
  return habits.map((habit) => ({
    habit,
    totalRegistros: registrosEnRango(habit, inicio, fin, completions),
    consistencia: consistenciaEnRango(habit, inicio, fin, completions),
  })).sort((a, b) => b.consistencia - a.consistencia);
}

/**
 * P2.3: racha unificada (antes había dos implementaciones divergentes en
 * app/page.tsx y app/estadisticas/page.tsx).
 *
 * - Compara contra el objetivo vigente en cada fecha (`objetivoEnFecha`), no
 *   contra el objetivo actual.
 * - Si hoy está incompleto pero ningún momento está vencido (momentos "hora"
 *   con hora <= hora actual), el conteo empieza ayer: la racha no se rompe
 *   por consultar temprano en la mañana.
 * - Los días de descanso se saltan sin romper la racha.
 * - Indexa los completions en un Map por fecha (una pasada) en vez de
 *   filtrar todo el array por cada día del loop.
 */
export function rachaActual(
  habit: Habit,
  hoy: string,
  completions: CompletionEvent[],
  diasProtegidos: string[] = [],
  ahoraHHMM?: string,
): number {
  const porDia = new Map<string, CompletionEvent[]>();
  for (const c of completions) {
    if (c.habitId !== habit.id) continue;
    const arr = porDia.get(c.fecha);
    if (arr) arr.push(c);
    else porDia.set(c.fecha, [c]);
  }
  const unicosPara = (key: string): number => {
    const eventos = porDia.get(key) ?? [];
    return new Set(
      habit.tipo === "cantidad" ? eventos.map((c) => c.eventId) : eventos.map((c) => c.momentId),
    ).size;
  };

  const hhmm =
    ahoraHHMM ??
    (() => {
      const n = new Date();
      return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
    })();
  const eventosHoy = porDia.get(hoy) ?? [];
  const hayVencidoHoy = (habit.momentos ?? []).some(
    (m) =>
      m.tipo === "hora" &&
      m.hora &&
      m.hora <= hhmm &&
      !eventosHoy.some((c) => c.momentId === m.id),
  );

  let d = new Date(`${hoy}T12:00:00`);
  if (unicosPara(hoy) < objetivoEnFecha(habit, hoy) && !hayVencidoHoy) {
    d = new Date(d.getTime() - 86400000);
  }

  let racha = 0;
  const protegidos = new Set(diasProtegidos);
  for (let i = 0; i < 365; i++) {
    const key = todayKey(d);
    // Los días protegidos por un congelador cuentan como cumplidos: la racha
    // no se rompe aunque no haya registros ese día.
    if (esDescanso(habit, key) || protegidos.has(key)) {
      d = new Date(d.getTime() - 86400000);
      continue;
    }
    if (unicosPara(key) >= objetivoEnFecha(habit, key)) {
      racha++;
    } else {
      break;
    }
    d = new Date(d.getTime() - 86400000);
  }
  return racha;
}

/* ============================================================================
 * Sistemas de juego (Tier 1 + Tier 2)
 * ----------------------------------------------------------------------------
 * Todo lo de aquí es puro: recibe datos y devuelve datos, sin tocar el estado
 * global ni el almacenamiento. La orquestación (cuándo se llama a cada cosa)
 * vive en lib/juego.ts.
 * ========================================================================== */

export const MAX_CONGELADORES = 2;
export const XP_DESAFIO = 50;

/* ------------------------------- Niveles -------------------------------- */

export interface NivelDef {
  nivel: number;
  nombre: string;
  /** XP total necesario para alcanzar este nivel. */
  xp: number;
}

export const NIVELES: NivelDef[] = [
  { nivel: 1, nombre: "Novato", xp: 0 },
  { nivel: 2, nombre: "Aprendiz", xp: 150 },
  { nivel: 3, nombre: "Constante", xp: 400 },
  { nivel: 4, nombre: "Enfocado", xp: 800 },
  { nivel: 5, nombre: "Disciplinado", xp: 1400 },
  { nivel: 6, nombre: "Imparable", xp: 2200 },
  { nivel: 7, nombre: "Titán", xp: 3200 },
  { nivel: 8, nombre: "Maestro", xp: 4500 },
  { nivel: 9, nombre: "Leyenda", xp: 6000 },
];

export interface NivelActual {
  nivel: number;
  nombre: string;
  /** XP donde empieza el nivel actual. */
  xpBase: number;
  /** XP donde empieza el siguiente nivel (null si es el máximo). */
  xpSiguiente: number | null;
  /** Progreso 0..1 hacia el siguiente nivel. */
  progreso: number;
}

/**
 * Nivel para un XP total. El gradiente de meta (Kivetz et al.): mostrar lo que
 * falta para el siguiente nivel acelera el esfuerzo cerca de la meta.
 */
export function nivelParaXp(xpTotal: number): NivelActual {
  const xp = Math.max(0, Math.floor(xpTotal));
  let actual = NIVELES[0];
  for (const n of NIVELES) {
    if (xp >= n.xp) actual = n;
    else break;
  }
  const idx = NIVELES.indexOf(actual);
  const siguiente = NIVELES[idx + 1] ?? null;
  const progreso = siguiente
    ? Math.min(1, (xp - actual.xp) / (siguiente.xp - actual.xp))
    : 1;
  return {
    nivel: actual.nivel,
    nombre: actual.nombre,
    xpBase: actual.xp,
    xpSiguiente: siguiente?.xp ?? null,
    progreso,
  };
}

/* -------------------------------- Logros -------------------------------- */

export type IconoLogro =
  | "fuego"
  | "trofeo"
  | "corona"
  | "estrella"
  | "sol"
  | "rayo"
  | "medalla";

export interface LogroDef {
  id: string;
  nombre: string;
  descripcion: string;
  icono: IconoLogro;
}

/**
 * Catálogo de logros: pocos, difíciles y visibles. La evidencia dice que las
 * medallas que "todos ganan" no aportan estatus ni motivación; estas requieren
 * esfuerzo real y por eso se muestran en el estante aunque estén bloqueadas.
 */
export const LOGROS: LogroDef[] = [
  { id: "racha-7", nombre: "Primera semana", descripcion: "Racha de 7 días en un hábito", icono: "fuego" },
  { id: "racha-30", nombre: "Mes imparable", descripcion: "Racha de 30 días en un hábito", icono: "fuego" },
  { id: "racha-100", nombre: "Centenario", descripcion: "Racha de 100 días en un hábito", icono: "trofeo" },
  { id: "racha-365", nombre: "Año legendario", descripcion: "Racha de 365 días en un hábito", icono: "corona" },
  { id: "semana-perfecta", nombre: "Semana perfecta", descripcion: "7 días completos seguidos", icono: "estrella" },
  { id: "madrugador", nombre: "Madrugador", descripcion: "5 registros antes de las 8:00 a. m.", icono: "sol" },
  { id: "dias-completos-10", nombre: "Máquina", descripcion: "10 días completos en total", icono: "rayo" },
  { id: "nivel-5", nombre: "Disciplinado", descripcion: "Alcanza el nivel 5", icono: "medalla" },
];

/** ¿El hábito cumplió su objetivo en la fecha? Un día protegido cuenta como cumplido. */
export function diaCumplidoHabit(
  habit: Habit,
  fecha: string,
  completions: CompletionEvent[],
  diasProtegidos: string[] = [],
): boolean {
  if (diasProtegidos.includes(fecha)) return true;
  if (esDescanso(habit, fecha)) return true; // día no programado: no resta
  return completadosPara(habit, fecha, completions).size >= objetivoEnFecha(habit, fecha);
}

/**
 * ¿El día está completo? Todos los hábitos activos programados ese día
 * cumplieron su objetivo (un día protegido por congelador cuenta como completo).
 */
export function diaCompleto(
  habits: Habit[],
  fecha: string,
  completions: CompletionEvent[],
  diasProtegidos: string[] = [],
): boolean {
  const programados = habits.filter((h) => h.estado === "activo" && !esDescanso(h, fecha));
  if (programados.length === 0) return false;
  return programados.every((h) => diaCumplidoHabit(h, fecha, completions, diasProtegidos));
}

/** Ids de logros recién desbloqueados (no estaban en juego.logros). Puro. */
export function logrosNuevos(params: {
  juego: JuegoState;
  habits: Habit[];
  completions: CompletionEvent[];
  hoy: string;
}): string[] {
  const { juego, habits, completions, hoy } = params;
  const tiene = new Set(juego.logros);
  const nuevos: string[] = [];
  const maxRacha = Math.max(0, ...Object.values(juego.rachaMaxima));

  const chequear = (id: string, condicion: boolean): void => {
    if (condicion && !tiene.has(id)) {
      tiene.add(id);
      nuevos.push(id);
    }
  };

  chequear("racha-7", maxRacha >= 7);
  chequear("racha-30", maxRacha >= 30);
  chequear("racha-100", maxRacha >= 100);
  chequear("racha-365", maxRacha >= 365);
  chequear("madrugador", juego.madrugadas >= 5);
  chequear("dias-completos-10", juego.diasCompletos >= 10);
  chequear("nivel-5", nivelParaXp(juego.xpTotal).nivel >= 5);

  let semanaPerfecta = true;
  for (let i = 0; i < 7; i++) {
    const d = todayKey(addDays(new Date(`${hoy}T12:00:00`), -i));
    if (!diaCompleto(habits, d, completions, juego.diasProtegidos)) {
      semanaPerfecta = false;
      break;
    }
  }
  chequear("semana-perfecta", semanaPerfecta);

  return nuevos;
}

/* ------------------------------ Congeladores ----------------------------- */

/**
 * Auto-aplica congeladores a días pasados sin actividad (uno por día, del más
 * reciente hacia atrás). Mitiga la ansiedad de racha: un día fallado no borra
 * semanas de progreso si el usuario se ganó protección.
 *
 * Reglas:
 * - Solo días estrictamente anteriores a hoy.
 * - Solo si ese día había al menos un hábito activo programado.
 * - Solo si hay actividad anterior (no quema congeladores de un usuario nuevo).
 * - Se detiene en el primer día con actividad o sin congeladores.
 */
export function congeladorAutomatico(
  juego: JuegoState,
  habits: Habit[],
  completions: CompletionEvent[],
  hoy: string,
): JuegoState {
  const fechasConActividad = new Set(completions.map((c) => c.fecha));
  const protegidos = new Set(juego.diasProtegidos);
  let congeladores = juego.congeladores;
  let cambió = false;

  for (let i = 1; i <= 30; i++) {
    const d = todayKey(addDays(new Date(`${hoy}T12:00:00`), -i));
    if (protegidos.has(d)) continue;
    if (fechasConActividad.has(d)) break;
    const programado = habits.some((h) => h.estado === "activo" && !esDescanso(h, d));
    if (!programado) continue;
    // Sin actividad anterior a este día: es un usuario nuevo o racha nunca
    // iniciada; no tiene sentido gastar protección.
    const hayActividadAntes = completions.some((c) => c.fecha < d);
    if (!hayActividadAntes) break;
    if (congeladores <= 0) break;
    congeladores--;
    protegidos.add(d);
    cambió = true;
  }

  if (!cambió) return juego;
  return { ...juego, congeladores, diasProtegidos: [...protegidos].sort() };
}

/* ------------------------------- Cofre ---------------------------------- */

export interface PremioCofre {
  xp: number;
  congelador: boolean;
}

/**
 * Recompensa variable del cofre del día completo: la incertidumbre sostiene la
 * dopamina mejor que un bonus fijo (que se vuelve aburrido a las ~20 veces).
 */
export function tirarCofre(congeladores: number): PremioCofre {
  if (Math.random() < 0.25 && congeladores < MAX_CONGELADORES) {
    return { xp: 0, congelador: true };
  }
  const r = Math.random();
  const xp = r < 0.5 ? 30 : r < 0.8 ? 60 : r < 0.95 ? 120 : 250;
  return { xp, congelador: false };
}

/* --------------------------- Desafíos semanales -------------------------- */

/** Días con objetivo cumplido por el hábito dentro de su semana (lunes..hoy). */
export function diasCumplidosEnSemana(
  habit: Habit,
  semana: string,
  hoy: string,
  completions: CompletionEvent[],
  diasProtegidos: string[] = [],
): number {
  const inicio = new Date(`${semana}T12:00:00`);
  const finSemana = todayKey(addDays(inicio, 6));
  const fin = hoy < finSemana ? hoy : finSemana;
  let dias = 0;
  const d = new Date(inicio);
  while (todayKey(d) <= fin) {
    const key = todayKey(d);
    if (diaCumplidoHabit(habit, key, completions, diasProtegidos) && !esDescanso(habit, key)) dias++;
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

/**
 * Asegura los desafíos de la semana en curso (hasta 3 hábitos activos, los de
 * mayor racha). Si ya existen para esta semana, devuelve el juego intacto.
 * Puro: no muta.
 */
export function asegurarDesafios(
  juego: JuegoState,
  habits: Habit[],
  completions: CompletionEvent[],
  semana: string,
  hoy: string,
): JuegoState {
  if (juego.desafios.some((d) => d.semana === semana)) return juego;
  const protegidos = juego.diasProtegidos;
  const candidatos = habits
    .filter((h) => h.estado === "activo")
    .map((h) => ({ h, racha: rachaActual(h, hoy, completions, protegidos) }))
    .sort((a, b) => b.racha - a.racha)
    .slice(0, 3);

  const nuevos: DesafioSemanal[] = [];
  for (const { h } of candidatos) {
    const programados = diasPrevistosEnRango(h, semana, todayKey(addDays(new Date(`${semana}T12:00:00`), 6))).length;
    const meta = Math.max(1, Math.min(5, programados));
    nuevos.push({ id: `${semana}|${h.id}`, semana, habitId: h.id, meta, completado: false });
  }
  if (nuevos.length === 0) return juego;
  // Se conservan los históricos; los vigentes quedan al final.
  return { ...juego, desafios: [...juego.desafios, ...nuevos] };
}

/* --------------------------- Capa de identidad --------------------------- */

/**
 * Frase de identidad basada en datos reales ("soy alguien que…"), no en
 * puntos. La literatura (Clear) muestra que el encuadre de identidad supera al
 * encuadre de resultados para sostener hábitos.
 */
export function fraseIdentidad(
  habits: Habit[],
  juego: JuegoState,
): string | null {
  let mejor: { nombre: string; racha: number } | null = null;
  for (const h of habits) {
    const r = juego.rachaMaxima[h.id] ?? 0;
    if (!mejor || r > mejor.racha) mejor = { nombre: h.nombre, racha: r };
  }
  if (mejor && mejor.racha >= 30) {
    return `Eres de los que no fallan: ${mejor.racha} días de "${mejor.nombre}".`;
  }
  if (mejor && mejor.racha >= 7) {
    return `"${mejor.nombre}" ya es parte de ti: ${mejor.racha} días seguidos.`;
  }
  if (juego.diasCompletos >= 7) {
    return `${juego.diasCompletos} días completos. La constancia es tu superpoder.`;
  }
  return null;
}

/** Lunes de la semana de hoy (re-exportado para la capa de juego). */
export { inicioSemana };
