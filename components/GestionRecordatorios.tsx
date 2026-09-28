"use client";

import { useEffect, useState } from "react";
import {
  cancelarRecordatorio,
  crearRecordatorio,
  listarPendientes,
  type Recordatorio,
  type ReglaRecurrencia,
} from "../lib/core/recordatorios";
import {
  IconAlerta,
  IconBorrar,
  IconCampana,
  IconCheck,
  IconPlus,
} from "../lib/core/ui/icons";
import { Select } from "./core/ui/Select";

function formatoFechaHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Valor por defecto para el datetime-local: ahora + 15 minutos. */
function defectoFechaHora(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const RECURRENCIAS: { valor: "" | ReglaRecurrencia; etiqueta: string }[] = [
  { valor: "", etiqueta: "Una sola vez" },
  { valor: "diaria", etiqueta: "Diaria" },
  { valor: "semanal", etiqueta: "Semanal" },
  { valor: "mensual", etiqueta: "Mensual" },
];

/**
 * Gestión de recordatorios genéricos (Fase 0.5). Crear, listar pendientes y
 * cancelar. El envío lo hace la Edge Function cada minuto.
 */
export default function GestionRecordatorios() {
  const [pendientes, setPendientes] = useState<Recordatorio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [fechaHora, setFechaHora] = useState(defectoFechaHora);
  const [recurrencia, setRecurrencia] = useState<"" | ReglaRecurrencia>("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const recargar = async () => {
    try {
      setPendientes(await listarPendientes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await listarPendientes();
        if (vivo) setPendientes(lista);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const crear = async () => {
    if (!titulo.trim()) {
      setError("Escribe un título para el recordatorio");
      return;
    }
    const cuando = new Date(fechaHora);
    if (Number.isNaN(cuando.getTime())) {
      setError("Fecha y hora inválidas");
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await crearRecordatorio({
        titulo,
        cuerpo,
        programadoPara: cuando,
        modulo: "sistema",
        reglaRecurrencia: recurrencia || null,
      });
      setTitulo("");
      setCuerpo("");
      setFechaHora(defectoFechaHora());
      setRecurrencia("");
      setOk("Recordatorio creado. Llegará como push a la hora indicada.");
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = async (id: string) => {
    setError(null);
    try {
      await cancelarRecordatorio(id);
      setPendientes((ps) => ps.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar");
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-label="Recordatorios">
      <div className="flex items-center gap-3">
        <IconCampana className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Recordatorios</h2>
          <p className="text-sm text-muted">
            Avisos programados que llegan como push, de cualquier módulo.
          </p>
        </div>
      </div>

      {/* Crear */}
      <div className="mt-4 rounded-2xl bg-surface-2 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-bold text-muted">Título</span>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="p. ej. Pagar el internet"
              maxLength={120}
              className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-bold text-muted">Detalle (opcional)</span>
            <input
              type="text"
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              placeholder="p. ej. Vence mañana"
              maxLength={200}
              className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-muted">Fecha y hora</span>
            <input
              type="datetime-local"
              value={fechaHora}
              onChange={(e) => setFechaHora(e.target.value)}
              className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-muted">Repetición</span>
            <Select
              value={recurrencia}
              options={RECURRENCIAS.map((r) => ({
                value: r.valor,
                label: r.etiqueta,
              }))}
              onChange={(v) => setRecurrencia(v as "" | ReglaRecurrencia)}
              ariaLabel="Repetición"
              className="mt-1"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={crear}
          disabled={guardando}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {guardando ? "Creando…" : "Crear recordatorio"}
        </button>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
          <IconAlerta className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600">
          <IconCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {ok}
        </p>
      )}

      {/* Pendientes */}
      <div className="mt-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
          Pendientes ({pendientes.length})
        </h3>
        {cargando ? (
          <div className="mt-2 h-12 animate-pulse rounded-2xl bg-surface-2" />
        ) : pendientes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No hay recordatorios pendientes.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {pendientes.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">
                    {r.titulo}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatoFechaHora(r.programado_para)}
                    {r.regla_recurrencia ? ` · ${r.regla_recurrencia}` : ""}
                    {r.cuerpo ? ` · ${r.cuerpo}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelar(r.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold text-muted transition-colors hover:bg-surface hover:text-red-600"
                  aria-label={`Cancelar recordatorio ${r.titulo}`}
                >
                  <IconBorrar className="h-4 w-4" aria-hidden="true" />
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
