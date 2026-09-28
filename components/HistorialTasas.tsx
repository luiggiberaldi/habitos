"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatoBs,
  obtenerHistorialTasas,
  type FilaTasa,
} from "../lib/core/tasas";
import {
  IconAlerta,
  IconTendenciaBaja,
  IconTendenciaSube,
} from "../lib/core/ui/icons";

type ClaveTasa = "bcv" | "euro" | "usdt";

const TASAS: Array<{ clave: ClaveTasa; nombre: string }> = [
  { clave: "bcv", nombre: "BCV" },
  { clave: "euro", nombre: "Euro" },
  { clave: "usdt", nombre: "USDT" },
];

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-09-28" − n días → "2026-09-21". */
function restarDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  f.setUTCDate(f.getUTCDate() - n);
  return f.toISOString().slice(0, 10);
}

/** Día de semana (0=dom) de una fecha ISO, en hora de Caracas. */
function diaSemana(iso: string): number {
  return new Date(`${iso}T12:00:00-04:00`).getDay();
}

function pct(actual: number, base: number): number {
  return ((actual - base) / base) * 100;
}

function formatoPct(v: number | null): string {
  if (v === null || !isFinite(v)) return "—";
  const signo = v > 0 ? "+" : "";
  return `${signo}${v.toFixed(1).replace(".", ",")}%`;
}

/** Valor de la serie más cercano a `objetivo` sin pasarse (tolerancia 3 días). */
function valorCercano(
  serie: FilaTasa[],
  clave: ClaveTasa,
  objetivo: string,
): number | null {
  for (const f of [...serie].reverse()) {
    if (f.fecha <= objetivo && f[clave] !== null) {
      // acepta hasta 3 días de desfase; si el hueco es mayor, no hay dato
      if (restarDias(objetivo, 3) <= f.fecha) return f[clave];
      return null;
    }
  }
  return null;
}

function Sparkline({ valores }: { valores: number[] }) {
  const puntos = useMemo(() => {
    if (valores.length < 2) return "";
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const rango = max - min || 1;
    return valores
      .map((v, i) => {
        const x = (i / (valores.length - 1)) * 100;
        const y = 30 - ((v - min) / rango) * 28;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [valores]);
  if (valores.length < 2) {
    return <p className="text-xs text-muted">Sin datos suficientes</p>;
  }
  const sube = valores[valores.length - 1] >= valores[0];
  return (
    <svg
      viewBox="0 0 100 32"
      className="h-8 w-full"
      role="img"
      aria-label={sube ? "Tendencia al alza" : "Tendencia a la baja"}
      preserveAspectRatio="none"
    >
      <polyline
        points={puntos}
        fill="none"
        stroke={sube ? "#16a34a" : "#dc2626"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

type TendenciaDia = {
  clave: ClaveTasa;
  nombre: string;
  sube: { dia: string; prom: number } | null;
  baja: { dia: string; prom: number } | null;
};

export default function HistorialTasas() {
  const [filas, setFilas] = useState<FilaTasa[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    obtenerHistorialTasas(90)
      .then((f) => vivo && setFilas(f))
      .catch((e) =>
        vivo && setError(e instanceof Error ? e.message : "No se pudo cargar"),
      );
    return () => {
      vivo = false;
    };
  }, []);

  const resumen = useMemo(() => {
    if (!filas || filas.length === 0) return null;
    const ultima = filas[filas.length - 1];
    return TASAS.map(({ clave, nombre }) => {
      const serie = filas.filter((f) => f[clave] !== null);
      const actual = ultima[clave];
      const v7 = actual !== null ? valorCercano(serie, clave, restarDias(ultima.fecha, 7)) : null;
      const v30 = actual !== null ? valorCercano(serie, clave, restarDias(ultima.fecha, 30)) : null;
      return {
        clave,
        nombre,
        actual,
        pct7: actual !== null && v7 ? pct(actual, v7) : null,
        pct30: actual !== null && v30 ? pct(actual, v30) : null,
        valores: serie.slice(-30).map((f) => f[clave] as number),
      };
    });
  }, [filas]);

  const tendencias: TendenciaDia[] | null = useMemo(() => {
    if (!filas || filas.length < 8) return null;
    return TASAS.map(({ clave, nombre }) => {
      // cambios diarios atribuidos al día de la fila nueva
      const porDia: number[][] = Array.from({ length: 7 }, () => []);
      for (let i = 1; i < filas.length; i++) {
        const a = filas[i - 1][clave];
        const b = filas[i][clave];
        if (a !== null && b !== null && a > 0) {
          porDia[diaSemana(filas[i].fecha)].push(pct(b, a));
        }
      }
      const proms = porDia.map((arr, d) =>
        arr.length >= 4
          ? { dia: DIAS[d], prom: arr.reduce((s, v) => s + v, 0) / arr.length }
          : null,
      );
      const validos = proms.filter((p) => p !== null);
      if (validos.length < 2) return { clave, nombre, sube: null, baja: null };
      const sube = validos.reduce((m, p) => (p!.prom > m!.prom ? p : m));
      const baja = validos.reduce((m, p) => (p!.prom < m!.prom ? p : m));
      return { clave, nombre, sube, baja };
    });
  }, [filas]);

  if (error) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
        <IconAlerta className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  }

  if (!filas || !resumen) {
    return (
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    );
  }

  const hayTendencia = tendencias?.some((t) => t.sube && t.baja) ?? false;

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {resumen.map((r) => (
          <div key={r.clave} className="rounded-2xl bg-surface-2 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              {r.nombre}
            </p>
            <p className="mt-0.5 text-sm font-bold text-foreground">
              {formatoBs(r.actual)}
            </p>
            <div className="mt-1.5">
              <Sparkline valores={r.valores} />
            </div>
            <div className="mt-1.5 space-y-0.5">
              {[
                { etiqueta: "7d", v: r.pct7 },
                { etiqueta: "30d", v: r.pct30 },
              ].map(({ etiqueta, v }) => (
                <p
                  key={etiqueta}
                  className={`flex items-center gap-1 text-[11px] font-semibold ${
                    v === null
                      ? "text-muted"
                      : v > 0
                        ? "text-green-700"
                        : v < 0
                          ? "text-red-600"
                          : "text-muted"
                  }`}
                >
                  {v !== null &&
                    (v > 0 ? (
                      <IconTendenciaSube className="h-3 w-3" aria-hidden="true" />
                    ) : v < 0 ? (
                      <IconTendenciaBaja className="h-3 w-3" aria-hidden="true" />
                    ) : null)}
                  {etiqueta}: {formatoPct(v)}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
          Tendencia por día de semana
        </p>
        {hayTendencia ? (
          <ul className="mt-1.5 space-y-1.5">
            {tendencias!.filter((t) => t.sube && t.baja).map((t) => (
              <li key={t.clave} className="text-xs text-foreground">
                <span className="font-bold">{t.nombre}:</span> suele subir los{" "}
                <span className="font-semibold text-green-700">
                  {t.sube!.dia} ({formatoPct(t.sube!.prom)} prom.)
                </span>{" "}
                y bajar los{" "}
                <span className="font-semibold text-red-600">
                  {t.baja!.dia} ({formatoPct(t.baja!.prom)} prom.)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Todavía hay pocos días registrados; esta estadística se irá
            formando sola con el paso de las semanas.
          </p>
        )}
      </div>

      <p className="text-[11px] text-muted">
        {filas.length} día{filas.length === 1 ? "" : "s"} registrados · el
        historial se actualiza solo cada día
      </p>
    </div>
  );
}
