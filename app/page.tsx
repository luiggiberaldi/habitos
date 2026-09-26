"use client";

import { useMemo, useState } from "react";
import { useStore } from "../lib/store-context";
import { PUNTOS_OBJETIVO_DIARIO, PUNTOS_POR_REGISTRO, puntosTotalesParaFecha, resumenSemanal } from "../lib/gamificacion";
import { addDays, completadosPara, DIAS_SEMANA, esDescanso, formatHoraA12, idiomaDeVentana, todayKey } from "../lib/dates";
import Logo from "../components/Logo";
import { IconAlerta, IconCategoria, IconCheck, IconEstrella, IconFuego, IconObjetivo } from "../lib/icons";
import type { CompletionEvent, Habit, Moment } from "../lib/types";

function etiquetaMoment(moment: Moment): string {
  return moment.tipo === "hora" && moment.hora ? formatHoraA12(moment.hora) : idiomaDeVentana(moment.ventana);
}

function rachaActual(habit: Habit, hoy: string, completions: CompletionEvent[]): number {
  let racha = 0;
  let d = new Date(`${hoy}T12:00:00`);
  for (let i = 0; i < 365; i++) {
    const key = todayKey(d);
    if (esDescanso(habit, key)) {
      d = new Date(d.getTime() - 86400000);
      continue;
    }
    const comp = completadosPara(habit, key, completions);
    if (comp.size >= habit.objetivo) {
      racha++;
    } else {
      break;
    }
    d = new Date(d.getTime() - 86400000);
  }
  return racha;
}

