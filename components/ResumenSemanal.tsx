"use client";

import { useMemo } from "react";
import {
  diasActivosEnRango,
  objetivoEnFecha,
  puntosEnRango,
  resumenSemanal,
} from "../lib/gamificacion";
import { addDays, completadosPara, DIAS_SEMANA, esDescanso, todayKey } from "../lib/dates";
import type { CompletionEvent, Habit } from "../lib/types";
import { IconEstrella, IconFuego, IconMedalla, IconObjetivo, IconTrofeo } from "../lib/icons";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Última semana completa (lunes a domingo) anterior a hoy. */
export function semanaAnteriorCompleta(hoyKey: string): { inicio: string; fin: string } {
  const hoy = new Date(`${hoyKey}T12:00:00`);
  const desdeLunes = (hoy.getDay() + 6) % 7;
  const lunesActual = addDays(hoy, -desdeLunes);
  return {
    inicio: todayKey(addDays(lunesActual, -7)),
    fin: todayKey(addDays(lunesActual, -1)),
  };
}

function etiquetaRango(inicio: string, fin: string): string {
  const d1 = new Date(`${inicio}T12:00:00`);
  const d2 = new Date(`${fin}T12:00:00`);
  const mismoMes = d1.getMonth() === d2.getMonth();
  return mismoMes
    ? `${d1.getDate()}–${d2.getDate()} ${MESES[d1.getMonth()]}`
    : `${d1.getDate()} ${MESES[d1.getMonth()]} – ${d2.getDate()} ${MESES[d2.getMonth()]}`;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function veredicto(pct: number, hayDatos: boolean): string {
  if (!hayDatos) return "Sin registros esa semana.";
  if (pct >= 90) return "Semana impecable. Así se construyen las rachas.";
  if (pct >= 70) return "Semana sólida. Vas por buen camino.";
  if (pct >= 40) return "A medio camino. Esta semana puedes superarla.";
  return "Semana floja, pero cuenta: lo importante es volver.";
}

export default function ResumenSemanal({
  habits,
  completions,
}: {
  habits: Habit[];
  completions: CompletionEvent[];
}) {
  const hoy = todayKey();
  const datos = useMemo(() => {
    const { inicio, fin } = semanaAnteriorCompleta(hoy);
    const activos = habits.filter((h) => h.estado === "activo");
    const porHabit = resumenSemanal(habits, inicio, fin, completions);
    const previstos = porHabit.reduce((s, r) => s + r.previstos, 0);
    const completados = porHabit.reduce((s, r) => s + r.completados, 0);
    const pct = previstos > 0 ? Math.round((completados / previstos) * 100) : 0;

    // Mejor día: consistencia promedio de hábitos programados ese día.
    let mejorDia: { fecha: string; pct: number } | null = null;
    const d = new Date(`${inicio}T12:00:00`);
    const finD = new Date(`${fin}T12:00:00`);
    while (d <= finD) {
      const key = todayKey(d);
      let suma = 0;
      let programados = 0;
      for (const h of activos) {
        if (esDescanso(h, key)) continue;
        programados++;
        if (completadosPara(h, key, completions).size >= objetivoEnFecha(h, key)) suma += 100;
      }
      const c = programados > 0 ? Math.round(suma / programados) : 0;
      if (programados > 0 && (!mejorDia || c > mejorDia.pct)) mejorDia = { fecha: key, pct: c };
      d.setDate(d.getDate() + 1);
    }

    const xp = puntosEnRango(habits, inicio, fin, completions);
    const diasActivos = diasActivosEnRango(habits, inicio, fin, completions).length;
    const destacado = porHabit.find((r) => r.completados > 0) ?? null;
    return { inicio, fin, pct, hayDatos: previstos > 0, mejorDia, xp, diasActivos, destacado };
  }, [habits, completions, hoy]);

  return (
    <section className="card p-4 sm:p-5" aria-label="Resumen de la semana pasada">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconTrofeo className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="font-semibold">Tu semana pasada</h2>
        </div>
        <span className="text-xs text-muted">{etiquetaRango(datos.inicio, datos.fin)}</span>
      </div>

      {!datos.hayDatos ? (
        <p className="mt-3 text-sm text-muted">
          No había hábitos programados esa semana. El resumen aparece cuando tengas actividad.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-4xl font-bold tracking-tight text-accent">{datos.pct}%</p>
            <p className="pb-1 text-sm text-muted">de cumplimiento</p>
          </div>
          <p className="mt-1 text-sm">{veredicto(datos.pct, datos.hayDatos)}</p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-surface-2/60 p-3">
              <dt className="flex items-center gap-1 text-xs text-muted">
                <IconFuego className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Mejor día
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {datos.mejorDia
                  ? `${capitalizar(DIAS_SEMANA[new Date(`${datos.mejorDia.fecha}T12:00:00`).getDay()])} (${datos.mejorDia.pct}%)`
                  : "—"}
              </dd>
            </div>
            <div className="rounded-xl bg-surface-2/60 p-3">
              <dt className="flex items-center gap-1 text-xs text-muted">
                <IconEstrella className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> XP ganado
              </dt>
              <dd className="mt-1 text-sm font-semibold">{datos.xp} XP</dd>
            </div>
            <div className="rounded-xl bg-surface-2/60 p-3">
              <dt className="flex items-center gap-1 text-xs text-muted">
                <IconObjetivo className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Días activos
              </dt>
              <dd className="mt-1 text-sm font-semibold">{datos.diasActivos}/7</dd>
            </div>
            <div className="rounded-xl bg-surface-2/60 p-3">
              <dt className="flex items-center gap-1 text-xs text-muted">
                <IconMedalla className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Destacado
              </dt>
              <dd className="mt-1 truncate text-sm font-semibold" title={datos.destacado?.habit.nombre}>
                {datos.destacado?.habit.nombre ?? "—"}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
