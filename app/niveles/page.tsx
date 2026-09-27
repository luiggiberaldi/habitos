"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useStoreState } from "../../lib/store-context";
import { NIVELES, nivelParaXp } from "../../lib/gamificacion";
import { AvatarNivel, PALETA } from "../../components/AvatarNivel";
import { IconCheck, IconFlechaAtras } from "../../lib/icons";

/**
 * /niveles — mapa de los 9 niveles: qué XP pide cada uno, cuánto falta
 * desde el XP actual y la frase que representa a cada nivel.
 */
export default function Niveles() {
  const { state } = useStoreState();
  const xpTotal = state.juego?.xpTotal ?? 0;
  const actual = useMemo(() => nivelParaXp(xpTotal), [xpTotal]);
  const refActual = useRef<HTMLLIElement>(null);

  useEffect(() => {
    refActual.current?.scrollIntoView({ block: "center" });
  }, []);

  const nombreSiguiente = NIVELES[actual.nivel]?.nombre ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Volver al inicio"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/20 text-muted transition-colors hover:text-foreground"
        >
          <IconFlechaAtras className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Niveles</h1>
          <p className="text-sm text-muted">
            De Chispa a Leyenda · Llevas {xpTotal} XP
          </p>
        </div>
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
              className={`card overflow-hidden p-4 sm:p-5 ${esActual ? "ring-2 ring-accent" : ""}`}
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
    </div>
  );
}
