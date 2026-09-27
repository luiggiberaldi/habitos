"use client";

import { useMemo, useState, type ReactNode } from "react";
import { addDays, completadosPara, DIAS_SEMANA, esDescanso, todayKey } from "../../lib/dates";
import {
  consistenciaEnRango,
  diasActivosEnRango,
  estadisticasPorHabit,
  nivelEfectivo,
  objetivoEnFecha,
  puntosEnRango,
  puntosTotalesParaFecha,
  rachaActual,
} from "../../lib/gamificacion";
import { useStoreState } from "../../lib/store-context";
import ResumenSemanal from "../../components/ResumenSemanal";
import {
  IconCategoria,
  IconCheck,
  IconEstadisticas,
  IconEstrella,
  IconFuego,
  IconLuna,
  IconObjetivo,
  IconReloj,
  IconSol,
} from "../../lib/icons";

const LETRAS_DIA = ["L", "M", "X", "J", "V", "S", "D"]; // lunes..domingo
const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function letraDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return LETRAS_DIA[(d.getDay() + 6) % 7];
}

function nombreDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  const n = DIAS_SEMANA[d.getDay()];
  return `${n[0].toUpperCase()}${n.slice(1)} ${d.getDate()}`;
}

function capitalizar(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

interface Delta {
  texto: string;
  tendencia: "sube" | "baja" | "igual";
  favorable: boolean;
}

/** Solo se muestra delta cuando el período anterior tiene datos; si no, es ruido. */
function deltaVs(actual: number, anterior: number, sufijo = ""): Delta | null {
  if (anterior <= 0) return null;
  const d = actual - anterior;
  if (d === 0) return { texto: "Sin cambios vs. periodo anterior", tendencia: "igual", favorable: true };
  const abs = Math.abs(d);
  const pct = Math.round((abs / anterior) * 100);
  return {
    texto: `${d > 0 ? "+" : "−"}${abs}${sufijo ? ` ${sufijo}` : ""} (${pct}%) vs. periodo anterior`,
    tendencia: d > 0 ? "sube" : "baja",
    favorable: d >= 0,
  };
}

function Sparkline({ valores, color = "var(--accent)" }: { valores: (number | null)[]; color?: string }) {
  const W = 72;
  const H = 24;
  const P = 2;
  const nums = valores.filter((v): v is number => v != null);
  if (nums.length < 2) return <div className="mt-2 h-6" aria-hidden="true" />;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (valores.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  let dAttr = "";
  let trazando = false;
  valores.forEach((v, i) => {
    if (v == null) {
      trazando = false;
      return;
    }
    dAttr += `${trazando ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    trazando = true;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-6 w-full" aria-hidden="true" preserveAspectRatio="none">
      <path
        d={dAttr}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function Estadisticas() {
  const { state } = useStoreState();
  const [rango, setRango] = useState<7 | 30 | 365>(7);
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const hoy = todayKey();
  const inicioBase = todayKey(addDays(new Date(`${hoy}T12:00:00`), -(rango - 1)));
  // En vista anual se alinea el inicio al lunes para columnas de semanas completas.
  const inicio =
    rango === 365
      ? todayKey(addDays(new Date(`${inicioBase}T12:00:00`), -((new Date(`${inicioBase}T12:00:00`).getDay() + 6) % 7)))
      : inicioBase;
  const inicioAnterior = todayKey(addDays(new Date(`${inicio}T12:00:00`), -rango));

  const datos = useMemo(() => {
    const habits = state.habits;
    const completions = state.completions;
    const activos = habits.filter((h) => h.estado === "activo");
    const nivel = nivelEfectivo(state.juego?.xpTotal ?? 0, state.juego?.nivelMaximo ?? 1).nivel;
    const finAnterior = todayKey(addDays(new Date(`${inicio}T12:00:00`), -1));
    const totalRegistros = completions.filter((c) => c.fecha >= inicio && c.fecha <= hoy).length;
    const puntos = puntosEnRango(habits, inicio, hoy, completions, nivel);
    const actividad = diasActivosEnRango(habits, inicio, hoy, completions);
    const consistencia = activos.length
      ? Math.round(activos.reduce((sum, h) => sum + consistenciaEnRango(h, inicio, hoy, completions), 0) / activos.length)
      : 0;
    const totalRegistrosPrev = completions.filter((c) => c.fecha >= inicioAnterior && c.fecha <= finAnterior).length;
    const puntosPrev = puntosEnRango(habits, inicioAnterior, finAnterior, completions, nivel);
    const actividadPrev = diasActivosEnRango(habits, inicioAnterior, finAnterior, completions);
    const consistenciaPrev = activos.length
      ? Math.round(activos.reduce((sum, h) => sum + consistenciaEnRango(h, inicioAnterior, finAnterior, completions), 0) / activos.length)
      : 0;
    return {
      totalRegistros,
      puntos,
      diasActivos: actividad.length,
      consistencia,
      porHabit: estadisticasPorHabit(habits, inicio, hoy, completions),
      deltas: {
        puntos: deltaVs(puntos, puntosPrev),
        registros: deltaVs(totalRegistros, totalRegistrosPrev),
        dias: deltaVs(actividad.length, actividadPrev.length),
        consistencia: deltaVs(consistencia, consistenciaPrev, "pp"),
      },
    };
  }, [state.habits, state.completions, state.juego, inicio, inicioAnterior, hoy]);

  /** Serie diaria del período: base de sparklines, calendario y ritmo. */
  const serie = useMemo(() => {
    const habits = state.habits;
    const completions = state.completions;
    const activos = habits.filter((h) => h.estado === "activo");
    const nivel = nivelEfectivo(state.juego?.xpTotal ?? 0, state.juego?.nivelMaximo ?? 1).nivel;
    const porDia = new Map<string, number>();
    for (const c of completions) {
      if (c.fecha >= inicio && c.fecha <= hoy) porDia.set(c.fecha, (porDia.get(c.fecha) ?? 0) + 1);
    }
    const dias: { fecha: string; puntos: number; registros: number; consistencia: number | null }[] = [];
    const d = new Date(`${inicio}T12:00:00`);
    const fin = new Date(`${hoy}T12:00:00`);
    while (d <= fin) {
      const key = todayKey(d);
      const registros = porDia.get(key) ?? 0;
      let suma = 0;
      let programados = 0;
      for (const h of activos) {
        if (esDescanso(h, key)) continue;
        programados++;
        if (completadosPara(h, key, completions).size >= objetivoEnFecha(h, key)) suma += 100;
      }
      dias.push({
        fecha: key,
        puntos: puntosTotalesParaFecha(habits, key, completions, nivel),
        registros,
        consistencia: programados ? Math.round(suma / programados) : null,
      });
      d.setDate(d.getDate() + 1);
    }
    return dias;
  }, [state.habits, state.completions, state.juego, inicio, hoy]);

  const maxConteo = useMemo(() => Math.max(1, ...serie.map((d) => d.registros)), [serie]);

  /** Vista anual estilo GitHub: columnas = semanas (lunes..domingo). */
  const vistaAnual = useMemo(() => {
    if (rango !== 365) return null;
    const porFecha = new Map(serie.map((s) => [s.fecha, s.registros]));
    const semanas: { fecha: string; registros: number }[][] = [];
    const etiquetas: string[] = [];
    const d = new Date(`${inicio}T12:00:00`);
    const fin = new Date(`${hoy}T12:00:00`);
    let mesPrevio = -1;
    while (d <= fin) {
      const sem: { fecha: string; registros: number }[] = [];
      for (let i = 0; i < 7; i++) {
        if (d <= fin) {
          const key = todayKey(d);
          sem.push({ fecha: key, registros: porFecha.get(key) ?? 0 });
        }
        d.setDate(d.getDate() + 1);
      }
      const primero = sem[0]?.fecha;
      const mes = primero ? new Date(`${primero}T12:00:00`).getMonth() : -1;
      etiquetas.push(mes !== mesPrevio && mes >= 0 ? MESES_CORTO[mes] : "");
      mesPrevio = mes;
      semanas.push(sem);
    }
    return { semanas, etiquetas };
  }, [rango, serie, inicio, hoy]);

  /** Racha global: días consecutivos con al menos un registro. */
  const rachaGlobal = useMemo(() => {
    const fechas = new Set(state.completions.map((c) => c.fecha));
    let actual = 0;
    let d = new Date(`${hoy}T12:00:00`);
    if (!fechas.has(todayKey(d))) d = addDays(d, -1); // hoy aún sin registros: partir de ayer
    while (fechas.has(todayKey(d)) && actual < 365) {
      actual++;
      d = addDays(d, -1);
    }
    let record = 0;
    let corrida = 0;
    d = new Date(`${hoy}T12:00:00`);
    for (let i = 0; i < 365; i++) {
      if (fechas.has(todayKey(d))) {
        corrida++;
        record = Math.max(record, corrida);
      } else {
        corrida = 0;
      }
      d = addDays(d, -1);
    }
    return { actual, record };
  }, [state.completions, hoy]);

  /** Ritmo semanal: registros por día de semana (0 = lunes). */
  const ritmo = useMemo(() => {
    const conteos = [0, 0, 0, 0, 0, 0, 0];
    for (const c of state.completions) {
      if (c.fecha < inicio || c.fecha > hoy) continue;
      const d = new Date(`${c.fecha}T12:00:00`);
      conteos[(d.getDay() + 6) % 7]++;
    }
    return conteos;
  }, [state.completions, inicio, hoy]);

  const insightRitmo = useMemo(() => {
    if (datos.totalRegistros === 0) return null;
    const max = Math.max(...ritmo);
    const min = Math.min(...ritmo);
    if (max === min) return "Registras parejo toda la semana. Buen ritmo.";
    const fuerte = capitalizar(DIAS_SEMANA[(ritmo.indexOf(max) + 1) % 7]);
    const flojo = capitalizar(DIAS_SEMANA[(ritmo.indexOf(min) + 1) % 7]);
    return `Tu día más fuerte es el ${fuerte.toLowerCase()} y el más flojo el ${flojo.toLowerCase()}.`;
  }, [ritmo, datos.totalRegistros]);

  /** Momento del día según la hora real de cada registro. */
  const franjas = useMemo(() => {
    const defs = [
      { nombre: "Madrugada", inicio: 0, fin: 5, Icono: IconLuna },
      { nombre: "Mañana", inicio: 5, fin: 12, Icono: IconSol },
      { nombre: "Tarde", inicio: 12, fin: 18, Icono: IconSol },
      { nombre: "Noche", inicio: 18, fin: 24, Icono: IconLuna },
    ];
    const conteos = [0, 0, 0, 0];
    for (const c of state.completions) {
      if (c.fecha < inicio || c.fecha > hoy) continue;
      const hora = new Date(c.timestamp).getHours();
      const idx = defs.findIndex((f) => hora >= f.inicio && hora < f.fin);
      if (idx >= 0) conteos[idx]++;
    }
    const total = conteos.reduce((a, b) => a + b, 0);
    return defs.map((f, i) => ({ ...f, conteo: conteos[i], pct: total ? (conteos[i] / total) * 100 : 0 }));
  }, [state.completions, inicio, hoy]);

  const detalleDia = useMemo(() => {
    if (!diaSeleccionado) return null;
    const delDia = state.completions.filter((c) => c.fecha === diaSeleccionado);
    if (delDia.length === 0) return { etiqueta: nombreDia(diaSeleccionado), total: 0, partes: [] as string[] };
    const porHabit = new Map<string, number>();
    for (const c of delDia) porHabit.set(c.habitId, (porHabit.get(c.habitId) ?? 0) + 1);
    const partes = [...porHabit.entries()].map(([id, n]) => {
      const h = state.habits.find((hh) => hh.id === id);
      return `${h?.nombre ?? "Hábito"} ×${n}`;
    });
    return { etiqueta: nombreDia(diaSeleccionado), total: delDia.length, partes };
  }, [diaSeleccionado, state.completions, state.habits]);

  function intensidadColor(conteo: number): string {
    if (conteo === 0) return "var(--border)";
    const ratio = conteo / maxConteo;
    if (ratio < 0.33) return "color-mix(in srgb, var(--accent) 30%, transparent)";
    if (ratio < 0.66) return "color-mix(in srgb, var(--accent) 65%, transparent)";
    return "var(--accent)";
  }

  const cambiarRango = (nuevo: 7 | 30 | 365) => {
    setRango(nuevo);
    setDiaSeleccionado(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Estadísticas</h1>
          <p className="mt-1 text-sm text-muted">Tu progreso en detalle.</p>
        </div>
        <div className="inline-flex shrink-0 rounded-xl border border-border bg-surface p-1">
          {([7, 30, 365] as const).map((diasRango) => (
            <button
              key={diasRango}
              type="button"
              onClick={() => cambiarRango(diasRango)}
              className={`min-h-10 rounded-lg px-3 sm:px-4 py-1.5 text-sm font-medium transition-colors ${
                rango === diasRango ? "bg-accent text-accent-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {diasRango === 7 ? "7 días" : diasRango === 30 ? "30 días" : "1 año"}
            </button>
          ))}
        </div>
      </header>

      {/* Métricas */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Puntos"
          value={datos.puntos}
          delta={datos.deltas.puntos}
          serie={serie.map((d) => d.puntos)}
          icon={<IconEstrella className="h-5 w-5 text-accent" />}
        />
        <MetricCard
          label="Registros"
          value={datos.totalRegistros}
          delta={datos.deltas.registros}
          serie={serie.map((d) => d.registros)}
          icon={<IconCheck className="h-5 w-5 text-accent" />}
        />
        <MetricCard
          label="Días activos"
          value={`${datos.diasActivos}/${rango}`}
          delta={datos.deltas.dias}
          serie={serie.map((d) => (d.registros > 0 ? 1 : 0))}
          icon={<IconFuego className="h-5 w-5 text-accent" />}
        />
        <MetricCard
          label="Consistencia"
          value={`${datos.consistencia}%`}
          delta={datos.deltas.consistencia}
          serie={serie.map((d) => d.consistencia)}
          subtitulo="Promedio de días programados cumplidos"
          icon={<IconObjetivo className="h-5 w-5 text-accent" />}
        />
      </section>

      {/* Resumen de la semana pasada */}
      <ResumenSemanal habits={state.habits} completions={state.completions} />

      {/* Calendario de actividad */}
      <section className="card min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Calendario de actividad</h2>
            <p className="mt-1 text-xs text-muted">Cada cuadro es un día; tócalo para ver el detalle.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <IconFuego className="h-4 w-4 text-accent" aria-hidden="true" />
            <span>
              Racha <strong className="text-foreground">{rachaGlobal.actual}d</strong>
              {" · "}Récord <strong className="text-foreground">{rachaGlobal.record}d</strong>
            </span>
          </div>
        </div>

        {datos.totalRegistros === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium">Este calendario está esperando su primera marca.</p>
            <p className="mt-1 text-sm text-muted">Registra un hábito hoy y empieza a llenarlo.</p>
          </div>
        ) : rango === 7 ? (
          <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-1.5">
            {serie.map(({ fecha, registros }) => (
              <div key={fecha} className="flex min-w-0 flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-muted">{letraDia(fecha)}</span>
                <DiaBoton
                  fecha={fecha}
                  registros={registros}
                  seleccionado={diaSeleccionado === fecha}
                  onToggle={() => setDiaSeleccionado((prev) => (prev === fecha ? null : fecha))}
                  color={intensidadColor(registros)}
                />
              </div>
            ))}
          </div>
        ) : rango === 365 && vistaAnual ? (
          <div className="mt-3 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1" role="img" aria-label="Mapa de calor del último año, por semanas">
              {vistaAnual.semanas.map((sem, si) => (
                <div key={si} className="flex flex-col gap-1">
                  <span className="h-4 text-[9px] font-medium text-muted" aria-hidden="true">
                    {vistaAnual.etiquetas[si]}
                  </span>
                  {sem.map(({ fecha, registros }) => (
                    <button
                      key={fecha}
                      type="button"
                      onClick={() => setDiaSeleccionado((prev) => (prev === fecha ? null : fecha))}
                      aria-pressed={diaSeleccionado === fecha}
                      title={`${nombreDia(fecha)}: ${registros} registro${registros !== 1 ? "s" : ""}`}
                      aria-label={`${nombreDia(fecha)}: ${registros} registro${registros !== 1 ? "s" : ""}. Activar para ver el detalle.`}
                      className={`h-3 w-3 rounded-[3px] outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-accent ${
                        diaSeleccionado === fecha ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
                      }`}
                      style={{ backgroundColor: intensidadColor(registros) }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {LETRAS_DIA.map((l) => (
                <div key={l} className="pb-1 text-center text-[10px] font-medium text-muted">
                  {l}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {Array.from({ length: (new Date(`${inicio}T12:00:00`).getDay() + 6) % 7 }).map((_, i) => (
                <div key={`vacio-${i}`} aria-hidden="true" />
              ))}
              {serie.map(({ fecha, registros }) => (
                <DiaBoton
                  key={fecha}
                  fecha={fecha}
                  registros={registros}
                  seleccionado={diaSeleccionado === fecha}
                  onToggle={() => setDiaSeleccionado((prev) => (prev === fecha ? null : fecha))}
                  color={intensidadColor(registros)}
                />
              ))}
            </div>
          </div>
        )}

        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-muted">
          {detalleDia ? (
            <>
              <strong className="text-foreground">{detalleDia.etiqueta}:</strong>{" "}
              {detalleDia.total === 0
                ? "sin registros."
                : `${detalleDia.total} registro${detalleDia.total !== 1 ? "s" : ""} — ${detalleDia.partes.join(" · ")}.`}
            </>
          ) : (
            datos.totalRegistros > 0 && "Toca un día para ver su detalle."
          )}
        </p>
        {datos.totalRegistros > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5" aria-label="Leyenda de intensidad: de menos a más registros">
            <span className="text-[10px] text-muted">Menos</span>
            {[
              "var(--border)",
              "color-mix(in srgb, var(--accent) 30%, transparent)",
              "color-mix(in srgb, var(--accent) 65%, transparent)",
              "var(--accent)",
            ].map((c, i) => (
              <span key={i} aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span className="text-[10px] text-muted">Más registros</span>
          </div>
        )}
      </section>

      {/* Ritmo semanal */}
      {datos.totalRegistros > 0 && (
        <section className="card min-w-0 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <IconEstadisticas className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold">Tu ritmo</h2>
          </div>
          <p className="mt-1 text-xs text-muted">Registros por día de la semana en este período.</p>
          <div className="mt-4 grid h-28 grid-cols-7 items-end gap-1.5 sm:gap-2">
            {ritmo.map((conteo, i) => {
              const max = Math.max(1, ...ritmo);
              return (
                <div key={i} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-medium text-muted">{conteo}</span>
                  <div
                    className="w-full rounded-md bg-accent"
                    style={{ height: `${Math.max(4, (conteo / max) * 100)}%`, opacity: 0.35 + 0.65 * (conteo / max) }}
                    aria-hidden="true"
                  />
                  <span className="text-[10px] font-medium text-muted">{LETRAS_DIA[i]}</span>
                </div>
              );
            })}
          </div>
          {insightRitmo && <p className="mt-3 text-sm text-muted">{insightRitmo}</p>}
        </section>
      )}

      {/* Momento del día */}
      {datos.totalRegistros > 0 && (
        <section className="card min-w-0 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <IconReloj className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold">¿Cuándo registras?</h2>
          </div>
          <p className="mt-1 text-xs text-muted">Según la hora real de cada registro.</p>
          <div className="mt-4 flex h-3.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
            {franjas.map((f, i) =>
              f.conteo > 0 ? (
                <div
                  key={f.nombre}
                  className="h-full"
                  style={{
                    width: `${f.pct}%`,
                    backgroundColor: `color-mix(in srgb, var(--accent) ${35 + i * 22}%, transparent)`,
                  }}
                  title={`${f.nombre}: ${f.conteo}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {franjas.map((f, i) => (
              <div key={f.nombre} className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `color-mix(in srgb, var(--accent) ${35 + i * 22}%, transparent)` }}
                >
                  <f.Icono className="h-4 w-4 text-accent-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{f.nombre}</p>
                  <p className="text-[11px] text-muted">{f.conteo} registros</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Por hábito */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Por hábito</h2>
          <p className="text-sm text-muted">Cumplimiento, racha y mejor marca.</p>
        </div>
        {datos.porHabit.length === 0 ? (
          <div className="card border-dashed p-8 text-center">
            <p className="text-sm text-muted">Aún no hay hábitos para mostrar.</p>
          </div>
        ) : (
          datos.porHabit.map(({ habit, totalRegistros, consistencia }) => {
            const racha = rachaActual(habit, hoy, state.completions);
            const mejor = Math.max(state.juego.rachaMaxima[habit.id] ?? 0, racha);
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
                      {totalRegistros} registros · Racha: {racha}d · Mejor: {mejor}d
                    </p>
                  </div>
                </div>
                <MiniSemana habit={habit} hoy={hoy} completions={state.completions} />
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

/** Cuadro de día del calendario: botón accesible con detalle al activar. */
function DiaBoton({
  fecha,
  registros,
  seleccionado,
  onToggle,
  color,
}: {
  fecha: string;
  registros: number;
  seleccionado: boolean;
  onToggle: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={seleccionado}
      className={`aspect-square w-full min-h-4 min-w-0 rounded outline-none transition-transform hover:z-10 hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-accent ${
        seleccionado ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
      }`}
      style={{ backgroundColor: color }}
      title={`${nombreDia(fecha)}: ${registros} registro${registros !== 1 ? "s" : ""}`}
      aria-label={`${nombreDia(fecha)}: ${registros} registro${registros !== 1 ? "s" : ""}. Activar para ver el detalle.`}
    />
  );
}

/** Mini heatmap de los últimos 7 días para un hábito. */
function MiniSemana({
  habit,
  hoy,
  completions,
}: {
  habit: Parameters<typeof rachaActual>[0];
  hoy: string;
  completions: Parameters<typeof rachaActual>[2];
}) {
  const dias = useMemo(() => {
    const lista: { fecha: string; estado: "ok" | "parcial" | "descanso" | "vacio" }[] = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = todayKey(addDays(new Date(`${hoy}T12:00:00`), -i));
      if (esDescanso(habit, fecha)) {
        lista.push({ fecha, estado: "descanso" });
        continue;
      }
      const n = completadosPara(habit, fecha, completions).size;
      const objetivo = objetivoEnFecha(habit, fecha);
      lista.push({ fecha, estado: n >= objetivo ? "ok" : n > 0 ? "parcial" : "vacio" });
    }
    return lista;
  }, [habit, hoy, completions]);

  const estilo: Record<string, { fondo: string; borde?: string; titulo: string }> = {
    ok: { fondo: habit.color, titulo: "Completado" },
    parcial: { fondo: `color-mix(in srgb, ${habit.color} 40%, transparent)`, titulo: "Parcial" },
    descanso: { fondo: "transparent", borde: "1px dashed var(--border)", titulo: "Descanso" },
    vacio: { fondo: "var(--border)", titulo: "Sin registros" },
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-[11px] text-muted">Últimos 7 días</span>
      <div className="flex gap-1" aria-label="Actividad de los últimos 7 días">
        {dias.map(({ fecha, estado }) => (
          <span
            key={fecha}
            title={`${nombreDia(fecha)}: ${estilo[estado].titulo.toLowerCase()}`}
            aria-label={`${nombreDia(fecha)}: ${estilo[estado].titulo.toLowerCase()}`}
            role="img"
            className="h-3.5 w-3.5 rounded-sm"
            style={{ backgroundColor: estilo[estado].fondo, border: estilo[estado].borde }}
          />
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  serie,
  subtitulo,
  icon,
}: {
  label: string;
  value: string | number;
  delta: Delta | null;
  serie: (number | null)[];
  subtitulo?: string;
  icon: ReactNode;
}) {
  const color =
    !delta || delta.tendencia === "igual"
      ? "text-muted"
      : delta.favorable
        ? "text-accent"
        : "text-danger";
  const flecha = !delta ? "" : delta.tendencia === "sube" ? "↑" : delta.tendencia === "baja" ? "↓" : "↔";
  return (
    <article className="card min-w-0 p-3 sm:p-4">
      <span role="img" aria-label={`${label}: ${value}`} className="inline-flex">
        {icon}
      </span>
      <p className="mt-2 break-words text-xl font-bold leading-none sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-foreground">{label}</p>
      {subtitulo && <p className="mt-0.5 text-[11px] leading-snug text-muted">{subtitulo}</p>}
      <Sparkline valores={serie} />
      {delta && (
        <p className={`mt-1 text-[11px] leading-snug ${color}`}>
          <span aria-label={`Tendencia ${delta.tendencia}`} className="mr-1 font-bold">
            {flecha}
          </span>
          {delta.texto}
        </p>
      )}
    </article>
  );
}
