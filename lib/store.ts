import type { AppState, CompletionEvent, Habit, Moment, Settings } from "./types";
import { addDays, todayKey } from "./dates";

export const STORAGE_KEY = "habitos-app-v1";

function dayAtOffset(offset: number): string {
  return todayKey(addDays(new Date(), offset));
}

function makeHabit(habit: Omit<Habit, "historialObjetivos">): Habit {
  return { ...habit, historialObjetivos: [{ desde: habit.creadoEn.slice(0, 10), objetivo: habit.objetivo }] };
}

export function crearEstadoInicial(): AppState {
  const creadoEn = new Date().toISOString();
  const agua: Habit = makeHabit({
    id: "demo-agua", nombre: "Tomar agua", descripcion: "Un vaso y una pausa para hidratarte.", icono: "💧", color: "#328b78", categoria: "salud", dias: [0, 1, 2, 3, 4, 5, 6], objetivo: 3,
    momentos: [{ id: "agua-manana", tipo: "hora", hora: "09:00" }, { id: "agua-mediodia", tipo: "hora", hora: "13:00" }, { id: "agua-tarde", tipo: "hora", hora: "18:00" }], estado: "activo", creadoEn,
  });
  const lectura: Habit = makeHabit({
    id: "demo-lectura", nombre: "Leer un poco", descripcion: "Diez minutos también cuentan.", icono: "📖", color: "#7964a9", categoria: "crecimiento", dias: [1, 2, 3, 4, 5, 6, 0], objetivo: 1,
    momentos: [{ id: "lectura-noche", tipo: "ventana", ventana: "noche" }], estado: "activo", creadoEn,
  });
  const caminar: Habit = makeHabit({
    id: "demo-caminar", nombre: "Salir a caminar", descripcion: "A tu ritmo, sin prisa.", icono: "🚶", color: "#d28a4d", categoria: "bienestar", dias: [1, 2, 3, 4, 5], objetivo: 1,
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
  return { habits: [agua, lectura, caminar], completions, settings: { notificaciones: false, horasDescanso: { inicio: "22:00", fin: "08:00" }, tema: "sistema", reducirMovimiento: false }, version: 1 };
}

export function registrarCumplimiento(state: AppState, habitId: string, momentId: string | undefined, fecha: string, timestamp = new Date().toISOString(), subtareas?: string[]): AppState {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit || habit.estado !== "activo") return state;

  // Hábito de cantidad: cada marca es un registro único con timestamp exacto.
  if (habit.tipo === "cantidad") {
    const event: CompletionEvent = {
      id: `${habitId}|${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      eventId: `${habitId}|${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      habitId,
      fecha,
      timestamp,
    };
    return { ...state, completions: [...state.completions, event] };
  }

  const moment: Moment | undefined = habit?.momentos.find((item) => item.id === momentId);
  if (!habit || !moment || habit.estado !== "activo") return state;
  const eventId = `${habitId}|${momentId}|${fecha}`;
  if (state.completions.some((event) => event.eventId === eventId)) return state;
  const event: CompletionEvent = { id: eventId, eventId, habitId, momentId: momentId!, fecha, timestamp };
  return { ...state, completions: [...state.completions, event] };
}

export function deshacerCumplimiento(state: AppState, eventId: string): AppState {
  return { ...state, completions: state.completions.filter((event) => event.eventId !== eventId) };
}

export function guardarHabit(state: AppState, habit: Habit): AppState {
  const existe = state.habits.some((item) => item.id === habit.id);
  let nuevo = habit;
  if (existe) {
    const anterior = state.habits.find((item) => item.id === habit.id)!;
    // Fase 2: si cambió el objetivo, registrar el cambio en historialObjetivos
    // para que el histórico de progreso no se pierda ni se distorsione.
    if (anterior.objetivo !== habit.objetivo) {
      const historial = [...(anterior.historialObjetivos ?? [])];
      const hoy = new Date().toISOString().slice(0, 10);
      const ultimo = historial[historial.length - 1];
      if (ultimo && !ultimo.hasta) {
        ultimo.hasta = hoy;
      }
      historial.push({ desde: hoy, objetivo: habit.objetivo });
      nuevo = { ...habit, historialObjetivos: historial };
    } else {
      nuevo = { ...habit, historialObjetivos: anterior.historialObjetivos ?? habit.historialObjetivos };
    }
  }
  const habits = existe ? state.habits.map((item) => (item.id === nuevo.id ? nuevo : item)) : [...state.habits, nuevo];
  return { ...state, habits };
}

export function eliminarHabit(state: AppState, habitId: string): AppState {
  return {
    ...state,
    habits: state.habits.filter((item) => item.id !== habitId),
    completions: state.completions.filter((event) => event.habitId !== habitId),
  };
}

export function actualizarSettings(state: AppState, settings: Settings): AppState {
  return { ...state, settings };
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
  return { habits: conHistorial, completions, settings: partial.settings ?? fallback.settings, version: 1 };
}
