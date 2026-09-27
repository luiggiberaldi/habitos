import type { AppState, CompletionEvent, Habit, MarcaSueno, Moment, Settings } from "./types";
import { addDays, completadosPara, hhmmDeTimestamp, inicioSemana, todayKey } from "./dates";
import { eventIdCantidad } from "./event-id";
import { objetivoEnFecha, PUNTOS_OBJETIVO_DIARIO, PUNTOS_POR_REGISTRO, minutosDeRetraso, xpPorPuntualidad, xpSuenoDeEvento } from "./gamificacion";
import { juegoInicial, normalizarJuego, aplicarRecompensas, type EventoJuego } from "./juego";

export const STORAGE_KEY = "habitos-app-v1";

function dayAtOffset(offset: number): string {
  return todayKey(addDays(new Date(), offset));
}

function makeHabit(habit: Omit<Habit, "historialObjetivos" | "actualizadoEn">): Habit {
  return {
    ...habit,
    actualizadoEn: habit.creadoEn, // Al crear, modificación = creación.
    historialObjetivos: [{ desde: habit.creadoEn.slice(0, 10), objetivo: habit.objetivo }],
  };
}

/**
 * Hábito especial "Sueño": siempre activo, no se puede borrar ni archivar.
 * Nace con la app (22:00–6:00, 8h de referencia); solo se configuran las horas.
 * Dos marcas diarias por momentId: "levantar" y "acostar" (objetivo = 2).
 */
export function crearHabitoSueno(sufijo: string, creadoEn = new Date().toISOString()): Habit {
  return makeHabit({
    id: `sueno-${sufijo}`,
    nombre: "Sueño",
    descripcion: "Acuéstate y levántate a tu hora. La puntualidad suma XP.",
    icono: "",
    color: "#6366f1",
    categoria: "bienestar",
    dias: [0, 1, 2, 3, 4, 5, 6],
    objetivo: 2,
    momentos: [],
    estado: "activo",
    creadoEn,
    tipo: "sueno",
    horaLevantar: "06:00",
    horaAcostar: "22:00",
    objetivoHoras: 8,
  });
}

export function crearEstadoInicial(): AppState {
  const creadoEn = new Date().toISOString();
  // D1: los ids demo eran fijos ("demo-agua") y habits.id es PK GLOBAL — dos
  // usuarios con el demo sin renombrar colisionaban en silencio (upsert ajeno).
  // Ahora cada instalación genera su propio sufijo; instalaciones existentes
  // conservan sus ids (no se migran).
  const sufijo = Math.random().toString(36).slice(2, 10);
  const sueno = crearHabitoSueno(sufijo, creadoEn);
  const agua: Habit = makeHabit({
    id: `demo-agua-${sufijo}`, nombre: "Tomar agua", descripcion: "Un vaso y una pausa para hidratarte.", icono: "💧", color: "#F88808", categoria: "salud", dias: [0, 1, 2, 3, 4, 5, 6], objetivo: 3,
    momentos: [{ id: "agua-manana", tipo: "hora", hora: "09:00" }, { id: "agua-mediodia", tipo: "hora", hora: "13:00" }, { id: "agua-tarde", tipo: "hora", hora: "18:00" }], estado: "activo", creadoEn,
  });
  const lectura: Habit = makeHabit({
    id: `demo-lectura-${sufijo}`, nombre: "Leer un poco", descripcion: "Diez minutos también cuentan.", icono: "📖", color: "#7964a9", categoria: "crecimiento", dias: [1, 2, 3, 4, 5, 6, 0], objetivo: 1,
    momentos: [{ id: "lectura-noche", tipo: "ventana", ventana: "noche" }], estado: "activo", creadoEn,
  });
  const caminar: Habit = makeHabit({
    id: `demo-caminar-${sufijo}`, nombre: "Salir a caminar", descripcion: "A tu ritmo, sin prisa.", icono: "🚶", color: "#d28a4d", categoria: "bienestar", dias: [1, 2, 3, 4, 5], objetivo: 1,
    momentos: [{ id: "caminar-manana", tipo: "ventana", ventana: "manana" }], estado: "activo", creadoEn,
  });
  const completions: CompletionEvent[] = [];
  for (const [habit, moments, daysAgo] of [[agua, ["agua-manana", "agua-mediodia"], -1], [lectura, ["lectura-noche"], -1], [agua, ["agua-manana", "agua-mediodia", "agua-tarde"], -2], [lectura, ["lectura-noche"], -3]] as const) {
    for (const momentId of moments) {
      const fecha = dayAtOffset(daysAgo);
      const eventId = `${habit.id}|${momentId}|${fecha}`;
      completions.push({ id: eventId, eventId, habitId: habit.id, momentId, fecha, timestamp: `${fecha}T18:00:00.000Z` });
    }
  }
  return { habits: [sueno, agua, lectura, caminar], completions, juego: juegoInicial(), settings: { notificaciones: false, horasDescanso: { inicio: "22:00", fin: "08:00" }, tema: "sistema", reducirMovimiento: false }, version: 1 };
}

