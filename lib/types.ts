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

export type TipoHabit = "momento" | "cantidad";

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
  historialObjetivos?: { desde: string; objetivo: number; hasta?: string }[];
  momentos: Moment[];
  estado: EstadoHabit;
  creadoEn: string; // ISO
  /** 'momento' usa momentos del día (legacy/default). 'cantidad' es un contador libre por unidad. */
  tipo?: TipoHabit;
  /** Unidad de medida para hábitos de cantidad (ej. 'vasos', 'litros'). */
  unidad?: string;
}

/**
 * Evento de cumplimiento verificable.
 * Para hábitos de tipo 'momento', `eventId` es idempotente por momento+habit+fecha.
 * Para hábitos de tipo 'cantidad', cada registro es un evento único con timestamp exacto.
 */
export interface CompletionEvent {
  id: string;
  habitId: string;
  momentId?: string; // undefined para hábitos de cantidad
  fecha: string; // YYYY-MM-DD
  timestamp: string; // ISO
  // Idempotency key: `${habitId}|${momentId}|${fecha}` para momentos, o UUID/timestamp para cantidad
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
