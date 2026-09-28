"use client";

import { useEffect, useState } from "react";
import {
  obtenerTasas,
  guardarTasasManual,
  formatoBs,
  formatoFechaCorta,
  type TasasDelDia,
} from "../lib/core/tasas";
import {
  IconActualizar,
  IconAlerta,
  IconCheck,
  IconEstadisticas,
  IconX,
} from "../lib/core/ui/icons";

/** Convierte "855,66" o "855.66" a número. */
function parsearMonto(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Tarjeta "Tasas del día" del hub. Muestra BCV, paralelo y USDT con fecha y
 * fuente. Fallback en cadena: refresca al abrir; si falla, muestra la última
 * guardada marcada como desactualizada; siempre ofrece el ingreso manual.
 */
export default function TarjetaTasas() {
  const [tasas, setTasas] = useState<TasasDelDia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [fBcv, setFBcv] = useState("");
  const [fParalelo, setFParalelo] = useState("");
  const [fUsdt, setFUsdt] = useState("");
  const [guardando, setGuardando] = useState(false);

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

  const guardarManual = async () => {
    const bcv = parsearMonto(fBcv);
    const paralelo = parsearMonto(fParalelo);
    const usdt = parsearMonto(fUsdt);
    if (bcv === null && paralelo === null && usdt === null) {
      setError("Escribe al menos una tasa válida para guardar");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const t = await guardarTasasManual({
        ...(bcv !== null ? { bcv } : {}),
        ...(paralelo !== null ? { paralelo } : {}),
        ...(usdt !== null ? { usdt } : {}),
      });
      setTasas(t);
      setManualAbierto(false);
      setFBcv("");
      setFParalelo("");
      setFUsdt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const filas = tasas
    ? [
        { nombre: "BCV", valor: tasas.bcv },
        { nombre: "Paralelo", valor: tasas.paralelo },
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
          <p className="truncate text-xs text-muted">
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

      <div className="mt-3">
        {!manualAbierto ? (
          <button
            type="button"
            onClick={() => setManualAbierto(true)}
            className="text-xs font-bold text-accent hover:opacity-80"
          >
            Ingresar tasas manualmente
          </button>
        ) : (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs font-bold text-foreground">
              Tasas manuales
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { etiqueta: "BCV", valor: fBcv, set: setFBcv },
                { etiqueta: "Paralelo", valor: fParalelo, set: setFParalelo },
                { etiqueta: "USDT", valor: fUsdt, set: setFUsdt },
              ].map((c) => (
                <label key={c.etiqueta} className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                    {c.etiqueta}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={c.valor}
                    onChange={(e) => c.set(e.target.value)}
                    placeholder="0,00"
                    className="mt-1 w-full rounded-xl border border-transparent bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={guardarManual}
                disabled={guardando}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setManualAbierto(false);
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-xs font-bold text-muted transition-opacity hover:opacity-80"
              >
                <IconX className="h-3.5 w-3.5" aria-hidden="true" />
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
