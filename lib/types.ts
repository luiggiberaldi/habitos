export type Categoria = "salud" | "productividad" | "crecimiento" | "bienestar" | "personal" | "otro";

export type TipoMoment = "hora" | "ventana";

export interface Moment {
  id: string;
  tipo: TipoMoment;
  /** Hora en formato "HH:mm" (24h) cuando tipo === "hora" */
  hora?: string;
  /** Etiqueta de ventana flexible cuando tipo === "ventana" */
  ventana?: string;
  /** Subtareas opcionales (checklist recordatorio al marcar) */
  subtareas?: string[];
}

export type EstadoHabit = "activo" | "pausado" | "archivado";

export interface Habit {
  id: string;
  nombre: string;
  descripcion?: string;
  icono: string;
  color: string;
  categoria: Categoria;
  dias: number[]; // 0 = domingo ... 6 = sábado
  objetivo: number; // veces por día
  /** Cambios de objetivo conservados con fecha efectiva para estadísticas históricas. */
  historialObjetivos?: { desde: string; objetivo: number }[];
  momentos: Moment[];
  estado: EstadoHabit;
  creadoEn: string; // ISO
}

/**
 * Evento de cumplimiento verificable e idempotente.
 * `eventId` es único para el momento+habit+fecha y garantiza que
 * marcar dos veces no duplique puntos ni estadísticas.
 */
export interface CompletionEvent {
  id: string;
  habitId: string;
  momentId: string;
  fecha: string; // YYYY-MM-DD
  timestamp: string; // ISO
  // Idempotency key: `${habitId}|${momentId}|${fecha}`
  eventId: string;
}

export interface Settings {
  notificaciones: boolean;
  horasDescanso: { inicio: string; fin: string };
  tema: "claro" | "oscuro" | "sistema";
  reducirMovimiento: boolean;
}

export interface AppState {
  habits: Habit[];
  completions: CompletionEvent[];
  settings: Settings;
  version: number;
}
