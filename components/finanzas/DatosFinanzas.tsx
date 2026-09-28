"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatearMonto,
  obtenerDatosFinanzas,
  type FinDatos,
} from "../../lib/finanzas/finanzas";
import { IconAlerta } from "../../lib/core/ui/icons";

const VERDE = "text-green-700 dark:text-green-400";
const ROJO = "text-red-700 dark:text-red-400";

/** Formato corto: $ 1,2k cuando el número es grande. */
function formatoCorto(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 10000) return `$ ${(usd / 1000).toFixed(1).replace(".", ",")}k`;
  return formatearMonto(usd, "USD");
}

/**
 * Vista "Datos" de Finanzas: balance de los últimos 6 meses, evolución del
 * patrimonio (reconstruida desde el patrimonio actual menos los flujos
 * posteriores) y categorías con más gasto en el mes actual. Tono serio.
 */
export function DatosFinanzas({ patrimonio }: { patrimonio: number }) {
  const [datos, setDatos] = useState<FinDatos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    obtenerDatosFinanzas()
      .then((d) => {
        if (vivo) setDatos(d);
      })
      .catch((e) => {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los datos");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const historialPatrimonio = useMemo(() => {
    if (!datos) return [];
    // P(fin de mes i) = patrimonio actual − flujos netos posteriores a i.
    const flujos = datos.meses.map((m) => m.flujoNetoUsd);
    return datos.meses.map((m, i) => {
      const posteriores = flujos.slice(i + 1).reduce((a, b) => a + b, 0);
      return { ...m, patrimonioUsd: Math.round((patrimonio - posteriores) * 100) / 100 };
    });
  }, [datos, patrimonio]);

  if (cargando) return <p className="text-sm text-muted">Cargando datos…</p>;
  if (error)
    return (
      <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
        <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  if (!datos) return null;

  const hayMovimientos = datos.meses.some((m) => m.ingresosUsd > 0 || m.egresosUsd > 0);
  if (!hayMovimientos) {
    return (
      <div className="rounded-3xl bg-surface p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-foreground">Aún no hay datos</p>
        <p className="mt-1 text-sm text-muted">
          Registra ingresos y egresos y aquí verás tu balance, tu patrimonio en el tiempo y en qué se va el dinero.
        </p>
      </div>
    );
  }

  const maxBarra = Math.max(...datos.meses.flatMap((m) => [m.ingresosUsd, m.egresosUsd]), 1);
  const maxPatrimonio = Math.max(...historialPatrimonio.map((m) => m.patrimonioUsd), 1);
  const minPatrimonio = Math.min(...historialPatrimonio.map((m) => m.patrimonioUsd), 0);
  const rangoPatrimonio = Math.max(maxPatrimonio - minPatrimonio, 1);
  const maxCategoria = Math.max(...datos.topCategorias.map((c) => c.usd), 1);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="fin-datos-balance">
        <h2 id="fin-datos-balance" className="mb-3 text-base font-bold text-foreground">
          Balance mensual
        </h2>
        <ul className="flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-sm">
          {datos.meses.map((m) => (
            <li key={m.clave} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold capitalize text-muted">{m.etiqueta}</span>
                <span className={`text-sm font-bold ${m.flujoNetoUsd >= 0 ? VERDE : ROJO}`}>
                  {m.flujoNetoUsd >= 0 ? "+" : "−"}
                  {formatearMonto(Math.abs(m.flujoNetoUsd), "USD")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-green-500/80" style={{ width: `${(m.ingresosUsd / maxBarra) * 100}%` }} />
                  </div>
                  <span className={`w-24 shrink-0 text-right text-xs font-semibold ${VERDE}`}>
                    +{formatoCorto(m.ingresosUsd)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-red-500/80" style={{ width: `${(m.egresosUsd / maxBarra) * 100}%` }} />
                  </div>
                  <span className={`w-24 shrink-0 text-right text-xs font-semibold ${ROJO}`}>
                    −{formatoCorto(m.egresosUsd)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fin-datos-patrimonio">
        <h2 id="fin-datos-patrimonio" className="mb-3 text-base font-bold text-foreground">
          Patrimonio en el tiempo
        </h2>
        <div className="rounded-3xl bg-surface p-4 shadow-sm">
          <div className="flex h-36 items-end justify-between gap-2" role="img" aria-label="Evolución del patrimonio en los últimos 6 meses">
            {historialPatrimonio.map((m) => (
              <div key={m.clave} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[10px] font-bold text-foreground">{formatoCorto(m.patrimonioUsd)}</span>
                <div
                  className="w-full max-w-10 rounded-t-lg bg-accent/70"
                  style={{ height: `${Math.max(8, ((m.patrimonioUsd - minPatrimonio) / rangoPatrimonio) * 100)}%` }}
                />
                <span className="text-[10px] font-bold capitalize text-muted">{m.etiqueta}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Reconstruido desde tu patrimonio actual y tus movimientos registrados.
          </p>
        </div>
      </section>

      <section aria-labelledby="fin-datos-categorias">
        <h2 id="fin-datos-categorias" className="mb-3 text-base font-bold text-foreground">
          Dónde se fue el dinero este mes
        </h2>
        {datos.topCategorias.length === 0 ? (
          <p className="text-sm text-muted">Sin egresos este mes.</p>
        ) : (
          <ul className="flex flex-col gap-2.5 rounded-3xl bg-surface p-4 shadow-sm">
            {datos.topCategorias.map((c) => (
              <li key={c.categoria}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{c.categoria}</span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{formatearMonto(c.usd, "USD")}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${(c.usd / maxCategoria) * 100}%` }} />
                </div>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
              <span className="text-sm font-bold text-foreground">Total del mes</span>
              <span className={`text-sm font-bold ${ROJO}`}>−{formatearMonto(datos.totalEgresosMesUsd, "USD")}</span>
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
