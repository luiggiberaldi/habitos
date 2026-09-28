"use client";

import { useEffect, useState } from "react";
import {
  gastoMensualMercado,
  merRpc,
  type MerGastoMensual,
} from "../../lib/mercado/mercado";
import type { MerInventarioItem, MerPresupuesto } from "../../lib/mercado/types";
import { IconAlerta } from "../../lib/core/ui/icons";

const fmtUsd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `$${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/**
 * Vista "Datos" de Mercado: presupuesto mensual estimado frente al gasto
 * real, productos donde más se gastó y precios que vienen subiendo.
 * Tono serio, sin gamificación.
 */
export function DatosMercado() {
  const [presupuesto, setPresupuesto] = useState<MerPresupuesto | null>(null);
  const [gasto, setGasto] = useState<MerGastoMensual | null>(null);
  const [alzas, setAlzas] = useState<MerInventarioItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, g, inv] = await Promise.all([
          merRpc.presupuesto(),
          gastoMensualMercado(),
          merRpc.inventario(),
        ]);
        if (!vivo) return;
        setPresupuesto(p);
        setGasto(g);
        setAlzas(
          inv
            .filter((it) => (it.variacion_pct ?? 0) > 0)
            .sort((a, b) => (b.variacion_pct ?? 0) - (a.variacion_pct ?? 0))
            .slice(0, 5),
        );
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los datos");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (cargando) return <p className="text-sm text-muted">Cargando datos…</p>;
  if (error)
    return (
      <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
        <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  if (!presupuesto || !gasto) return null;

  const hayDatos = gasto.nCompras > 0 || presupuesto.total_usd > 0;
  if (!hayDatos) {
    return (
      <div className="rounded-3xl bg-surface p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-foreground">Aún no hay datos</p>
        <p className="mt-1 text-sm text-muted">
          Registra compras y aquí verás tu presupuesto frente al gasto real, tus productos top y los precios que suben.
        </p>
      </div>
    );
  }

  const pctEjecutado = presupuesto.total_usd > 0 ? (gasto.totalUsd / presupuesto.total_usd) * 100 : 0;
  const excedido = pctEjecutado > 100;
  const maxProducto = Math.max(...gasto.porProducto.map((p) => p.usd), 1);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="mer-datos-presupuesto">
        <h2 id="mer-datos-presupuesto" className="mb-3 text-base font-bold text-foreground">
          Presupuesto del mes
        </h2>
        <div className="rounded-3xl bg-surface p-4 shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm text-muted">Gastado de lo estimado</p>
            <p className={`text-lg font-bold ${excedido ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
              {fmtUsd(gasto.totalUsd)} <span className="text-sm font-medium text-muted">/ {fmtUsd(presupuesto.total_usd)}</span>
            </p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all ${excedido ? "bg-red-500" : "bg-accent"}`}
              style={{ width: `${Math.min(100, pctEjecutado)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {presupuesto.total_usd > 0
              ? `${Math.round(pctEjecutado)}% ejecutado · ${gasto.nCompras} compra${gasto.nCompras !== 1 ? "s" : ""} este mes`
              : `${gasto.nCompras} compra${gasto.nCompras !== 1 ? "s" : ""} este mes`}
          </p>
        </div>
      </section>

      <section aria-labelledby="mer-datos-top">
        <h2 id="mer-datos-top" className="mb-3 text-base font-bold text-foreground">
          Dónde se fue el mercado este mes
        </h2>
        {gasto.porProducto.length === 0 ? (
          <p className="text-sm text-muted">Sin compras registradas este mes.</p>
        ) : (
          <ul className="flex flex-col gap-2.5 rounded-3xl bg-surface p-4 shadow-sm">
            {gasto.porProducto.map((p) => (
              <li key={p.nombre}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{p.nombre}</span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{fmtUsd(p.usd)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${(p.usd / maxProducto) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mer-datos-alzas">
        <h2 id="mer-datos-alzas" className="mb-3 text-base font-bold text-foreground">
          Precios al alza
        </h2>
        {alzas.length === 0 ? (
          <p className="text-sm text-muted">Ningún producto con subidas registradas.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {alzas.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 shadow-sm">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{it.nombre}</span>
                  <span className="block text-xs text-muted">{fmtUsd(it.precio_usd_unitario)}/{it.unidad}</span>
                </span>
                <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  +{Math.round(it.variacion_pct ?? 0)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
