"use client";

import { useMemo, useState } from "react";
import { addDays, todayKey } from "../../lib/dates";
import { consistenciaEnRango, diasActivosEnRango, estadisticasPorHabit, puntosEnRango, rachaActual } from "../../lib/gamificacion";
import { useStoreState } from "../../lib/store-context";
import { IconCategoria, IconCheck, IconEstrella, IconFuego, IconObjetivo } from "../../lib/icons";

function comparativa(actual: number, anterior: number, sufijo = "") {
  const delta = actual - anterior;
  const tendencia = delta > 0 ? "sube" : delta < 0 ? "baja" : "igual";
  const favorable = delta >= 0;
  if (delta === 0) return { delta: "Sin cambios", tendencia, favorable };
  const absoluto = Math.abs(delta);
  const porcentaje = anterior === 0 ? "nuevo" : `${Math.round((absoluto / anterior) * 100)}%`;
  const signo = delta > 0 ? "+" : "−";
  return {
    delta: `${signo}${absoluto}${sufijo ? ` ${sufijo}` : ""} (${porcentaje}) vs. periodo anterior`,
    tendencia,
    favorable,
  };
}


export default function Estadisticas() {
  const { state } = useStoreState();
  const [rango, setRango] = useState<7 | 30>(7);
  const hoy = todayKey();
  const inicio = todayKey(addDays(new Date(`${hoy}T12:00:00`), -(rango - 1)));
  const inicioAnterior = todayKey(addDays(new Date(`${inicio}T12:00:00`), -rango));

  const datos = useMemo(() => {
    const habits = state.habits;
    const completions = state.completions;
    const activos = habits.filter((h) => h.estado === "activo");
    const finAnterior = todayKey(addDays(new Date(`${inicio}T12:00:00`), -1));
    const totalRegistros = completions.filter((c) => c.fecha >= inicio && c.fecha <= hoy).length;
    const puntos = puntosEnRango(habits, inicio, hoy, completions);
    const actividad = diasActivosEnRango(habits, inicio, hoy, completions);
    const consistencia = activos.length
      ? Math.round(activos.reduce((sum, h) => sum + consistenciaEnRango(h, inicio, hoy, completions), 0) / activos.length)
      : 0;
    const totalRegistrosPrev = completions.filter((c) => c.fecha >= inicioAnterior && c.fecha <= finAnterior).length;
    const puntosPrev = puntosEnRango(habits, inicioAnterior, finAnterior, completions);
    const actividadPrev = diasActivosEnRango(habits, inicioAnterior, finAnterior, completions);
    const consistenciaPrev = activos.length
      ? Math.round(activos.reduce((sum, h) => sum + consistenciaEnRango(h, inicioAnterior, finAnterior, completions), 0) / activos.length)
      : 0;
    return {
      totalRegistros,
      puntos,
      diasActivos: actividad.length,
      consistencia,
      totalRegistrosPrev,
      puntosPrev,
      diasActivosPrev: actividadPrev.length,
      consistenciaPrev,
      porHabit: estadisticasPorHabit(habits, inicio, hoy, completions),
    };
  }, [state.habits, state.completions, inicio, inicioAnterior, hoy]);

  // Conteos diarios para intensidad del calendario
  const conteosDiarios = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of state.completions) {
      if (c.fecha >= inicio && c.fecha <= hoy) {
        map.set(c.fecha, (map.get(c.fecha) ?? 0) + 1);
      }
    }
    return map;
  }, [state.completions, inicio, hoy]);

  const maxConteo = useMemo(() => Math.max(1, ...conteosDiarios.values()), [conteosDiarios]);

  // Generar días para el grid del calendario
  const diasCalendario = useMemo(() => {
    const dias: { fecha: string; conteo: number }[] = [];
    const start = new Date(`${inicio}T12:00:00`);
    const end = new Date(`${hoy}T12:00:00`);
    const d = new Date(start);
    while (d <= end) {
      const key = todayKey(d);
      dias.push({ fecha: key, conteo: conteosDiarios.get(key) ?? 0 });
      d.setDate(d.getDate() + 1);
    }
    return dias;
  }, [inicio, hoy, conteosDiarios]);

  function intensidadColor(conteo: number): string {
    if (conteo === 0) return "var(--border)";
    const ratio = conteo / maxConteo;
    if (ratio < 0.33) return "color-mix(in srgb, var(--accent) 30%, transparent)";
    if (ratio < 0.66) return "color-mix(in srgb, var(--accent) 65%, transparent)";
    return "var(--accent)";
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Estadísticas</h1>
          <p className="mt-1 text-sm text-muted">Tu progreso en detalle.</p>
        </div>
        <div className="inline-flex shrink-0 rounded-xl border border-border bg-surface p-1">
          {([7, 30] as const).map((diasRango) => (
            <button
              key={diasRango}
              type="button"
              onClick={() => setRango(diasRango)}
              className={`min-h-10 rounded-lg px-3 sm:px-4 py-1.5 text-sm font-medium transition-colors ${
                rango === diasRango ? "bg-accent text-accent-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {diasRango === 7 ? "7 días" : "30 días"}
            </button>
          ))}
        </div>
      </header>

      {/* Métricas */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Puntos" value={datos.puntos} comparativa={comparativa(datos.puntos, datos.puntosPrev)} icon={<IconEstrella className="h-5 w-5 text-accent" />} />
        <MetricCard label="Registros" value={datos.totalRegistros} comparativa={comparativa(datos.totalRegistros, datos.totalRegistrosPrev)} icon={<IconCheck className="h-5 w-5 text-accent" />} />
        <MetricCard label="Días activos" value={`${datos.diasActivos}/${rango}`} comparativa={comparativa(datos.diasActivos, datos.diasActivosPrev)} icon={<IconFuego className="h-5 w-5 text-accent" />} />
        <MetricCard label="Consistencia" value={`${datos.consistencia}%`} comparativa={comparativa(datos.consistencia, datos.consistenciaPrev, "pp")} icon={<IconObjetivo className="h-5 w-5 text-accent" />} />
      </section>

      {/* Calendario de actividad */}
      <section className="card min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Calendario de actividad</h2>
            <p className="mt-1 text-xs text-muted">Cada cuadro es un día; pasa el cursor o enfócalo para ver el detalle.</p>
          </div>
          <span className="text-xs text-muted">{rango} días</span>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-1.5">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted pb-1">{d}</div>
          ))}
          {/* Offset para alinear primer día */}
          {Array.from({ length: (new Date(`${inicio}T12:00:00`).getDay() + 6) % 7 }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {diasCalendario.map(({ fecha, conteo }) => (
            <button
              key={fecha}
              type="button"
              className="group relative aspect-square min-h-4 min-w-0 rounded-sm outline-none transition-transform hover:z-10 hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-accent"
              style={{ backgroundColor: intensidadColor(conteo) }}
              title={`${fecha}: ${conteo} registro${conteo !== 1 ? "s" : ""}`}
              aria-label={`${fecha}: ${conteo} registro${conteo !== 1 ? "s" : ""}`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5" aria-label="Leyenda de intensidad: de menos a más registros">
          <span className="text-[10px] text-muted">Menos</span>
          {["var(--border)", "color-mix(in srgb, var(--accent) 30%, transparent)", "color-mix(in srgb, var(--accent) 65%, transparent)", "var(--accent)"].map((c, i) => (
            <span key={i} aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />
          ))}
          <span className="text-[10px] text-muted">Más registros</span>
        </div>
      </section>

      {/* Por hábito */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Por hábito</h2>
          <p className="text-sm text-muted">Cumplimiento y racha actual.</p>
        </div>
        {datos.porHabit.length === 0 ? (
          <div className="card border-dashed p-8 text-center">
            <p className="text-sm text-muted">Aún no hay hábitos para mostrar.</p>
          </div>
        ) : (
          datos.porHabit.map(({ habit, totalRegistros, consistencia }) => {
            const racha = rachaActual(habit, hoy, state.completions);
            return (
              <article key={habit.id} className="card min-w-0 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${habit.color}1f`, color: habit.color }}
                  >
                    <IconCategoria categoria={habit.categoria} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
                      <h3 className="min-w-0 truncate font-medium">{habit.nombre}</h3>
                      <span className="text-sm font-bold">{consistencia}%</span>
                    </div>
                    <p className="text-sm text-muted">
                      {totalRegistros} registros · Racha: {racha}d
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${consistencia}%`, backgroundColor: habit.color }}
                  />
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, comparativa: contexto, icon }: { label: string; value: string | number; comparativa: ReturnType<typeof comparativa>; icon: React.ReactNode }) {
  const color = contexto.tendencia === "igual" ? "text-muted" : contexto.favorable ? "text-accent" : "text-danger";
  const flecha = contexto.tendencia === "sube" ? "↑" : contexto.tendencia === "baja" ? "↓" : "↔";
  return (
    <article className="card min-w-0 p-3 sm:p-4">
      <span role="img" aria-label={`${label}: ${value}`} className="inline-flex">{icon}</span>
      <p className="mt-2 break-words text-xl font-bold leading-none sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-foreground">{label}</p>
      <p className={`mt-1 text-[11px] leading-snug ${color}`}>
        <span aria-label={`Tendencia ${contexto.tendencia}`} className="mr-1 font-bold">{flecha}</span>
        {contexto.delta}
      </p>
    </article>
  );
}