export function registrarCumplimiento(
  state: AppState,
  habitId: string,
  momentId: string | undefined,
  fecha: string,
  timestamp = new Date().toISOString(),
  subtareas?: string[],
  // P0.2: el contexto genera el eventId UNA vez (lib/event-id.ts) y lo pasa aquí;
  // el mismo valor se usa para el upsert remoto. Si no se pasa, se genera localmente.
  eventId?: string,
): AppState {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit || habit.estado !== "activo") return state;

  // Sueño: dos marcas diarias ("levantar" | "acostar"), idempotentes por
  // marca+fecha. El timestamp lleva la hora REAL (puede corregirse después).
  if (habit.tipo === "sueno") {
    if (momentId !== "levantar" && momentId !== "acostar") return state;
    const eid = eventId ?? `${habitId}|${momentId}|${fecha}`;
    if (state.completions.some((event) => event.eventId === eid)) return state;
    const event: CompletionEvent = {
      id: eid,
      eventId: eid,
      habitId,
      momentId,
      fecha,
      timestamp,
      subtareasCompletadas: [],
    };
    return { ...state, completions: [...state.completions, event] };
  }

  // Hábito de cantidad: cada marca es un registro único con timestamp exacto.
  if (habit.tipo === "cantidad") {
    const eid = eventId ?? eventIdCantidad(habitId, fecha);
    const event: CompletionEvent = {
      id: eid,
      eventId: eid,
      habitId,
      fecha,
      timestamp,
      subtareasCompletadas: subtareas ?? [],
    };
    return { ...state, completions: [...state.completions, event] };
  }

  const moment: Moment | undefined = habit?.momentos.find((item) => item.id === momentId);
  if (!habit || !moment || habit.estado !== "activo") return state;
  const eid = eventId ?? `${habitId}|${momentId}|${fecha}`;
  if (state.completions.some((event) => event.eventId === eid)) return state;
  const event: CompletionEvent = { id: eid, eventId: eid, habitId, momentId: momentId!, fecha, timestamp, subtareasCompletadas: subtareas ?? [] };
  return { ...state, completions: [...state.completions, event] };
}

export function deshacerCumplimiento(state: AppState, eventId: string): AppState {
  return { ...state, completions: state.completions.filter((event) => event.eventId !== eventId) };
}

/**
 * Deshace un cumplimiento revirtiendo el XP que otorgó (espejo exacto del
 * bonus en aplicarRecompensas). Sin esto, marcar → desmarcar → marcar
 * farmeaba XP infinito, incluido el xpSemanal de la liga.
 *
 * Los hitos NO se revierten: logros, cofres, desafíos completados y racha
 * máxima son "para siempre" por diseño; solo se devuelve el XP base, el bonus
 * de objetivo y el conteo de madrugador.
 */
