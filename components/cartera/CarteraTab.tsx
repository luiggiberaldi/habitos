"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "../core/ui/Select";
import { IconPlus, IconX, IconCheck, IconAlerta } from "../../lib/core/ui/icons";
import {
  listarClientes,
  guardarCliente,
  desactivarCliente,
  verCartera,
  registrarMovimiento,
  formatoMonto,
  MONEDAS_CARTERA,
  TIPOS_CLIENTE,
  type ClienteCartera,
  type DetalleCartera,
  type TipoCliente,
  type TipoMovimiento,
  type MonedaCartera,
  type SaldoMoneda,
} from "../../lib/cartera/cliente";

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const labelCls = "block";
const tituloCls = "text-xs font-bold text-muted";

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function hoyCaracas(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

/** Resumen de saldos: "me deben $50 · les debo Bs 200" */
function ResumenSaldos({ saldos, compacto = false }: { saldos: SaldoMoneda[]; compacto?: boolean }) {
  const vivos = saldos.filter((s) => Number(s.saldo) !== 0);
  if (vivos.length === 0)
    return <span className="text-xs text-muted">Sin saldo pendiente</span>;
  return (
    <span className={`flex flex-wrap gap-x-3 gap-y-0.5 ${compacto ? "text-xs" : "text-sm"}`}>
      {vivos.map((s) => {
        const debe = Number(s.saldo);
        const meDeben = debe > 0;
        return (
          <span
            key={s.moneda}
            className={`font-bold ${meDeben ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {meDeben ? "Me deben " : "Les debo "}
            {formatoMonto(debe, s.moneda)}
          </span>
        );
      })}
    </span>
  );
}

/* ════════════════ Formulario nuevo cliente ════════════════ */

function FormCliente({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoCliente>("cliente");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [notas, setNotas] = useState("");
  const [paso, setPaso] = useState<"form" | "confirmar">("form");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await guardarCliente({ nombre, tipo, telefono, email, notas });
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  if (paso === "confirmar") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-bold text-foreground">Confirmar cliente</h3>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Nombre</dt>
            <dd className="font-bold text-foreground">{nombre.trim()}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Tipo</dt>
            <dd className="font-bold text-foreground">
              {TIPOS_CLIENTE.find((t) => t.value === tipo)?.label}
            </dd>
          </div>
          {telefono.trim() && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Teléfono</dt>
              <dd className="font-bold text-foreground">{telefono.trim()}</dd>
            </div>
          )}
          {email.trim() && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Email</dt>
              <dd className="font-bold text-foreground">{email.trim()}</dd>
            </div>
          )}
        </dl>
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setPaso("form")}
            className="flex-1 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-bold text-foreground"
          >
            Corregir
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={guardar}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            <IconCheck className="h-4 w-4" /> {guardando ? "Guardando…" : "Confirmar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Nuevo cliente</h3>
        <button type="button" aria-label="Cerrar" onClick={onCancelar} className="rounded-full p-1.5 text-muted hover:text-foreground">
          <IconX className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          <span className={tituloCls}>Nombre *</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. María Pérez" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Tipo</span>
          <Select ariaLabel="Tipo de cliente" value={tipo} onChange={(v) => setTipo(v as TipoCliente)} options={TIPOS_CLIENTE.map((t) => ({ value: t.value, label: t.label }))} className="mt-1" />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Teléfono</span>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Opcional" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Opcional" className={inputCls} />
        </label>
      </div>
      <label className={`${labelCls} mt-3`}>
        <span className={tituloCls}>Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Opcional" className={`${inputCls} resize-none`} />
      </label>
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
      )}
      <button
        type="button"
        onClick={() => {
          setError(null);
          if (!nombre.trim()) return setError("El cliente necesita un nombre");
          setPaso("confirmar");
        }}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"
      >
        Revisar y guardar
      </button>
    </div>
  );
}

/* ════════════════ Formulario movimiento ════════════════ */

function FormMovimiento({
  clienteId,
  onListo,
}: {
  clienteId: string;
  onListo: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimiento>("cargo");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<MonedaCartera>("USD");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [paso, setPaso] = useState<"form" | "confirmar">("form");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const montoNum = parseNum(monto);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await registrarMovimiento({ clienteId, tipo, concepto, monto: montoNum, moneda, fecha });
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar");
    } finally {
      setGuardando(false);
    }
  };

  if (paso === "confirmar") {
    return (
      <div className="rounded-xl bg-surface-2 p-3">
        <p className="text-sm text-foreground">
          {tipo === "cargo" ? "Cargar (me debe)" : "Abonar (paga)"}{" "}
          <strong>{formatoMonto(montoNum, moneda)}</strong> — {concepto.trim()}
        </p>
        {error && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
        )}
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setPaso("form")} className="flex-1 rounded-xl bg-surface px-3 py-2 text-xs font-bold text-foreground">
            Corregir
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={guardar}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            <IconCheck className="h-4 w-4" /> {guardando ? "Registrando…" : "Confirmar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className={labelCls}>
          <span className={tituloCls}>Tipo</span>
          <Select ariaLabel="Tipo de movimiento" value={tipo}
            onChange={(v) => setTipo(v as TipoMovimiento)}
            options={[
              { value: "cargo", label: "Cargo (me debe)" },
              { value: "abono", label: "Abono (paga)" },
            ]}
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select ariaLabel="Moneda" value={moneda} onChange={(v) => setMoneda(v as MonedaCartera)} options={MONEDAS_CARTERA.map((m) => ({ value: m.value, label: m.label }))} className="mt-1" />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className={labelCls}>
          <span className={tituloCls}>Monto *</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Fecha</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className={`${labelCls} mt-2`}>
        <span className={tituloCls}>Concepto *</span>
        <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej. Venta de queso" className={inputCls} />
      </label>
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
      )}
      <button
        type="button"
        onClick={() => {
          setError(null);
          if (!concepto.trim()) return setError("El movimiento necesita un concepto");
          if (!(montoNum > 0)) return setError("El monto debe ser mayor a 0");
          setPaso("confirmar");
        }}
        className="mt-2 w-full rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
      >
        Revisar y registrar
      </button>
    </div>
  );
}

/* ════════════════ Fila de cliente ════════════════ */

const TIPO_PILL: Record<TipoCliente, string> = {
  cliente: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  proveedor: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  ambos: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const TIPO_TXT: Record<TipoCliente, string> = {
  cliente: "Cliente",
  proveedor: "Proveedor",
  ambos: "Ambos",
};

function FilaCliente({ cliente, onCambio }: { cliente: ClienteCartera; onCambio: () => void }) {
  const [expandido, setExpandido] = useState(false);
  const [detalle, setDetalle] = useState<DetalleCartera | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = async () => {
    const nuevo = !expandido;
    setExpandido(nuevo);
    if (nuevo && !detalle) {
      setCargandoDetalle(true);
      try {
        setDetalle(await verCartera(cliente.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar la cartera");
      } finally {
        setCargandoDetalle(false);
      }
    }
  };

  const recargarDetalle = async () => {
    try {
      setDetalle(await verCartera(cliente.id));
    } catch {
      /* noop */
    }
    onCambio();
  };

  const desactivar = async () => {
    setError(null);
    setTrabajando(true);
    try {
      await desactivarCliente(cliente.id);
      setConfirmarDesactivar(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desactivar");
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <button type="button" onClick={alternar} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={expandido}>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{cliente.nombre}</p>
          <div className="mt-0.5">
            <ResumenSaldos saldos={cliente.saldos} compacto />
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TIPO_PILL[cliente.tipo]}`}>
          {TIPO_TXT[cliente.tipo]}
        </span>
      </button>

      {expandido && (
        <div className="mt-3 border-t border-border pt-3">
          {cargandoDetalle ? (
            <p className="text-xs text-muted">Cargando cartera…</p>
          ) : detalle ? (
            <>
              <div className="flex flex-col gap-1">
                {detalle.saldos.length === 0 ? (
                  <p className="text-xs text-muted">Sin movimientos todavía.</p>
                ) : (
                  detalle.saldos.map((s) => (
                    <div key={s.moneda} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
                      <span className="text-xs font-bold text-muted">{s.moneda}</span>
                      <span className="text-xs text-muted">
                        Cargos {formatoMonto(Number(s.cargos ?? 0), s.moneda)} · Abonos{" "}
                        {formatoMonto(Number(s.abonos ?? 0), s.moneda)}
                      </span>
                      <span
                        className={`text-sm font-bold ${Number(s.saldo) > 0 ? "text-emerald-600 dark:text-emerald-400" : Number(s.saldo) < 0 ? "text-red-600 dark:text-red-400" : "text-muted"}`}
                      >
                        {Number(s.saldo) > 0 ? "Me deben " : Number(s.saldo) < 0 ? "Les debo " : ""}
                        {formatoMonto(Number(s.saldo), s.moneda)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {detalle.movimientos.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {detalle.movimientos.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{m.concepto}</p>
                        <p className="text-muted">
                          {m.tipo === "cargo" ? "Cargo" : "Abono"} · {m.fecha}
                        </p>
                      </div>
                      <span className={`shrink-0 font-bold ${m.tipo === "cargo" ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}`}>
                        {m.tipo === "cargo" ? "+" : "−"}{formatoMonto(Number(m.monto), m.moneda)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3">
                <FormMovimiento clienteId={cliente.id} onListo={recargarDetalle} />
              </div>
            </>
          ) : null}

          {error && (
            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
          )}

          <div className="mt-3">
            {confirmarDesactivar ? (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 dark:bg-red-900/20">
                <p className="flex-1 text-xs font-bold text-red-700 dark:text-red-300">
                  ¿Desactivar a {cliente.nombre}? Su historial se conserva.
                </p>
                <button type="button" disabled={trabajando} onClick={desactivar} className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  Sí
                </button>
                <button type="button" onClick={() => setConfirmarDesactivar(false)} className="rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold text-foreground">
                  No
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmarDesactivar(true)} className="text-xs font-bold text-muted hover:text-red-600">
                Desactivar cliente
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/* ════════════════ Pestaña ════════════════ */

export function CarteraTab() {
  const [clientes, setClientes] = useState<ClienteCartera[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      setClientes(await listarClientes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los clientes");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await listarClientes();
        if (vivo) setClientes(lista);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los clientes");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const activos = clientes.filter((c) => c.activo);
    if (!q) return activos;
    return activos.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [clientes, busqueda]);

  const totalMeDeben = useMemo(() => {
    // Conteo simple en USD para el encabezado (otras monedas se ven por cliente)
    return filtrados.reduce(
      (acc, c) =>
        acc +
        c.saldos
          .filter((s) => s.moneda === "USD" && Number(s.saldo) > 0)
          .reduce((a, s) => a + Number(s.saldo), 0),
      0
    );
  }, [filtrados]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">Cartera</h2>
          {totalMeDeben > 0 && (
            <p className="text-xs text-muted">
              Te deben <strong className="text-emerald-600 dark:text-emerald-400">{formatoMonto(totalMeDeben, "USD")}</strong> en USD
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
        >
          {mostrarForm ? <IconX className="h-4 w-4" /> : <IconPlus className="h-4 w-4" />}
          {mostrarForm ? "Cerrar" : "Cliente"}
        </button>
      </div>

      {mostrarForm && (
        <FormCliente
          onListo={() => {
            setMostrarForm(false);
            cargar();
          }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar cliente…"
        className="w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />

      {error && (
        <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : filtrados.length === 0 ? (
        <p className="text-sm text-muted">
          {busqueda ? "Ningún cliente coincide con la búsqueda." : "Aún no hay clientes. Agrega el primero para llevar su cartera."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtrados.map((c) => (
            <FilaCliente key={c.id} cliente={c} onCambio={cargar} />
          ))}
        </ul>
      )}
    </div>
  );
}