export default function Inicio() {
  const { state, registrar, deshacer } = useStore();
  const [marcando, setMarcando] = useState<string | null>(null);
  const [subtareasTemp, setSubtareasTemp] = useState<Record<string, string[]>>({});
  const [expandedMoment, setExpandedMoment] = useState<string | null>(null);

  const hoy = todayKey();
  const habitosHoy = useMemo(
    () => state.habits.filter((h) => h.estado === "activo" && !esDescanso(h, hoy)),
    [state.habits, hoy],
  );

  const puntosDia = useMemo(
    () => puntosTotalesParaFecha(state.habits, hoy, state.completions),
    [state.habits, hoy, state.completions],
  );

  const totalMomentos = habitosHoy.reduce((sum, h) => sum + h.momentos.length, 0);
  const completadosHoy = habitosHoy.reduce(
    (sum, h) => sum + completadosPara(h, hoy, state.completions).size,
    0,
  );
  const progreso = totalMomentos ? Math.round((completadosHoy / totalMomentos) * 100) : 0;
  const pendientes = totalMomentos - completadosHoy;

  // Resumen semanal: últimos 7 días hasta hoy, con rango de fechas explícito
  const finSemana = hoy;
  const inicioSemana = todayKey(addDays(new Date(`${hoy}T12:00:00`), -6));
  const resumen = useMemo(
    () => resumenSemanal(state.habits, inicioSemana, finSemana, state.completions),
    [state.habits, inicioSemana, finSemana, state.completions],
  );
  const previstosSemana = resumen.reduce((s, r) => s + r.previstos, 0);
  const completadosSemana = resumen.reduce((s, r) => s + r.completados, 0);
  const rangoLabel = `${inicioSemana} → ${finSemana}`;

  function alMarcar(habit: Habit, momentId: string) {
    const moment = habit.momentos.find((m) => m.id === momentId);
    const tieneSubtareas = moment?.subtareas && moment.subtareas.length > 0;

    if (tieneSubtareas && expandedMoment !== `${habit.id}|${momentId}`) {
      setExpandedMoment(`${habit.id}|${momentId}`);
      const key = `${habit.id}|${momentId}`;
      if (!subtareasTemp[key]) setSubtareasTemp((prev) => ({ ...prev, [key]: [] }));
      return;
    }

    const eventId = `${habit.id}|${momentId}|${hoy}`;
    const key = `${habit.id}|${momentId}`;
    const subsCompletadas = subtareasTemp[key] ?? [];
    setMarcando(eventId);
    window.setTimeout(() => {
      registrar(habit.id, momentId, hoy, subsCompletadas.length > 0 ? subsCompletadas : undefined);
      setMarcando(null);
      setExpandedMoment(null);
      setSubtareasTemp((prev) => { const n = { ...prev }; delete n[key]; return n; });
    }, 120);
  }

  function toggleSubtarea(habitId: string, momentId: string, subtarea: string) {
    const key = `${habitId}|${momentId}`;
    setSubtareasTemp((prev) => {
      const current = prev[key] ?? [];
      const exists = current.includes(subtarea);
      return { ...prev, [key]: exists ? current.filter((s) => s !== subtarea) : [...current, subtarea] };
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header sticky */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-10 w-10" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Tus hábitos</h1>
              <p className="text-xs text-muted">Panel de hoy</p>
            </div>
          </div>
          <div className="card flex shrink-0 items-center gap-3 px-4 py-2.5">
            <IconEstrella className="h-5 w-5 text-accent" />
            <div className="text-right">
              <p className="text-xs text-muted">Puntos hoy</p>
              <p className="text-xl font-bold leading-none">{puntosDia}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Recordatorio in-app */}
      {pendientes > 0 && habitosHoy.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-secondary/30 bg-secondary-soft px-4 py-3">
          <IconAlerta className="h-5 w-5 shrink-0 text-secondary" />
          <p className="text-sm font-medium text-secondary">
            Te quedan {pendientes} momento{pendientes !== 1 ? "s" : ""} por completar hoy.
          </p>
        </div>
      )}

      {/* Progreso */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">
            {completadosHoy} de {totalMomentos} momentos
          </p>
          <p className="text-sm font-bold text-accent">{progreso}%</p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={progreso}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-3 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-all duration-500"
            style={{ width: `${progreso}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>{PUNTOS_POR_REGISTRO} pts por momento · {PUNTOS_OBJETIVO_DIARIO} bonus al cumplir objetivo</span>
          {progreso === 100 && totalMomentos > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-accent">
              <IconFuego className="h-3 w-3" /> ¡Día completo!
            </span>
          )}
        </div>
      </section>

      {/* Resumen semanal */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Resumen semanal</h2>
            <p className="mt-1 text-xs text-muted">Registros realizados frente a los objetivos previstos</p>
          </div>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{rangoLabel}</span>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold leading-none">{completadosSemana}</span>
              <span className="text-sm text-muted">/ {previstosSemana} registros previstos</span>
            </div>
            <div className="h-2 w-32 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong"
                style={{ width: `${previstosSemana ? Math.min(100, (completadosSemana / previstosSemana) * 100) : 0}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Objetivo semanal: {previstosSemana} registros en {resumen.length} hábito{resumen.length !== 1 ? "s" : ""}.</p>
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {resumen.length === 0 && (
            <li className="text-sm text-muted">Aún no hay hábitos activos para esta semana.</li>
          )}
          {resumen.map(({ habit, previstos, completados }) => {
            const ratio = previstos ? completados / previstos : 0;
            const cumplida = previstos > 0 && completados >= previstos;
            return (
              <li key={habit.id} className="flex items-center gap-3">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: habit.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{habit.nombre}</p>
                    <p className={`text-xs font-semibold ${cumplida ? "text-accent" : "text-muted"}`}>
                      {completados}/{previstos}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: habit.color }}
                    />
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-semibold ${cumplida ? "text-accent" : "text-danger"}`}>
                  {cumplida ? "✓ Meta" : `${Math.round(ratio * 100)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {habitosHoy.length === 0 ? (
        <section className="card border-dashed p-10 text-center">
          <IconObjetivo className="mx-auto h-12 w-12 text-muted" />
          <h2 className="mt-3 text-lg font-semibold">Sin hábitos para hoy</h2>
          <p className="mt-1 text-sm text-muted">Crea nuevos hábitos o disfruta tu día libre.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          {habitosHoy.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              fecha={hoy}
              completions={state.completions}
              marcando={marcando}
              expandedMoment={expandedMoment}
              subtareasTemp={subtareasTemp}
              onMarcar={alMarcar}
              onDeshacer={deshacer}
              onToggleSubtarea={toggleSubtarea}
              onExpand={(id) => setExpandedMoment(id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function HabitCard({
  habit,
  fecha,
  completions,
  marcando,
  expandedMoment,
  subtareasTemp,
  onMarcar,
  onDeshacer,
  onToggleSubtarea,
  onExpand,
}: {
  habit: Habit;
  fecha: string;
  completions: CompletionEvent[];
  marcando: string | null;
  expandedMoment: string | null;
  subtareasTemp: Record<string, string[]>;
  onMarcar: (habit: Habit, momentId: string) => void;
  onDeshacer: (event: CompletionEvent) => void;
  onToggleSubtarea: (habitId: string, momentId: string, subtarea: string) => void;
  onExpand: (id: string | null) => void;
}) {
  const completados = completadosPara(habit, fecha, completions);
  const objetivo = habit.objetivo;
  const completos = completados.size >= objetivo;
  const racha = rachaActual(habit, fecha, completions);

  const ultimos7 = Array.from({ length: 7 }, (_, i) => {
    const dia = todayKey(addDays(new Date(`${fecha}T12:00:00`), -(6 - i)));
    const comp = completadosPara(habit, dia, completions);
    const descanso = esDescanso(habit, dia);
    const ratio = !descanso && objetivo > 0 ? Math.min(1, comp.size / objetivo) : 0;
    const indiceDia = new Date(`${dia}T12:00:00`).getDay();
    return { fecha: dia, ratio, descanso, completados: comp.size, etiqueta: DIAS_SEMANA[indiceDia].slice(0, 2) };
  });

  return (
    <article className="card overflow-hidden transition-shadow hover:shadow-md">
      <div className="h-1 w-full" style={{ backgroundColor: habit.color }} />
      <div className="p-5">
        <header className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${habit.color}1f`, color: habit.color }}
          >
            <IconCategoria categoria={habit.categoria} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{habit.nombre}</h2>
              {completos && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                  <IconCheck className="h-3 w-3" /> Objetivo
                </span>
              )}
              {racha >= 3 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  <IconFuego className="h-3 w-3" /> {racha}d
                </span>
              )}
            </div>
            <p className="text-sm text-muted">
              {completados.size}/{objetivo} momentos hoy
              {racha > 0 && racha < 3 && ` · Racha: ${racha}d`}
            </p>
          </div>
        </header>

        <div className="mt-4" role="group" aria-label={`Progreso de hoy: ${completados.size} de ${objetivo} momentos`}>
          <div
            role="progressbar"
            aria-valuenow={Math.min(completados.size, objetivo)}
            aria-valuemin={0}
            aria-valuemax={objetivo}
            aria-label={`Progreso de ${habit.nombre} hoy`}
            className="h-1.5 overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${objetivo ? Math.min(100, (completados.size / objetivo) * 100) : 0}%`, backgroundColor: habit.color }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {completos ? "¡Objetivo de hoy cumplido!" : `Te ${objetivo - completados.size === 1 ? "falta" : "faltan"} ${Math.max(0, objetivo - completados.size)} ${objetivo - completados.size === 1 ? "momento" : "momentos"}`}
          </p>
        </div>

        {/* Actividad de los últimos 7 días */}
        <div className="mt-4" role="group" aria-label="Actividad de los últimos siete días">
          <div className="flex h-8 items-end gap-1" aria-hidden="true">
            {ultimos7.map((dia) => (
              <div
                key={dia.fecha}
                className="flex-1 rounded-sm transition-all"
                style={{
                  height: dia.descanso ? "20%" : `${Math.max(12, dia.ratio * 100)}%`,
                  backgroundColor: dia.descanso ? "var(--border)" : dia.ratio >= 1 ? habit.color : dia.ratio > 0 ? `${habit.color}60` : "var(--border)",
                  boxShadow: dia.fecha === fecha ? `0 0 0 1px ${habit.color}, 0 0 0 2px var(--surface)` : undefined,
                }}
                title={`${dia.fecha}: ${dia.descanso ? "día de descanso" : `${dia.completados} de ${objetivo} momentos`}`}
              />
            ))}
          </div>
          <div className="mt-1 flex gap-1" aria-hidden="true">
            {ultimos7.map((dia) => (
              <span key={dia.fecha} className={`flex-1 text-center text-[10px] ${dia.fecha === fecha ? "font-bold text-foreground" : "text-muted"}`}>
                {dia.etiqueta}
              </span>
            ))}
          </div>
          <p className="sr-only">Últimos 7 días, de izquierda a derecha: {ultimos7.map((dia) => `${dia.fecha}, ${dia.descanso ? "descanso" : `${dia.completados} de ${objetivo}`}`).join("; ")}.</p>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {habit.momentos.map((moment) => {
            const hecho = completados.has(moment.id);
            const eventId = `${habit.id}|${moment.id}|${fecha}`;
            const event = completions.find((c) => c.eventId === eventId);
            const pulsando = marcando === eventId;
            const momentKey = `${habit.id}|${moment.id}`;
            const isExpanded = expandedMoment === momentKey;
            const tieneSubtareas = moment.subtareas && moment.subtareas.length > 0;
            const subsSeleccionadas = subtareasTemp[momentKey] ?? [];

            return (
              <li key={moment.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="min-w-0 flex-1 text-sm text-muted">{etiquetaMoment(moment)}</span>
                  {tieneSubtareas && !hecho && (
                    <button
                      type="button"
                      onClick={() => onExpand(isExpanded ? null : momentKey)}
                      className="min-h-10 rounded-lg px-2 text-xs text-accent hover:underline"
                    >
                      {isExpanded ? "Ocultar" : `${moment.subtareas!.length} recordatorio${moment.subtareas!.length !== 1 ? "s" : ""}`}
                    </button>
                  )}
                  {hecho && event ? (
                    <button
                      type="button"
                      onClick={() => onDeshacer(event)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
                    >
                      <IconCheck className="h-4 w-4" /> Hecho
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMarcar(habit, moment.id)}
                      disabled={pulsando}
                      className="btn-secondary min-h-10 !py-1.5 !px-3 !text-sm"
                    >
                      {pulsando ? "…" : "Marcar"}
                    </button>
                  )}
                </div>

                {/* Checklist de subtareas */}
                {isExpanded && tieneSubtareas && !hecho && (
                  <div className="ml-2 min-w-0 rounded-lg border border-border bg-surface-2/50 p-3 flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted mb-1">Recordatorios (opcional):</p>
                    {moment.subtareas!.map((sub) => {
                      const checked = subsSeleccionadas.includes(sub);
                      return (
                        <label key={sub} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleSubtarea(habit.id, moment.id, sub)}
                            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                          />
                          <span className={`text-sm transition-colors ${checked ? "line-through text-muted" : "group-hover:text-foreground"}`}>
                            {sub}
                          </span>
                        </label>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onMarcar(habit, moment.id)}
                      disabled={pulsando}
                      className="mt-1 btn-primary !py-1.5 !text-sm w-full justify-center"
                    >
                      {pulsando ? "…" : "Marcar completo"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}