export function deshacerConJuego(state: AppState, eventId: string): AppState {
  const evento = state.completions.find((e) => e.eventId === eventId);
  if (!evento) return state;
  const habit = state.habits.find((h) => h.id === evento.habitId);

  // Sueño: se revierte el XP por puntualidad que otorgó (o se devuelve el que
  // quitó). Espejo determinista de registrarSuenoConJuego (sin bonus diario).
  let xp = habit?.tipo === "sueno" && habit ? xpSuenoDeEvento(habit, evento) : PUNTOS_POR_REGISTRO;
  if (habit && habit.tipo !== "sueno") {
    const objetivo = objetivoEnFecha(habit, evento.fecha);
    const conEvento = completadosPara(habit, evento.fecha, state.completions).size;
    const sinEvento = completadosPara(
      habit,
      evento.fecha,
      state.completions.filter((e) => e.eventId !== eventId),
    ).size;
    // El bonus se otorgó al cruzar el objetivo; se devuelve solo si este
    // evento era lo que mantenía el día cumplido.
    if (objetivo > 0 && conEvento >= objetivo && sinEvento < objetivo) {
      xp += PUNTOS_OBJETIVO_DIARIO;
    }
  }

  const juego = normalizarJuego(state.juego);
  const xpTotal = Math.max(0, juego.xpTotal - xp);
  // El xpSemanal solo se toca si el evento pertenece a su semana en curso.
  const xpSemanal =
    inicioSemana(evento.fecha) === juego.semanaXp ? Math.max(0, juego.xpSemanal - xp) : juego.xpSemanal;
  // Madrugador: espejo del conteo en aplicarRecompensas (< 8:00 a. m. local).
  const madrugadas =
    evento.timestamp && new Date(evento.timestamp).getHours() < 8
      ? Math.max(0, juego.madrugadas - 1)
      : juego.madrugadas;

  const sinEvento = deshacerCumplimiento(state, eventId);
  return {
    ...sinEvento,
    juego: { ...juego, xpTotal, xpSemanal, madrugadas, actualizadoEn: new Date().toISOString() },
  };
}

export function guardarHabit(state: AppState, habit: Habit): AppState {
  const existe = state.habits.some((item) => item.id === habit.id);
  const ahora = new Date().toISOString();
  let nuevo = { ...habit, actualizadoEn: ahora }; // P1.3: toda edición mueve la marca LWW.
  if (existe) {
    const anterior = state.habits.find((item) => item.id === habit.id)!;
    // Fase 2: si cambió el objetivo, registrar el cambio en historialObjetivos
    // para que el histórico de progreso no se pierda ni se distorsione.
    // P2.1: no mutar objetos del estado previo — copiar también el último tramo.
    if (anterior.objetivo !== habit.objetivo) {
      const hoy = new Date().toISOString().slice(0, 10);
      const base = anterior.historialObjetivos ?? [];
      const historial = base.map((tramo, i) =>
        i === base.length - 1 && !tramo.hasta ? { ...tramo, hasta: hoy } : tramo,
      );
      historial.push({ desde: hoy, objetivo: habit.objetivo });
      nuevo = { ...habit, actualizadoEn: ahora, historialObjetivos: historial };
    } else {
      nuevo = { ...habit, actualizadoEn: ahora, historialObjetivos: anterior.historialObjetivos ?? habit.historialObjetivos };
    }
  }
  const habits = existe ? state.habits.map((item) => (item.id === nuevo.id ? nuevo : item)) : [...state.habits, nuevo];
  return { ...state, habits };
}

/**
 * Modo vacaciones: cambia activo<->pausado en masa.
 * No toca archivados (otra intención) ni los que ya están en el estado pedido.
 * Reutiliza guardarHabit para que cada cambio mueva su marca LWW.
 */
export function cambiarEstadoTodos(state: AppState, estado: "activo" | "pausado"): AppState {
  let s = state;
  for (const h of state.habits) {
    if (h.estado === "archivado" || h.estado === estado) continue;
    s = guardarHabit(s, { ...h, estado });
  }
  return s;
}

export function eliminarHabit(state: AppState, habitId: string): AppState {
  // El hábito Sueño es permanente: no se puede borrar (solo pausar con vacaciones).
  const habit = state.habits.find((item) => item.id === habitId);
  if (habit?.tipo === "sueno") return state;
  return {
    ...state,
    habits: state.habits.filter((item) => item.id !== habitId),
    completions: state.completions.filter((event) => event.habitId !== habitId),
  };
}

