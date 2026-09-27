"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStoreActions, useStoreState } from "../lib/store-context";
import {
  PUNTOS_OBJETIVO_DIARIO,
  PUNTOS_POR_REGISTRO,
  LOGROS,
  NIVELES,
  diasCumplidosEnSemana,
  fraseIdentidad,
  nivelParaXp,
  puntosTotalesParaFecha,
  rachaActual,
  resumenSemanal,
  type IconoLogro,
} from "../lib/gamificacion";
import { suscribirEventosJuego, type EventoJuego } from "../lib/juego";
import { addDays, completadosPara, DIAS_SEMANA, esDescanso, formatHoraA12, idiomaDeVentana, inicioSemana as lunesDeSemana, todayKey } from "../lib/dates";
import Celebracion, { type CelebracionData } from "../components/Celebracion";
import CofreFlip, { type PremioCofreUI } from "../components/ui/CofreFlip";
import CheckAnimado from "../components/ui/CheckAnimado";
import Logo from "../components/Logo";
import { AvatarNivel, PALETA } from "../components/AvatarNivel";
import {
  IconAlerta,
  IconCandado,
  IconCategoria,
  IconCheck,
  IconChevronAbajo,
  IconCopo,
  IconCorona,
  IconEstrella,
  IconFuego,
  IconMedalla,
  IconObjetivo,
  IconRegalo,
  IconSol,
  IconTrofeo,
  IconRayo,
} from "../lib/icons";
import type { CompletionEvent, Habit, Moment } from "../lib/types";

function etiquetaMoment(moment: Moment): string {
  return moment.tipo === "hora" && moment.hora ? formatHoraA12(moment.hora) : idiomaDeVentana(moment.ventana);
}

const ICONOS_LOGRO: Record<IconoLogro, (props: { className?: string }) => React.JSX.Element> = {
  fuego: IconFuego,
  trofeo: IconTrofeo,
  corona: IconCorona,
  estrella: IconEstrella,
  sol: IconSol,
  rayo: IconRayo,
  medalla: IconMedalla,
};

function premioDesdeDato(dato: string | undefined): PremioCofreUI {
  if (dato === "congelador") return { tipo: "congelador", cantidad: 0 };
  const m = /^xp:(\d+)$/.exec(dato ?? "");
  return { tipo: "xp", cantidad: m ? Number(m[1]) : 0 };
}

function celebracionParaEvento(e: EventoJuego): CelebracionData | null {
  switch (e.tipo) {
    case "subida-nivel": {
      const nv = Math.min(9, Math.max(1, Number(e.dato) || 1));
      const def = NIVELES.find((n) => n.nivel === nv);
      return {
        icono: <AvatarNivel nivel={nv} nombre={def?.nombre ?? ""} className="h-14 w-14" />,
        titulo: e.titulo,
        detalle: e.detalle,
      };
    }
    case "logro": {
      const def = LOGROS.find((l) => l.id === e.dato);
      const Icono = def ? ICONOS_LOGRO[def.icono] : IconTrofeo;
      return { icono: <Icono className="h-8 w-8" />, titulo: e.titulo, detalle: e.detalle };
    }
    case "cofre":
      return {
        icono: <IconRegalo className="h-8 w-8" />,
        titulo: e.titulo,
        detalle: e.detalle,
        cuerpo: <CofreFlip premio={premioDesdeDato(e.dato)} />,
      };
    case "desafio":
      return { icono: <IconObjetivo className="h-8 w-8" />, titulo: e.titulo, detalle: e.detalle };
    default:
      return null; // congelador-ganado/usado van al toast, no interrumpen
  }
}

