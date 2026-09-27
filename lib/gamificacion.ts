import type { CompletionEvent, DesafioSemanal, Habit, JuegoState, MarcaSueno } from "./types";
import { addDays, completadosPara, esDescanso, hhmmDeFecha, hhmmDeTimestamp, inicioSemana, moverFecha, todayKey } from "./dates";

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
  // Sueño: el puntaje es por puntualidad (puede ser negativo), no +10 fijos.
  // Sin bonus de objetivo diario: el acuerdo es solo el XP por puntualidad.
  if (habit.tipo === "sueno") {
    let pts = 0;
    for (const c of eventos) {
      const objetivo = c.momentId === "levantar" ? (habit.horaLevantar ?? "06:00") : (habit.horaAcostar ?? "22:00");
      pts += xpPorPuntualidad(minutosDeRetraso(objetivo, hhmmDeTimestamp(c.timestamp)));
    }
    return pts;
  }
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
  /** Frase que representa el espíritu del nivel. */
  mensaje: string;
}

export const NIVELES: NivelDef[] = [
  { nivel: 1, nombre: "Chispa", xp: 0, mensaje: "Todo gran fuego empieza con una chispa." },
  { nivel: 2, nombre: "Impulso", xp: 150, mensaje: "Ya agarraste vuelo. No lo sueltes." },
  { nivel: 3, nombre: "Ritmo", xp: 400, mensaje: "La constancia le gana a la intensidad." },
  { nivel: 4, nombre: "Constancia", xp: 800, mensaje: "Los días difíciles también cuentan." },
  { nivel: 5, nombre: "Hábito", xp: 1400, mensaje: "Ya no es esfuerzo: es quien eres." },
  { nivel: 6, nombre: "Disciplina", xp: 2200, mensaje: "Lo haces incluso sin ganas. Eso es poder." },
  { nivel: 7, nombre: "Maestría", xp: 3200, mensaje: "Dominas el proceso, no solo el resultado." },
  { nivel: 8, nombre: "Inspiración", xp: 4500, mensaje: "Tu ejemplo enciende a otros." },
  { nivel: 9, nombre: "Leyenda", xp: 6000, mensaje: "Esto ya es para siempre." },
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
  | "medalla"
  | "regalo"
  | "objetivo"
  | "copo";

export type CategoriaLogro =
  | "Rachas"
  | "Días perfectos"
  | "Registros"
  | "Madrugadas"
  | "Niveles"
  | "Colección"
  | "Extras";

export interface LogroDef {
  id: string;
  nombre: string;
  descripcion: string;
  icono: IconoLogro;
  categoria: CategoriaLogro;
  /** XP que se suma al juego al desbloquearlo (una sola vez). */
  xp: number;
  /** Mensaje corto de ánimo que acompaña la celebración. */
  mensaje: string;
}

/**
 * Catálogo de logros: visibles en la sala de trofeos (/logros). Los
 * bloqueados se muestran para dar meta; cada uno otorga XP una sola vez.
 */
export const LOGROS: LogroDef[] = [
  // Rachas
  { id: "racha-3", nombre: "Calentando", descripcion: "Racha de 3 días en un hábito", icono: "fuego", categoria: "Rachas", xp: 20, mensaje: "Tres días seguidos. El hábito está naciendo." },
  { id: "racha-7", nombre: "Primera semana", descripcion: "Racha de 7 días en un hábito", icono: "fuego", categoria: "Rachas", xp: 50, mensaje: "Una semana entera. Ya no eres el mismo de antes." },
  { id: "racha-14", nombre: "Quincena firme", descripcion: "Racha de 14 días en un hábito", icono: "fuego", categoria: "Rachas", xp: 80, mensaje: "Dos semanas sin fallar. Esto va en serio." },
  { id: "racha-30", nombre: "Mes imparable", descripcion: "Racha de 30 días en un hábito", icono: "fuego", categoria: "Rachas", xp: 150, mensaje: "Un mes completo. La constancia es tu superpoder." },
  { id: "racha-60", nombre: "Sesenta y contando", descripcion: "Racha de 60 días en un hábito", icono: "fuego", categoria: "Rachas", xp: 250, mensaje: "Sesenta días. Ya ni te cuesta: es parte de ti." },
  { id: "racha-100", nombre: "Centenario", descripcion: "Racha de 100 días en un hábito", icono: "trofeo", categoria: "Rachas", xp: 400, mensaje: "Cien días. Eso no lo hace cualquiera." },
  { id: "racha-365", nombre: "Año legendario", descripcion: "Racha de 365 días en un hábito", icono: "corona", categoria: "Rachas", xp: 1000, mensaje: "Un año entero. Eres leyenda, sin discusión." },
  // Días perfectos
  { id: "dia-perfecto", nombre: "Día perfecto", descripcion: "Completa todos tus hábitos un día", icono: "estrella", categoria: "Días perfectos", xp: 30, mensaje: "Todo tachado. Así se siente ganar el día." },
  { id: "dias-completos-10", nombre: "Máquina", descripcion: "10 días completos en total", icono: "estrella", categoria: "Días perfectos", xp: 100, mensaje: "Diez días perfectos. Ritmo de máquina." },
  { id: "dias-completos-25", nombre: "Imparable", descripcion: "25 días completos en total", icono: "estrella", categoria: "Días perfectos", xp: 200, mensaje: "Veinticinco días perfectos. Nada te detiene." },
  { id: "dias-completos-50", nombre: "Medio centenar", descripcion: "50 días completos en total", icono: "trofeo", categoria: "Días perfectos", xp: 400, mensaje: "Cincuenta días perfectos. Disciplina de otro nivel." },
  { id: "semana-perfecta", nombre: "Semana perfecta", descripcion: "7 días completos seguidos", icono: "estrella", categoria: "Días perfectos", xp: 200, mensaje: "Una semana perfecta. Pura disciplina." },
  // Registros
  { id: "registros-10", nombre: "En marcha", descripcion: "10 registros en total", icono: "rayo", categoria: "Registros", xp: 20, mensaje: "Diez marcas. El motor ya arrancó." },
  { id: "registros-50", nombre: "Constante", descripcion: "50 registros en total", icono: "rayo", categoria: "Registros", xp: 60, mensaje: "Cincuenta registros. La constancia se nota." },
  { id: "registros-100", nombre: "Centena", descripcion: "100 registros en total", icono: "rayo", categoria: "Registros", xp: 150, mensaje: "Cien registros. Sigue así, vas volando." },
  { id: "registros-500", nombre: "Quinientos", descripcion: "500 registros en total", icono: "trofeo", categoria: "Registros", xp: 400, mensaje: "Quinientos registros. Compromiso de verdad." },
  { id: "registros-1000", nombre: "Mil marcas", descripcion: "1000 registros en total", icono: "corona", categoria: "Registros", xp: 800, mensaje: "Mil marcas. Esto ya es un estilo de vida." },
  // Madrugadas
  { id: "madrugador", nombre: "Madrugador", descripcion: "5 registros antes de las 8:00 a. m.", icono: "sol", categoria: "Madrugadas", xp: 50, mensaje: "Madrugar también es disciplina. Bien ahí." },
  { id: "madrugador-20", nombre: "Dueño del amanecer", descripcion: "20 registros antes de las 8:00 a. m.", icono: "sol", categoria: "Madrugadas", xp: 120, mensaje: "Veinte madrugadas. El día te pertenece." },
  // Niveles
  { id: "nivel-3", nombre: "Subiendo", descripcion: "Alcanza el nivel 3", icono: "medalla", categoria: "Niveles", xp: 40, mensaje: "Nivel 3. La subida ya empezó." },
  { id: "nivel-5", nombre: "Disciplinado", descripcion: "Alcanza el nivel 5", icono: "medalla", categoria: "Niveles", xp: 100, mensaje: "Nivel 5. La disciplina te está cambiando." },
  { id: "nivel-7", nombre: "Veterano", descripcion: "Alcanza el nivel 7", icono: "medalla", categoria: "Niveles", xp: 250, mensaje: "Nivel 7. Ya eres veterano en esto." },
  { id: "nivel-9", nombre: "Leyenda viva", descripcion: "Alcanza el nivel 9", icono: "corona", categoria: "Niveles", xp: 500, mensaje: "Nivel máximo. Leyenda viva, nada menos." },
  // Colección
  { id: "primer-habito", nombre: "Primera piedra", descripcion: "Crea tu primer hábito", icono: "objetivo", categoria: "Colección", xp: 10, mensaje: "Todo imperio empieza con una piedra." },
  { id: "habitos-3", nombre: "Trío", descripcion: "3 hábitos activos a la vez", icono: "objetivo", categoria: "Colección", xp: 30, mensaje: "Tres hábitos en marcha. Buen equilibrio." },
  { id: "habitos-5", nombre: "Malabarista", descripcion: "5 hábitos activos a la vez", icono: "objetivo", categoria: "Colección", xp: 80, mensaje: "Cinco hábitos a la vez. Qué nivel de malabarista." },
  // Extras
  { id: "cofre-1", nombre: "Cazatesoros", descripcion: "Abre tu primer cofre del día", icono: "regalo", categoria: "Extras", xp: 30, mensaje: "El primer cofre. Los días perfectos tienen premio." },
  { id: "desafio-1", nombre: "Reto aceptado", descripcion: "Completa un desafío semanal", icono: "objetivo", categoria: "Extras", xp: 60, mensaje: "Reto cumplido. Los desafíos te hacen crecer." },
  { id: "congelador-1", nombre: "Red de seguridad", descripcion: "Gana un congelador de racha", icono: "copo", categoria: "Extras", xp: 40, mensaje: "Racha protegida. Cuidas lo que construyes." },
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
  const activos = habits.filter((h) => h.estado === "activo").length;
  const nivel = nivelParaXp(juego.xpTotal).nivel;

  const chequear = (id: string, condicion: boolean): void => {
    if (condicion && !tiene.has(id)) {
      tiene.add(id);
      nuevos.push(id);
    }
  };

  chequear("racha-3", maxRacha >= 3);
  chequear("racha-7", maxRacha >= 7);
  chequear("racha-14", maxRacha >= 14);
  chequear("racha-30", maxRacha >= 30);
  chequear("racha-60", maxRacha >= 60);
  chequear("racha-100", maxRacha >= 100);
  chequear("racha-365", maxRacha >= 365);
  chequear("dia-perfecto", juego.diasCompletos >= 1);
  chequear("dias-completos-10", juego.diasCompletos >= 10);
  chequear("dias-completos-25", juego.diasCompletos >= 25);
  chequear("dias-completos-50", juego.diasCompletos >= 50);
  chequear("registros-10", completions.length >= 10);
  chequear("registros-50", completions.length >= 50);
  chequear("registros-100", completions.length >= 100);
  chequear("registros-500", completions.length >= 500);
  chequear("registros-1000", completions.length >= 1000);
  chequear("madrugador", juego.madrugadas >= 5);
  chequear("madrugador-20", juego.madrugadas >= 20);
  chequear("nivel-3", nivel >= 3);
  chequear("nivel-5", nivel >= 5);
  chequear("nivel-7", nivel >= 7);
  chequear("nivel-9", nivel >= 9);
  chequear("primer-habito", habits.length >= 1);
  chequear("habitos-3", activos >= 3);
  chequear("habitos-5", activos >= 5);
  chequear("cofre-1", juego.cofres >= 1);
  chequear("desafio-1", juego.desafios.some((d) => d.completado));
  chequear("congelador-1", Object.keys(juego.rachaPremiada).length >= 1);

  let semanaPerfecta = true;
  let algunProgramado = false;
  for (let i = 0; i < 7; i++) {
    const d = todayKey(addDays(new Date(`${hoy}T12:00:00`), -i));
    // Día de descanso total (ningún hábito programado): no rompe la semana
    // perfecta. Antes exigía 7/7 días completos y el logro era inalcanzable
    // para quien descansa un día entero.
    if (!habits.some((h) => h.estado === "activo" && !esDescanso(h, d))) continue;
    algunProgramado = true;
    if (!diaCompleto(habits, d, completions, juego.diasProtegidos)) {
      semanaPerfecta = false;
      break;
    }
  }
  chequear("semana-perfecta", semanaPerfecta && algunProgramado);

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

/* ------------------------------- Sueño ---------------------------------- */

/**
 * Hábito especial "Sueño": siempre activo, dos marcas diarias ("Me levanté" /
 * "Me acosté") con hora objetivo configurable. El puntaje premia la
 * puntualidad y castiga el retraso o el olvido:
 * - A tiempo (o temprano): +10 XP.
 * - Cada 5 min de retraso: −1 XP (lineal hasta −10).
 * - Más de 50 min tarde o sin marca: −10 XP.
 * El XP total nunca baja de 0 (el piso se aplica en la capa de juego).
 */

export const SUENO_FALLO_XP = -10;

/** Minutos de retraso de horaReal vs horaObjetivo ("HH:mm"). Temprano = 0. */
export function minutosDeRetraso(horaObjetivo: string, horaReal: string): number {
  const aMin = (h: string): number => {
    const [hh, mm] = h.split(":").map(Number);
    return (hh || 0) * 60 + (mm || 0);
  };
  let diff = aMin(horaReal) - aMin(horaObjetivo);
  // Cruce de medianoche: acostarse a las 00:30 con objetivo 22:00 son 150 min
  // tarde, no 1290 min temprano.
  if (diff < -720) diff += 1440;
  return Math.max(0, diff);
}

/** XP por puntualidad dado el retraso en minutos. Rango [−10, +10]. */
export function xpPorPuntualidad(retrasoMin: number): number {
  // Más de 50 minutos tarde: −10 directo (no la curva gradual).
  if (retrasoMin > 50) return -10;
  return Math.max(-10, Math.min(10, Math.round(10 - retrasoMin / 5)));
}

/**
 * ¿A qué fecha se atribuye una marca de sueño? "Me levanté" siempre es hoy;
 * "Me acosté" con hora antes del mediodía pertenece a la noche anterior
 * (te acostaste de madrugada y lo marcas en la mañana).
 */
export function fechaParaMarcaSueno(cual: MarcaSueno, horaReal: string, ahora: Date): string {
  const hoy = todayKey(ahora);
  if (cual === "levantar") return hoy;
  return horaReal < "12:00" ? moverFecha(hoy, -1) : hoy;
}

/**
 * Noche a la que apunta "Me acosté" en la tarjeta: la candidata por la regla
 * del mediodía (antes de las 12:00 → anoche, para olvidos; después → esta
 * noche), pero si esa noche ya está completa (acostar + levantar marcados)
 * se avanza de inmediato al siguiente ciclo, sin pasar de hoy.
 */
export function nocheParaAcostar(
  ahora: Date,
  hayMarca: (cual: MarcaSueno, fecha: string) => boolean,
): string {
  const hoy = todayKey(ahora);
  let noche = hhmmDeFecha(ahora) < "12:00" ? moverFecha(hoy, -1) : hoy;
  const completa = (n: string) => hayMarca("acostar", n) && hayMarca("levantar", moverFecha(n, 1));
  if (completa(noche)) {
    const siguiente = moverFecha(noche, 1);
    if (siguiente <= hoy) noche = siguiente;
  }
  return noche;
}

/** XP que otorgó (o quitó) un evento de sueño: espejo para deshacer/backfill. */
export function xpSuenoDeEvento(habit: Habit, evento: CompletionEvent): number {
  const objetivo =
    evento.momentId === "levantar" ? (habit.horaLevantar ?? "06:00") : (habit.horaAcostar ?? "22:00");
  return xpPorPuntualidad(minutosDeRetraso(objetivo, hhmmDeTimestamp(evento.timestamp)));
}

export interface NocheSueno {
  /** Fecha de la noche (el día en que te acostaste). */
  noche: string;
  acostadoEn: string; // ISO real
  levantadoEn: string; // ISO real
  /** Horas dormidas con un decimal. */
  horas: number;
}

/** ¿La noche `noche` ya tiene sus dos marcas (acostar noche + levantar día siguiente)? */
export function nocheEstaCompleta(habit: Habit, completions: CompletionEvent[], noche: string): boolean {
  const diaSiguiente = moverFecha(noche, 1);
  let acostado = false;
  let levantado = false;
  for (const c of completions) {
    if (c.habitId !== habit.id) continue;
    if (c.momentId === "acostar" && c.fecha === noche) acostado = true;
    if (c.momentId === "levantar" && c.fecha === diaSiguiente) levantado = true;
    if (acostado && levantado) return true;
  }
  return false;
}

/** Noches completas (para el log invisible de horas dormidas y la tarjeta). */
export function nochesSueno(habit: Habit, completions: CompletionEvent[]): NocheSueno[] {
  const acostar = new Map<string, CompletionEvent>();
  const levantar = new Map<string, CompletionEvent>();
  for (const c of completions) {
    if (c.habitId !== habit.id) continue;
    if (c.momentId === "acostar") acostar.set(c.fecha, c);
    else if (c.momentId === "levantar") levantar.set(c.fecha, c);
  }
  const noches: NocheSueno[] = [];
  for (const [noche, a] of acostar) {
    const l = levantar.get(moverFecha(noche, 1));
    if (!l) continue;
    const ms = new Date(l.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (!Number.isFinite(ms) || ms < 0) continue;
    noches.push({
      noche,
      acostadoEn: a.timestamp,
      levantadoEn: l.timestamp,
      horas: Math.round((ms / 3600000) * 10) / 10,
    });
  }
  return noches.sort((x, y) => (x.noche < y.noche ? -1 : 1));
}

/** Mensaje corto de ánimo para el resultado de una marca de sueño. */
export function mensajeSueno(cual: MarcaSueno, xp: number, retrasoMin: number): string {
  const tarde = retrasoMin > 0 ? ` · ${retrasoMin} min tarde` : "";
  if (xp >= 10) {
    return cual === "levantar"
      ? "¡Puntual al levantarte! El día es tuyo."
      : "¡A dormir a tu hora! Mañana rindes el doble.";
  }
  if (xp > 0) return `+${xp} XP${tarde}. Cada minuto cuenta.`;
  if (xp === 0) return `Sin XP esta vez${tarde}. Mañana lo clavas.`;
  return `${xp} XP${tarde}. Dormir a deshoras pasa factura.`;
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