export function actualizarSettings(state: AppState, settings: Settings): AppState {
  return { ...state, settings };
}

const TEMAS_VALIDOS = ["claro", "oscuro", "sistema"] as const;

/**
 * Endurece los ajustes guardados: si el localStorage trae un settings
 * incompleto o corrupto (p. ej. sin `horasDescanso`), se rellena con los
 * valores por defecto en vez de romper la UI que los lee.
 */
function normalizarSettings(value: unknown, fallback: Settings): Settings {
  const p = (value && typeof value === "object" ? value : {}) as Partial<Settings> & {
    horasDescanso?: Partial<Settings["horasDescanso"]>;
  };
  const hd = (
    p.horasDescanso && typeof p.horasDescanso === "object" ? p.horasDescanso : {}
  ) as { inicio?: string; fin?: string };
  return {
    notificaciones: typeof p.notificaciones === "boolean" ? p.notificaciones : fallback.notificaciones,
    horasDescanso: {
      inicio: typeof hd.inicio === "string" && hd.inicio ? hd.inicio : fallback.horasDescanso.inicio,
      fin: typeof hd.fin === "string" && hd.fin ? hd.fin : fallback.horasDescanso.fin,
    },
    tema: (TEMAS_VALIDOS as readonly string[]).includes(p.tema as string)
      ? (p.tema as Settings["tema"])
      : fallback.tema,
    reducirMovimiento:
      typeof p.reducirMovimiento === "boolean" ? p.reducirMovimiento : fallback.reducirMovimiento,
  };
}

export function normalizarEstado(value: unknown): AppState {
  const fallback = crearEstadoInicial();
  if (!value || typeof value !== "object") return fallback;
  const partial = value as Partial<AppState>;
  if (!Array.isArray(partial.habits) || !Array.isArray(partial.completions)) return fallback;

  // Fase 4: saneamiento de hábitos corruptos — garantiza estructura mínima y dedupe por id.
  const habitIds = new Set<string>();
  const habits = partial.habits.filter((h): h is Habit => {
    if (!h || typeof h.id !== "string" || !h.id || habitIds.has(h.id)) return false;
    habitIds.add(h.id);
    if (typeof h.nombre !== "string" || !Array.isArray(h.momentos)) return false;
    return true;
  });
  const conHistorial = habits.map((h) => ({
    ...h,
    // P1.3: backfill de actualizadoEn para datos antiguos (localStorage sin el campo).
    actualizadoEn: h.actualizadoEn ?? h.creadoEn,
    // Asegura historialObjetivos presente (los hábitos antiguos en localStorage no lo tienen).
    historialObjetivos: h.historialObjetivos?.length
      ? h.historialObjetivos
      : [{ desde: (h.creadoEn?.slice(0, 10)) || new Date().toISOString().slice(0, 10), objetivo: h.objetivo }],
  }));

  const seen = new Set<string>();
  const completions = partial.completions.filter((event): event is CompletionEvent => {
    if (!event || typeof event.eventId !== "string" || !event.eventId || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    const habit = habits.find((h) => h.id === event.habitId);
    // Hábitos de cantidad registran por marca (sin momentId); los demás requieren momentId válido.
    const esCantidad = habit && habit.tipo === "cantidad";
    if (esCantidad) {
      return typeof event.habitId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.fecha);
    }
    return typeof event.habitId === "string" && typeof event.momentId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.fecha) && (event as CompletionEvent).momentId ? true : false;
  });

  // Sueño siempre activo: si falta (usuarios existentes), se siembra; si hay
  // duplicados (dos dispositivos sembraron el suyo), se conserva el de más
  // historial y se reasignan sus marcas al conservado.
  let habitsFinal = conHistorial;
  let completionsFinal = completions;
  const suenos = conHistorial.filter((h) => h.tipo === "sueno");
  if (suenos.length === 0) {
    const sueno = crearHabitoSueno(Math.random().toString(36).slice(2, 10));
    const conHistorialSueno = {
      ...sueno,
      historialObjetivos: [{ desde: sueno.creadoEn.slice(0, 10), objetivo: sueno.objetivo }],
    };
    habitsFinal = [...conHistorial, conHistorialSueno];
  } else if (suenos.length > 1) {
    const porId = new Map(suenos.map((h) => [h.id, completions.filter((c) => c.habitId === h.id).length]));
    const conservado = [...suenos].sort(
      (a, b) => (porId.get(b.id) ?? 0) - (porId.get(a.id) ?? 0) || a.creadoEn.localeCompare(b.creadoEn),
    )[0];
    const descartados = new Set(suenos.map((h) => h.id).filter((id) => id !== conservado.id));
    const vistos = new Set<string>();
    completionsFinal = completions
      .map((c) => {
        if (!descartados.has(c.habitId)) return c;
        const eventId = `${conservado.id}|${c.momentId}|${c.fecha}`;
        return { ...c, id: eventId, eventId, habitId: conservado.id };
      })
      .filter((c) => {
        if (vistos.has(c.eventId)) return false;
        vistos.add(c.eventId);
        return true;
      });
    habitsFinal = conHistorial.filter((h) => h.tipo !== "sueno" || h.id === conservado.id);
  }
  return { habits: habitsFinal, completions: completionsFinal, juego: normalizarJuego(partial.juego), settings: normalizarSettings(partial.settings, fallback.settings), version: 1 };
}