export default function Inicio() {
  const { state } = useStoreState();
  const { registrar, deshacer } = useStoreActions();
  const [marcando, setMarcando] = useState<string | null>(null);
  const [subtareasTemp, setSubtareasTemp] = useState<Record<string, string[]>>({});
  const [expandedMoment, setExpandedMoment] = useState<string | null>(null);
  const [mostrarCompletados, setMostrarCompletados] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [celebraciones, setCelebraciones] = useState<CelebracionData[]>([]);
  const deepLinkProcesado = useRef(false);

  const hoy = todayKey();
  const habitosHoy = useMemo(
    () => state.habits.filter((h) => h.estado === "activo" && !esDescanso(h, hoy)),
    [state.habits, hoy],
  );

  // Completados del día se colapsan: menos scroll, el foco queda en lo pendiente.
  const habitosPendientes = useMemo(
    () => habitosHoy.filter((h) => completadosPara(h, hoy, state.completions).size < h.objetivo),
    [habitosHoy, hoy, state.completions],
  );
  const habitosCompletados = useMemo(
    () => habitosHoy.filter((h) => completadosPara(h, hoy, state.completions).size >= h.objetivo),
    [habitosHoy, hoy, state.completions],
  );

  // Deep link del botón "Listo" de la notificación push: auto-registra el momento.
  useEffect(() => {
    if (deepLinkProcesado.current) return;
    deepLinkProcesado.current = true;
    const complete = new URLSearchParams(window.location.search).get("complete");
    if (!complete) return;
    window.history.replaceState(null, "", window.location.pathname);
    const [habitId, momentId] = complete.split("|");
    const habit = state.habits.find((h) => h.id === habitId && h.estado === "activo");
    if (!habit) return;
    let mensaje: string | null = null;
    if (habit.tipo === "cantidad" || !momentId || !habit.momentos.some((m) => m.id === momentId)) {
      registrar(habit.id, undefined, hoy);
      mensaje = `"${habit.nombre}" registrado`;
    } else {
      const eventId = `${habit.id}|${momentId}|${hoy}`;
      if (state.completions.some((c) => c.eventId === eventId)) {
        mensaje = `"${habit.nombre}" ya estaba registrado`;
      } else {
        registrar(habit.id, momentId, hoy);
        mensaje = `"${habit.nombre}" registrado`;
      }
    }
    // Diferido: react-hooks/set-state-in-effect no permite setState síncrono en el efecto.
    if (mensaje) window.setTimeout(() => setToast(mensaje), 0);
  }, [state.habits, state.completions, registrar, hoy]);

  // El toast de confirmación se oculta solo.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Eventos de juego: celebraciones en modal (nivel, logro, cofre, desafío) y
  // avisos menores en toast (congeladores). Se encolan para no solaparse.
  useEffect(() => {
    return suscribirEventosJuego((e: EventoJuego) => {
      const modal = celebracionParaEvento(e);
      if (modal) {
        setCelebraciones((prev) => [...prev, modal]);
      } else {
        setToast(`${e.titulo}: ${e.detalle}`);
      }
    });
  }, []);

  const cerrarCelebracion = (): void => {
    setCelebraciones((prev) => prev.slice(1));
  };

  const puntosDia = useMemo(
    () => puntosTotalesParaFecha(state.habits, hoy, state.completions),
    [state.habits, hoy, state.completions],
  );

  // Juego: nivel por XP de por vida, frase de identidad y desafíos vigentes.
  const nivel = useMemo(() => nivelParaXp(state.juego?.xpTotal ?? 0), [state.juego]);
  const frase = useMemo(
    () => (state.juego ? fraseIdentidad(state.habits, state.juego) : null),
    [state.habits, state.juego],
  );
  const semana = lunesDeSemana(hoy);
  const desafiosVigentes = useMemo(
    () => (state.juego?.desafios ?? []).filter((d) => d.semana === semana),
    [state.juego, semana],
  );
  const xpParaNivel = nivel.xpSiguiente !== null ? nivel.xpSiguiente - (state.juego?.xpTotal ?? 0) : 0;
  const palNivel = PALETA[nivel.nivel] ?? PALETA[1];
  const nombreSiguiente = NIVELES[nivel.nivel]?.nombre ?? null;
  const fechaHoy = (() => {
    const f = new Intl.DateTimeFormat("es-VE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
    return f.charAt(0).toUpperCase() + f.slice(1);
  })();

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

  function alRegistrarCantidad(habit: Habit) {
    const eventId = `${habit.id}|cantidad|${hoy}|${Date.now()}`;
    setMarcando(eventId);
    window.setTimeout(() => {
      registrar(habit.id, undefined, hoy);
      setMarcando(null);
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
      {/* Header sticky: banner con el degradado del nivel actual */}
      <header className="sticky top-0 z-20 -mx-4 bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div
          className="relative overflow-hidden rounded-3xl p-5 text-white"
          style={{
            background: `linear-gradient(135deg, ${palNivel.de}, ${palNivel.a} 55%, ${palNivel.profundo})`,
            boxShadow: `0 18px 40px -12px ${palNivel.a}b3`,
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(120% 90% at 20% 0%, ${palNivel.suave}66, transparent 60%)` }}
          />
          <div className="relative [text-shadow:0_1px_10px_rgba(0,0,0,0.30)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Marca visible solo en móvil (en escritorio ya está en el sidebar) */}
              <span className="shrink-0 rounded-2xl bg-white/95 p-1.5 shadow md:hidden">
                <Logo className="block h-8 w-8" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Tus hábitos</h1>
                <p className="text-xs text-white/85">{fechaHoy}</p>
              </div>
            </div>
            <div className="shrink-0 rounded-full bg-white/20 p-1 ring-2 ring-white/50">
              <AvatarNivel nivel={nivel.nivel} nombre={nivel.nombre} className="block h-12 w-12" />
            </div>
          </div>
          <p className="mt-3 text-sm font-bold">
            Nivel {nivel.nivel} · {nivel.nombre}
          </p>
          <p className="text-xs text-white/85">
            {nivel.xpSiguiente !== null && nombreSiguiente
              ? `Te faltan ${xpParaNivel} XP para ${nombreSiguiente}`
              : "Nivel máximo alcanzado"}
          </p>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-black/25"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(nivel.progreso * 100)}
            aria-label={`Progreso al nivel ${nivel.nivel + 1}`}
          >
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.round(nivel.progreso * 100)}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/30 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
              <IconRayo className="h-3.5 w-3.5" aria-hidden="true" />
              {puntosDia} puntos hoy
            </span>
            {(state.juego?.congeladores ?? 0) > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold"
                title="Congeladores: protegen tu racha si un día fallas"
              >
                <IconCopo className="h-3.5 w-3.5" aria-hidden="true" />
                {state.juego!.congeladores}{" "}
                {state.juego!.congeladores === 1 ? "congelador" : "congeladores"}
              </span>
            )}
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

      {/* Capa de identidad: quién te estás volviendo, no solo números */}
      {frase && (
        <p className="text-center text-sm italic text-muted" aria-live="polite">
          {frase}
        </p>
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

      {/* Desafíos semanales: meta visible y cercana (gradiente de meta) */}
      {desafiosVigentes.length > 0 && (
        <section className="card p-5" aria-label="Desafíos de la semana">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">Desafíos de la semana</h2>
              <p className="mt-1 text-xs text-muted">Se reinician el lunes · +50 XP cada uno</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              <IconObjetivo className="h-3.5 w-3.5" />
              {desafiosVigentes.filter((d) => d.completado).length}/{desafiosVigentes.length}
            </span>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {desafiosVigentes.map((d) => {
              const habit = state.habits.find((h) => h.id === d.habitId);
              if (!habit) return null;
              const dias = diasCumplidosEnSemana(habit, semana, hoy, state.completions, state.juego?.diasProtegidos ?? []);
              const ratio = d.meta ? dias / d.meta : 0;
              return (
                <li key={d.id} className="flex items-center gap-3">
                  <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: habit.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{habit.nombre}</p>
                      <p className={`text-xs font-semibold ${d.completado ? "text-accent" : "text-muted"}`}>
                        {d.completado ? "¡Completado!" : `${Math.min(dias, d.meta)}/${d.meta} días`}
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, ratio * 100)}%`,
                          backgroundColor: d.completado ? "var(--accent)" : habit.color,
                        }}
                      />
                    </div>
                  </div>
                  {d.completado && <IconCheck className="h-4 w-4 shrink-0 text-accent" aria-label="Desafío completado" />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Estante de logros: pocos y difíciles; los bloqueados se muestran para dar meta */}
      <section className="card p-5" aria-label="Logros">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Logros</h2>
            <p className="mt-1 text-xs text-muted">Pocos, difíciles y para siempre</p>
          </div>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
            {(state.juego?.logros ?? []).length}/{LOGROS.length}
          </span>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LOGROS.map((logro) => {
            const desbloqueado = (state.juego?.logros ?? []).includes(logro.id);
            const Icono = ICONOS_LOGRO[logro.icono];
            return (
              <li
                key={logro.id}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center ${
                  desbloqueado ? "border-accent/30 bg-accent-soft/40" : "border-border bg-surface-2/40 opacity-60"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    desbloqueado ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
                  }`}
                >
                  {desbloqueado ? <Icono className="h-5 w-5" /> : <IconCandado className="h-5 w-5" />}
                </span>
                <p className="text-xs font-semibold leading-tight">{logro.nombre}</p>
                <p className="text-[10px] leading-tight text-muted">{logro.descripcion}</p>
              </li>
            );
          })}
        </ul>
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
        <>
          <section className="flex flex-col gap-4">
            {habitosPendientes.map((habit) => (
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
                onRegistrarCantidad={alRegistrarCantidad}
              />
            ))}
          </section>
          {habitosCompletados.length > 0 && (
            <section className="card overflow-hidden" aria-label="Hábitos completados hoy">
              <button
                type="button"
                onClick={() => setMostrarCompletados((v) => !v)}
                aria-expanded={mostrarCompletados}
                className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
                  <IconCheck className="h-4 w-4 text-accent" />
                  Completados hoy ({habitosCompletados.length})
                </span>
                <IconChevronAbajo className={`h-4 w-4 shrink-0 text-muted transition-transform ${mostrarCompletados ? "rotate-180" : ""}`} />
              </button>
              {mostrarCompletados && (
                <div className="flex flex-col gap-4 border-t border-border p-4">
                  {habitosCompletados.map((habit) => (
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
                      onRegistrarCantidad={alRegistrarCantidad}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          <IconCheck className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      )}
      {celebraciones.length > 0 && (
        <Celebracion data={celebraciones[0]} onCerrar={cerrarCelebracion} />
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
  onRegistrarCantidad,
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
  onRegistrarCantidad: (habit: Habit) => void;
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
              {habit.tipo === "cantidad"
                ? `${completados.size}/${objetivo} ${habit.unidad || "unidades"} hoy`
                : `${completados.size}/${objetivo} momentos hoy`}
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

        {habit.tipo === "cantidad" ? (
          <CantidadCard
            habit={habit}
            fecha={fecha}
            completions={completions}
            marcando={marcando}
            onRegistrarCantidad={onRegistrarCantidad}
            onDeshacer={onDeshacer}
          />
        ) : (
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
                  <CheckAnimado
                    marcado={hecho}
                    deshabilitado={pulsando}
                    etiqueta={
                      hecho
                        ? `Deshacer registro de ${etiquetaMoment(moment)}`
                        : `Marcar ${etiquetaMoment(moment)} como hecho`
                    }
                    onCambiar={(nuevo) => {
                      if (nuevo) onMarcar(habit, moment.id);
                      else if (event) onDeshacer(event);
                    }}
                  />
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
        )}
      </div>
    </article>
  );
}

function CantidadCard({
  habit,
  fecha,
  completions,
  marcando,
  onRegistrarCantidad,
  onDeshacer,
}: {
  habit: Habit;
  fecha: string;
  completions: CompletionEvent[];
  marcando: string | null;
  onRegistrarCantidad: (habit: Habit) => void;
  onDeshacer: (event: CompletionEvent) => void;
}) {
  const pulsando = marcando !== null && marcando.startsWith(`${habit.id}|cantidad`);
  const hoyEventos = completions
    .filter((c) => c.habitId === habit.id && c.fecha === fecha)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const ultimo = hoyEventos[hoyEventos.length - 1];

  return (
    <div className="mt-4 flex items-center justify-center gap-5" role="group" aria-label={`Contador de ${habit.nombre}: ${hoyEventos.length} ${habit.unidad || "registros"}`}>
      <button
        type="button"
        onClick={() => ultimo && onDeshacer(ultimo)}
        disabled={!ultimo || pulsando}
        aria-label="Quitar un registro"
        className="btn-secondary h-12 w-12 !rounded-full !p-0 text-2xl font-bold leading-none disabled:opacity-40"
      >
        −
      </button>
      <div className="min-w-20 text-center">
        <p className="text-3xl font-bold tabular-nums" aria-live="polite">{hoyEventos.length}</p>
        <p className="text-xs text-muted">{habit.unidad || "registros"}</p>
      </div>
      <button
        type="button"
        onClick={() => onRegistrarCantidad(habit)}
        disabled={pulsando}
        aria-label="Añadir un registro"
        className="btn-primary h-12 w-12 !rounded-full !p-0 text-2xl font-bold leading-none"
      >
        +
      </button>
    </div>
  );
}

