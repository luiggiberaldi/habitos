"use client";

import { useEffect, useState } from "react";
import {
  obtenerTasas,
  formatoBs,
  formatoFechaCorta,
  type TasasDelDia,
} from "../lib/core/tasas";
import {
  IconActualizar,
  IconAlerta,
  IconEstadisticas,
} from "../lib/core/ui/icons";

/**
 * Tarjeta "Tasas del día" del hub. Muestra BCV ($), Euro (BCV) y USDT con
 * fecha y fuente. Fallback en cadena: refresca al abrir; si falla, muestra la
 * última guardada marcada como desactualizada.
 */
export default function TarjetaTasas() {
  const [tasas, setTasas] = useState<TasasDelDia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const t = await obtenerTasas(false);
        if (vivo) setTasas(t);
      } catch (e) {
        if (vivo) {
          setError(
            e instanceof Error ? e.message : "No se pudieron cargar las tasas",
          );
        }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const actualizar = async () => {
    setActualizando(true);
    setError(null);
    try {
      setTasas(await obtenerTasas(true));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudieron actualizar las tasas",
      );
    } finally {
      setActualizando(false);
    }
  };

  const filas = tasas
    ? [
        { nombre: "BCV", valor: tasas.bcv },
        { nombre: "Euro BCV", valor: tasas.euro },
        { nombre: "USDT", valor: tasas.usdt },
      ]
    : [];

  return (
    <section
      aria-label="Tasas del día"
      className="rounded-3xl bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "#E8F0F3" }}
        >
          <IconEstadisticas className="h-6 w-6 text-[#0C3544]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-foreground">Tasas del día</h2>
          <p className="text-xs text-muted">
            {tasas
              ? `Actualizado ${formatoFechaCorta(tasas.fecha)} · ${tasas.fuente || "—"}`
              : "Cargando…"}
          </p>
        </div>
        {tasas?.desactualizada && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            <IconAlerta className="h-3 w-3" aria-hidden="true" />
            Desactualizada
          </span>
        )}
        <button
          type="button"
          onClick={actualizar}
          disabled={actualizando || cargando}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
          aria-label="Actualizar tasas"
        >
          <IconActualizar
            className={`h-3.5 w-3.5 ${actualizando ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {actualizando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {cargando ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      ) : tasas ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {filas.map((f) => (
            <div key={f.nombre} className="rounded-2xl bg-surface-2 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                {f.nombre}
              </p>
              <p className="mt-0.5 text-sm font-bold text-foreground">
                {formatoBs(f.valor)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
          <IconAlerta className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </section>
  );
}
