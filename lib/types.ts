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

export type TipoHabit = "momento" | "cantidad" | "sueno";

/** Marca de sueño: qué botón se tocó en la tarjeta Sueño. */
export type MarcaSueno = "levantar" | "acostar";

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
  /** P1.3: marca de modificación (ISO). Last-write-wins en sincronización multi-dispositivo. */
  actualizadoEn: string;
  /** 'momento' usa momentos del día (legacy/default). 'cantidad' es un contador libre por unidad. */
  tipo?: TipoHabit;
  /** Unidad de medida para hábitos de cantidad (ej. 'vasos', 'litros'). */
  unidad?: string;
  /**
   * Sueño (tipo 'sueno'): hora objetivo para levantarse ("HH:mm", 24h).
   * Siempre activo: no se puede borrar ni archivar, solo se configuran horas.
   */
  horaLevantar?: string;
  /** Sueño (tipo 'sueno'): hora objetivo para acostarse ("HH:mm", 24h). */
  horaAcostar?: string;
  /** Sueño (tipo 'sueno'): horas de sueño deseadas por noche (referencia visual). */
  objetivoHoras?: number;
  /**
   * Aplazamiento puntual (YYYY-MM-DD): el hábito no aplica antes de esa fecha
   * y sí aplica ese día aunque no esté en `dias`. "Posponer para mañana".
   * Se ignora solo una vez que la fecha pasa.
   */
  pospuestoHasta?: string;
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
  /** P2.2: subtareas marcadas al completar (también se persiste en remoto). */
  subtareasCompletadas?: string[];
}

export interface Settings {
  notificaciones: boolean;
  horasDescanso: { inicio: string; fin: string };
  tema: "claro" | "oscuro" | "sistema";
  reducirMovimiento: boolean;
}

/** Desafío semanal: completar `meta` días con objetivo cumplido en un hábito. */
export interface DesafioSemanal {
  id: string; // `${semana}|${habitId}`
  semana: string; // lunes de la semana (YYYY-MM-DD)
  habitId: string;
  meta: number; // días con objetivo cumplido para completarlo
  completado: boolean;
}

/**
 * Estado de juego (gamificación). Todo es monótono o por unión para que el
 * merge entre dispositivos (game_state) converja sin conflictos: los
 * contadores usan máximo y las colecciones usan unión.
 */
export interface JuegoState {
  /** XP acumulado de por vida (10 por registro + 5 bonus por objetivo). */
  xpTotal: number;
  /** XP ganado en la semana en curso (para la liga). */
  xpSemanal: number;
  /** Lunes de la semana a la que pertenece xpSemanal (YYYY-MM-DD). */
  semanaXp: string;
  /**
   * Nivel más alto alcanzado: el nivel efectivo nunca baja de aquí aunque
   * las penalizaciones resten XP. Los niveles son irreversibles.
   */
  nivelMaximo: number;
  /** Congeladores de racha disponibles (tope MAX_CONGELADORES). */
  congeladores: number;
  /** Fechas (YYYY-MM-DD) protegidas automáticamente por un congelador. */
  diasProtegidos: string[];
  /** Ids de LOGROS desbloqueados. */
  logros: string[];
  /**
   * Ids de LOGROS cuyo premio de XP ya fue reclamado (tap en la sala de
   * trofeos). El XP no se otorga al desbloquear, solo al reclamar.
   */
  logrosReclamados: string[];
  /** Última fecha en la que se reclamó el cofre del día completo. */
  ultimoCofre: string | null;
  /** Cofres abiertos en total. */
  cofres: number;
  /** Desafíos semanales (vigentes e históricos). */
  desafios: DesafioSemanal[];
  /** Mayor racha alcanzada por hábito (sobrevive a rachas rotas). */
  rachaMaxima: Record<string, number>;
  /** Mayor múltiplo de 7 de racha ya premiado con congelador, por hábito. */
  rachaPremiada: Record<string, number>;
  /** Sueño: claves `cual|fecha` (p. ej. "levantar|2026-09-26") ya penalizadas
   *  con −10 XP por falta de marca. Evita castigar dos veces el mismo fallo. */
  suenoFallos: string[];
  /** Registros hechos antes de las 8:00 a. m. (logro Madrugador). */
  madrugadas: number;
  /** Días completos acumulados (todos los hábitos del día). */
  diasCompletos: number;
  /** Nombre visible en la liga. */
  nombreLiga: string;
  /** Marca ISO para last-write-wins de game_state en Supabase. */
  actualizadoEn: string;
}

export interface AppState {
  habits: Habit[];
  completions: CompletionEvent[];
  settings: Settings;
  juego: JuegoState;
  version: number;
}
