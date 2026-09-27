// lib/plantillas.ts — Plantillas de hábitos de un tap.
//
// Fuente única usada por /habitos (creación rápida) y por el onboarding.
// Cada plantilla describe cómo construir el Hábito correspondiente.

import type { Categoria, Habit, TipoHabit } from "./types";

export interface Plantilla {
  nombre: string;
  categoria: Categoria;
  color: string;
  tipo: TipoHabit;
  objetivo: number;
  unidad?: string;
  momentos: { tipo: "hora" | "ventana" | "ancla"; hora?: string; ventana?: string; ancla?: "levantar" | "acostar" }[];
}

/** Plantillas de un tap: crear sin pasar por el formulario completo. */
export const PLANTILLAS: Plantilla[] = [
  { nombre: "Tomar agua", categoria: "salud", color: "#3b82f6", tipo: "cantidad", objetivo: 8, unidad: "vasos", momentos: [] },
  { nombre: "Leer", categoria: "crecimiento", color: "#a855f7", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "noche" }] },
  { nombre: "Caminar", categoria: "salud", color: "#22c55e", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "manana" }] },
  { nombre: "Meditar", categoria: "bienestar", color: "#6366f1", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "manana" }] },
  { nombre: "Ejercicio", categoria: "salud", color: "#ef4444", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "tarde" }] },
  // Nota: "Levantarse/Acostarse temprano" no van aquí: el hábito especial
  // Sueño (siempre activo) ya cubre ese registro con puntaje por puntualidad.
];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Construye un Hábito listo para guardar a partir de una plantilla. */
export function habitoDesdePlantilla(p: Plantilla): Habit {
  const ahora = new Date().toISOString();
  return {
    id: uid(),
    nombre: p.nombre,
    descripcion: "",
    icono: "",
    color: p.color,
    categoria: p.categoria,
    dias: [1, 2, 3, 4, 5, 6, 0],
    objetivo: p.objetivo,
    unidad: p.unidad,
    momentos: p.momentos.map((m) => ({ id: uid(), ...m })),
    estado: "activo",
    creadoEn: ahora,
    actualizadoEn: ahora,
    historialObjetivos: [{ desde: ahora.slice(0, 10), objetivo: p.objetivo }],
    tipo: p.tipo,
  };
}