/**
 * Registra un cumplimiento y aplica la capa de juego (XP, niveles, rachas,
 * congeladores, desafíos, cofre y logros). Si el evento ya existía (tap
 * duplicado), no otorga recompensa: el estado vuelve intacto y sin eventos.
 */
export function registrarConJuego(
  state: AppState,
  habitId: string,
  momentId: string | undefined,
  fecha: string,
  timestamp = new Date().toISOString(),
  subtareas?: string[],
  eventId?: string,
): { state: AppState; eventos: EventoJuego[] } {
  const despues = registrarCumplimiento(state, habitId, momentId, fecha, timestamp, subtareas, eventId);
  if (despues.completions.length === state.completions.length) {
    return { state: despues, eventos: [] };
  }
  return aplicarRecompensas(state, despues, { habitId, fecha, timestamp });
}

/**
 * Registra una marca de sueño ("levantar" | "acostar") con su hora real y
 * aplica la capa de juego con XP por puntualidad (puede ser negativo).
 * Idempotente: si la marca ya existía para esa fecha, no otorga nada.
 */
export function registrarSuenoConJuego(
  state: AppState,
  habitId: string,
  cual: MarcaSueno,
  fecha: string,
  timestamp: string,
  eventId?: string,
): { state: AppState; eventos: EventoJuego[] } {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit || habit.tipo !== "sueno") return { state, eventos: [] };
  const objetivo = cual === "levantar" ? (habit.horaLevantar ?? "06:00") : (habit.horaAcostar ?? "22:00");
  const retrasoMin = minutosDeRetraso(objetivo, hhmmDeTimestamp(timestamp));
  const xpBase = xpPorPuntualidad(retrasoMin);
  const despues = registrarCumplimiento(state, habitId, cual, fecha, timestamp, undefined, eventId);
  if (despues.completions.length === state.completions.length) {
    return { state: despues, eventos: [] };
  }
  return aplicarRecompensas(state, despues, { habitId, fecha, timestamp, xpBase, retrasoMin, cualSueno: cual });
}

/**
 * Corrige la hora real de una marca de sueño ya registrada: revierte el XP
 * anterior (espejo exacto) y vuelve a registrar con el nuevo timestamp.
 */
export function corregirSuenoConJuego(
  state: AppState,
  habitId: string,
  cual: MarcaSueno,
  fecha: string,
  nuevoTimestamp: string,
): { state: AppState; eventos: EventoJuego[] } {
  const eventId = `${habitId}|${cual}|${fecha}`;
  const sinEvento = deshacerConJuego(state, eventId);
  return registrarSuenoConJuego(sinEvento, habitId, cual, fecha, nuevoTimestamp, eventId);
}
