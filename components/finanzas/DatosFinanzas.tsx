"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatearMonto,
  obtenerDatosFinanzas,
  type FinDatos,
} from "../../lib/finanzas/finanzas";
import { IconAlerta } from "../../lib/core/ui/icons";
import { flameGradientX } from "../../lib/core/ui/design-tokens";

const VERDE = "text-green-700 dark:text-green-400";
const ROJO = "text-red-700 dark:text-red-400";

/** Formato corto: $ 1,2k cuando el número es grande. */
function formatoCorto(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 10000) return `$ ${(usd / 1000).toFixed(1).replace(".", ",")}k`;
  return formatearMonto(usd, "USD");
}

/** Sub-fila de ingresos/egresos dentro de un mes: etiqueta + barra + valor. */
function BarraMes({
  etiqueta,
  valor,
  max,
  colorBarra,
  colorTexto,
  signo,
}: {
  etiqueta: string;
  valor: number;
  max: number;
  colorBarra: string;
  colorTexto: string;
  signo: "+" | "−";
}) {
  const ancho = valor > 0 ? Math.max(3, (valor / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] font-semibold text-muted">{etiqueta}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${colorBarra}`}
          style={{ width: `${ancho}%` }}
          title={`${etiqueta}: ${formatearMonto(valor, "USD")}`}
        />
      </div>
      <span className={`w-20 shrink-0 text-right text-xs font-bold ${colorTexto}`}>
        {signo}
        {formatoCorto(valor)}
      </span>
    </div>
  );
}

/**
 * Vista "Datos" de Finanzas: balance de los meses con movimientos (los meses
 * en 0 no se muestran), evolución del patrimonio (reconstruida desde el
 * patrimonio actual menos los flujos posteriores) y categorías con más
 * gasto en el mes actual. Tono serio.
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

  // Solo meses con movimientos: estamos empezando, los meses viejos en 0 no se muestran.
  const mesesConDatos = useMemo(
    () => (datos ? datos.meses.filter((m) => m.ingresosUsd > 0 || m.egresosUsd > 0) : []),
    [datos]
  );

  const historialPatrimonio = useMemo(() => {
    // P(fin de mes i) = patrimonio actual − flujos netos posteriores a i.
    const flujos = mesesConDatos.map((m) => m.flujoNetoUsd);
    return mesesConDatos.map((m, i) => {
      const posteriores = flujos.slice(i + 1).reduce((a, b) => a + b, 0);
      return { ...m, patrimonioUsd: Math.round((patrimonio - posteriores) * 100) / 100 };
    });
  }, [mesesConDatos, patrimonio]);

  if (cargando) return <p className="text-sm text-muted">Cargando datos…</p>;
  if (error)
    return (
      <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
        <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  if (!datos) return null;

  if (mesesConDatos.length === 0) {
    return (
      <div className="rounded-3xl bg-surface p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-foreground">Aún no hay datos</p>
        <p className="mt-1 text-sm text-muted">
          Registra ingresos y egresos y aquí verás tu balance, tu patrimonio en el tiempo y en qué se va el dinero.
        </p>
      </div>
    );
  }

  const maxBarra = Math.max(...mesesConDatos.flatMap((m) => [m.ingresosUsd, m.egresosUsd]), 1);
  const maxPatrimonio = Math.max(...historialPatrimonio.map((m) => m.patrimonioUsd), 1);
  const minPatrimonio = Math.min(...historialPatrimonio.map((m) => m.patrimonioUsd), 0);
  const rangoPatrimonio = Math.max(maxPatrimonio - minPatrimonio, 1);
  const maxCategoria = Math.max(...datos.topCategorias.map((c) => c.usd), 1);
  const deltaPatrimonio =
    historialPatrimonio.length > 0
      ? historialPatrimonio[historialPatrimonio.length - 1].patrimonioUsd - historialPatrimonio[0].patrimonioUsd
      : 0;
  const etiquetaPeriodo =
    mesesConDatos.length >= 6 ? "en 6 meses" : mesesConDatos.length > 1 ? "en el período" : "este mes";
  const ariaPatrimonio = `Evolución del patrimonio ${etiquetaPeriodo}`;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="fin-datos-balance">
        <h2 id="fin-datos-balance" className="mb-3 text-base font-bold text-foreground">
          Balance mensual
        </h2>
        <ul className="divide-y divide-border rounded-3xl bg-surface px-4 py-1 shadow-sm">
          {mesesConDatos.map((m) => (
            <li key={m.clave} className="flex flex-col gap-2 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{m.etiqueta}</span>
                <span className={`text-lg font-extrabold ${m.flujoNetoUsd >= 0 ? VERDE : ROJO}`}>
                  {m.flujoNetoUsd >= 0 ? "+" : "−"}
                  {formatearMonto(Math.abs(m.flujoNetoUsd), "USD")}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <BarraMes
                  etiqueta="Ingresos"
                  valor={m.ingresosUsd}
                  max={maxBarra}
                  colorBarra="bg-green-500"
                  colorTexto={VERDE}
                  signo="+"
                />
                <BarraMes
                  etiqueta="Egresos"
                  valor={m.egresosUsd}
                  max={maxBarra}
                  colorBarra="bg-accent"
                  colorTexto={ROJO}
                  signo="−"
                />
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
          <div
            className="flex h-40 items-end justify-between gap-2"
            role="img"
            aria-label={ariaPatrimonio}
          >
            {historialPatrimonio.map((m, i) => {
              const esActual = i === historialPatrimonio.length - 1;
              return (
                <div key={m.clave} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  <span className={`text-[10px] font-bold ${esActual ? "text-accent" : "text-foreground"}`}>
                    {formatoCorto(m.patrimonioUsd)}
                  </span>
                  <div
                    className={`w-full max-w-10 rounded-t-full ${esActual ? "" : "bg-accent/30"}`}
                    style={{
                      height: `${Math.max(10, ((m.patrimonioUsd - minPatrimonio) / rangoPatrimonio) * 100)}%`,
                      ...(esActual ? { background: flameGradientX } : {}),
                    }}
                    title={`${m.etiqueta}: ${formatearMonto(m.patrimonioUsd, "USD")}`}
                  />
                  <span className={`text-[10px] font-bold capitalize ${esActual ? "text-accent" : "text-muted"}`}>
                    {m.etiqueta}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs font-semibold text-muted">Variación {etiquetaPeriodo}</span>
            <span className={`text-sm font-extrabold ${deltaPatrimonio >= 0 ? VERDE : ROJO}`}>
              {deltaPatrimonio >= 0 ? "+" : "−"}
              {formatearMonto(Math.abs(deltaPatrimonio), "USD")}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
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
