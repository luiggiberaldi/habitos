"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStoreState } from "../../lib/habitos/store-context";
import { NIVELES, nivelEfectivo } from "../../lib/habitos/gamificacion";
import { AvatarNivel, PALETA } from "../../components/AvatarNivel";
import { IconCheck, IconRayo } from "../../lib/core/ui/icons";
import { HistorialXp } from "./HistorialXp";

/**
 * /niveles — mapa de los 9 niveles: qué XP pide cada uno, cuánto falta
 * desde el XP actual y la frase que representa a cada nivel. Más abajo,
 * la economía del juego: cuánto XP da cada acción.
 */
export function VistaNiveles() {
  const { state } = useStoreState();
  const xpTotal = state.juego?.xpTotal ?? 0;
  const actual = useMemo(
    () => nivelEfectivo(xpTotal, state.juego?.nivelMaximo ?? 1),
    [xpTotal, state.juego],
  );
  const refActual = useRef<HTMLLIElement>(null);

  useEffect(() => {
    refActual.current?.scrollIntoView({ block: "center" });
  }, []);

  const nombreSiguiente = NIVELES[actual.nivel]?.nombre ?? null;

  return (
    <div className="flex w-full flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Niveles</h1>
        <p className="text-sm text-muted">
          De Chispa a Leyenda · Llevas {xpTotal} XP
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {NIVELES.map((n) => {
          const esActual = n.nivel === actual.nivel;
          const alcanzado = !esActual && xpTotal >= n.xp;
          const faltan = n.xp - xpTotal;
          const pal = PALETA[n.nivel];
          return (
            <li
              key={n.nivel}
              ref={esActual ? refActual : undefined}
              className={`animate-entrada card overflow-hidden p-4 sm:p-5 ${esActual ? "ring-2 ring-accent" : ""}`}
              style={{ animationDelay: `${Math.min(n.nivel - 1, 8) * 60}ms` }}
            >
              <div className="flex items-center gap-3.5">
                <span
                  className={`shrink-0 rounded-2xl p-1 ${alcanzado || esActual ? "" : "opacity-60 saturate-50"}`}
                  style={{ background: `linear-gradient(135deg, ${pal.de}, ${pal.a})` }}
                >
                  <AvatarNivel nivel={n.nivel} nombre={n.nombre} className="block h-12 w-12" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    Nivel {n.nivel} · {n.nombre}
                    {esActual && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-bold text-accent">
                        Actual
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted italic">“{n.mensaje}”</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted">Meta</p>
                  <p className="text-sm font-bold">{n.xp} XP</p>
                </div>
              </div>

              <div className="mt-3">
                {esActual ? (
                  <>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted/30"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(actual.progreso * 100)}
                      aria-label={`Progreso en el nivel ${n.nivel}`}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(actual.progreso * 100)}%`,
                          background: `linear-gradient(90deg, ${pal.de}, ${pal.a})`,
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {actual.xpSiguiente !== null && nombreSiguiente
                        ? `Te faltan ${actual.xpSiguiente - xpTotal} XP para ${nombreSiguiente}`
                        : "Nivel máximo alcanzado"}
                    </p>
                  </>
                ) : alcanzado ? (
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Completado
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    Te faltan <span className="font-bold text-foreground">{faltan} XP</span> para llegar aquí
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="titulo-economia" className="card p-4 sm:p-5">
        <h2 id="titulo-economia" className="flex items-center gap-2 text-base font-bold">
          <IconRayo className="h-5 w-5 text-accent" aria-hidden="true" />
          Cómo ganar XP
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5 text-sm">
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Registrar un hábito</span>
            <span className="shrink-0 font-bold">10 + 1 por nivel</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Completar el objetivo del día</span>
            <span className="shrink-0 font-bold">+5 por hábito</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Cofre del día perfecto</span>
            <span className="shrink-0 font-bold">15–160 según nivel</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Desafío semanal</span>
            <span className="shrink-0 font-bold">+25–65 según la meta</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Logros (se reclaman tocándolos)</span>
            <span className="shrink-0 font-bold">10–400</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted">Sueño, por puntualidad</span>
            <span className="shrink-0 font-bold">+10 a −10</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Los niveles nunca bajan: si una penalización te resta XP, conservas
          tu nivel hasta recuperar el progreso.
        </p>
      </section>

      <HistorialXp />
    </div>
  );
}
