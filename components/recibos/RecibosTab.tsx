"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "../core/ui/Select";
import {
  IconPlus,
  IconX,
  IconCheck,
  IconAlerta,
  IconBorrar,
} from "../../lib/core/ui/icons";
import type { FinMoneda } from "../../lib/finanzas/types";
import {
  listarRecibos,
  crearRecibo,
  anularRecibo,
  abonarRecibo,
  descargarPdf,
  filaARecibo,
  type ReciboFila,
  type EmisorRecibo,
  type ItemNuevo,
  type NuevoRecibo,
} from "../../lib/recibos/cliente";
import { computeTotals } from "../../lib/recibos/calculos";
import { formatCurrency, formatDate } from "../../lib/recibos/formato";
import type { PaymentMethod } from "../../lib/recibos/tipos";

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const labelCls = "block";
const tituloCls = "text-xs font-bold text-muted";

const MONEDAS: { value: FinMoneda; label: string }[] = [
  { value: "USD", label: "USD ($)" },
  { value: "VES", label: "VES (Bs)" },
  { value: "USDT", label: "USDT" },
  { value: "COP", label: "COP" },
];

const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "transfer", label: "Transferencia" },
  { value: "mobile", label: "Pago móvil" },
  { value: "cash", label: "Efectivo" },
  { value: "zelle", label: "Zelle" },
  { value: "card", label: "Tarjeta" },
  { value: "other", label: "Otro" },
];

const ESTADO_PILL: Record<ReciboFila["estado"], string> = {
  pendiente: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  parcial: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  pagado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  anulado: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const ESTADO_TXT: Record<ReciboFila["estado"], string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  pagado: "Pagado",
  anulado: "Anulado",
};

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const EMISOR_KEY = "senda-recibo-emisor";

function leerEmisor(): EmisorRecibo {
  try {
    const raw = localStorage.getItem(EMISOR_KEY);
    if (raw) return JSON.parse(raw) as EmisorRecibo;
  } catch {
    /* noop */
  }
  return { nombre: "", doc: "", telefono: "", email: "", direccion: "" };
}

/* ════════════════ Editor ════════════════ */

function EditorRecibo({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [emisor, setEmisor] = useState<EmisorRecibo>(leerEmisor);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteCiudad, setClienteCiudad] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [moneda, setMoneda] = useState<FinMoneda>("USD");
  const [items, setItems] = useState<ItemNuevo[]>([
    { descripcion: "", cantidad: 1, precio: 0, descuento: 0 },
  ]);
  const [descuentoGlobal, setDescuentoGlobal] = useState("");
  const [impuesto, setImpuesto] = useState("");
  const [notas, setNotas] = useState("");
  const [paso, setPaso] = useState<"form" | "confirmar" | "listo">("form");
  const [numeroCreado, setNumeroCreado] = useState("");
  const [idCreado, setIdCreado] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totales = useMemo(() => {
    const receipt = filaARecibo({
      id: "", numero: "", estado: "pendiente", moneda,
      cliente_nombre: clienteNombre, snapshot: {}, total: 0,
      total_pagado: 0, saldo: 0, fecha_emision: "", fecha_vencimiento: null, creado_en: "",
    });
    receipt.items = items.map((it, i) => ({
      id: `it-${i}`,
      description: it.descripcion,
      quantity: Math.max(0, parseNum(String(it.cantidad))),
      unitPrice: Math.max(0, parseNum(String(it.precio))),
      discount: Math.min(100, Math.max(0, parseNum(String(it.descuento)))),
    }));
    receipt.globalDiscount = Math.min(100, Math.max(0, parseNum(descuentoGlobal)));
    receipt.taxRate = Math.max(0, parseNum(impuesto));
    return computeTotals(receipt);
  }, [items, moneda, clienteNombre, descuentoGlobal, impuesto]);

  const setItem = (i: number, campo: keyof ItemNuevo, valor: string | number) => {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [campo]: valor } : it)));
  };

  const confirmar = async () => {
    setError(null);
    setGuardando(true);
    try {
      const input: NuevoRecibo = {
        emisor, clienteNombre, clienteTelefono, clienteEmail, clienteCiudad,
        vencimiento, moneda, items,
        descuentoGlobal: parseNum(descuentoGlobal),
        impuesto: parseNum(impuesto),
        notas,
      };
      const r = await crearRecibo(input);
      try {
        localStorage.setItem(EMISOR_KEY, JSON.stringify(emisor));
      } catch {
        /* noop */
      }
      setNumeroCreado(r.numero);
      setIdCreado(r.id);
      setPaso("listo");
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el recibo");
      setPaso("form");
    } finally {
      setGuardando(false);
    }
  };

  if (paso === "listo") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 text-center">
        <p className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <IconCheck className="h-5 w-5" />
        </p>
        <p className="text-base font-bold text-foreground">Recibo {numeroCreado} creado</p>
        <p className="mt-1 text-sm text-muted">
          Total {formatCurrency(totales.total, moneda)} · {clienteNombre}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              listarRecibos()
                .then((rs) => {
                  const f = rs.find((x) => x.id === idCreado);
                  if (f) descargarPdf(f);
                })
                .catch(() => setError("No se pudo generar el PDF"));
            }}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold text-foreground"
          >
            Cerrar
          </button>
        </div>
        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
      </div>
    );
  }

  if (paso === "confirmar") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-base font-bold text-foreground">Confirma el recibo</h3>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Cliente</dt>
            <dd className="font-bold text-foreground">{clienteNombre}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Conceptos</dt>
            <dd className="font-bold text-foreground">{items.filter((i) => i.descripcion.trim()).length}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Moneda</dt>
            <dd className="font-bold text-foreground">{moneda}</dd>
          </div>
          {vencimiento && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Vencimiento</dt>
              <dd className="font-bold text-foreground">{formatDate(vencimiento)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-border pt-1.5">
            <dt className="text-muted">Total</dt>
            <dd className="text-base font-bold text-foreground">{formatCurrency(totales.total, moneda)}</dd>
          </div>
        </dl>
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={guardando}
            onClick={confirmar}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Confirmar y crear"}
          </button>
          <button
            type="button"
            onClick={() => setPaso("form")}
            className="rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-bold text-foreground"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-foreground">Nuevo recibo</h3>
        <button type="button" onClick={onCancelar} aria-label="Cerrar editor" className="rounded-full p-1.5 text-muted hover:bg-surface-2">
          <IconX className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Emisor (nombre)</span>
          <input value={emisor.nombre} onChange={(e) => setEmisor({ ...emisor, nombre: e.target.value })} placeholder="Tu nombre o negocio" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Emisor (teléfono)</span>
          <input value={emisor.telefono} onChange={(e) => setEmisor({ ...emisor, telefono: e.target.value })} placeholder="0412-0000000" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cliente *</span>
          <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="¿Para quién es?" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Teléfono del cliente</span>
          <input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="Opcional" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Correo del cliente</span>
          <input type="email" value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} placeholder="Opcional" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Ciudad del cliente</span>
          <input value={clienteCiudad} onChange={(e) => setClienteCiudad(e.target.value)} placeholder="Opcional" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Vencimiento</span>
          <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select value={moneda} options={MONEDAS} onChange={(v) => setMoneda(v as FinMoneda)} ariaLabel="Moneda" className="mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            <span className={tituloCls}>Desc. %</span>
            <input type="text" inputMode="decimal" value={descuentoGlobal} onChange={(e) => setDescuentoGlobal(e.target.value)} placeholder="0" className={inputCls} />
          </label>
          <label className={labelCls}>
            <span className={tituloCls}>Impuesto %</span>
            <input type="text" inputMode="decimal" value={impuesto} onChange={(e) => setImpuesto(e.target.value)} placeholder="0" className={inputCls} />
          </label>
        </div>
      </div>

      <h4 className="mb-2 mt-4 text-sm font-bold text-foreground">Conceptos</h4>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-xl bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <input
                value={it.descripcion}
                onChange={(e) => setItem(i, "descripcion", e.target.value)}
                placeholder={`Concepto ${i + 1}`}
                className="w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
              {items.length > 1 && (
                <button type="button" aria-label="Quitar concepto" onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="shrink-0 rounded-full p-1.5 text-muted hover:bg-surface hover:text-red-600">
                  <IconBorrar className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className={labelCls}>
                <span className={tituloCls}>Cant.</span>
                <input type="text" inputMode="decimal" value={String(it.cantidad)} onChange={(e) => setItem(i, "cantidad", e.target.value)} className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <label className={labelCls}>
                <span className={tituloCls}>Precio</span>
                <input type="text" inputMode="decimal" value={String(it.precio)} onChange={(e) => setItem(i, "precio", e.target.value)} className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <label className={labelCls}>
                <span className={tituloCls}>Desc. %</span>
                <input type="text" inputMode="decimal" value={String(it.descuento)} onChange={(e) => setItem(i, "descuento", e.target.value)} className="mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent" />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems((p) => [...p, { descripcion: "", cantidad: 1, precio: 0, descuento: 0 }])}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs font-bold text-muted hover:text-foreground"
        >
          <IconPlus className="h-4 w-4" /> Agregar concepto
        </button>
      </div>

      <label className={`${labelCls} mt-3`}>
        <span className={tituloCls}>Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Opcional" className={`${inputCls} resize-none`} />
      </label>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5">
        <span className="text-xs font-bold text-muted">Total</span>
        <span className="text-base font-bold text-foreground">{formatCurrency(totales.total, moneda)}</span>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
      )}

      <button
        type="button"
        onClick={() => {
          setError(null);
          if (!clienteNombre.trim()) return setError("El recibo necesita un cliente");
          if (!items.some((it) => it.descripcion.trim() !== "" || parseNum(String(it.precio)) > 0))
            return setError("Agrega al menos un concepto");
          if (!(totales.total > 0)) return setError("El total debe ser mayor a 0");
          setPaso("confirmar");
        }}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"
      >
        Revisar y crear
      </button>
    </div>
  );
}

/* ════════════════ Fila del historial ════════════════ */

function FilaRecibo({ fila, onCambio }: { fila: ReciboFila; onCambio: () => void }) {
  const [expandido, setExpandido] = useState(false);
  const [montoAbono, setMontoAbono] = useState("");
  const [metodo, setMetodo] = useState<PaymentMethod>("transfer");
  const [referencia, setReferencia] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);

  const abonar = async () => {
    setError(null);
    setTrabajando(true);
    try {
      await abonarRecibo(fila.id, parseNum(montoAbono), metodo, referencia);
      setMontoAbono("");
      setReferencia("");
      setExpandido(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el abono");
    } finally {
      setTrabajando(false);
    }
  };

  const anular = async () => {
    setError(null);
    setTrabajando(true);
    try {
      await anularRecibo(fila.id);
      setConfirmarAnular(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular");
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{fila.numero}</p>
          <p className="truncate text-xs text-muted">
            {fila.cliente_nombre} · {formatDate(fila.fecha_emision)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${ESTADO_PILL[fila.estado]}`}>
          {ESTADO_TXT[fila.estado]}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">{formatCurrency(Number(fila.total), fila.moneda)}</p>
        {fila.estado === "parcial" && (
          <p className="text-xs text-muted">Saldo {formatCurrency(Number(fila.saldo), fila.moneda)}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => descargarPdf(fila).catch(() => setError("No se pudo generar el PDF"))}
          className="rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold text-foreground"
        >
          PDF
        </button>
        {(fila.estado === "pendiente" || fila.estado === "parcial") && (
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            className="rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold text-foreground"
          >
            Abonar
          </button>
        )}
        {fila.estado !== "anulado" && (
          <button
            type="button"
            onClick={() => setConfirmarAnular((v) => !v)}
            className="rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold text-red-600"
          >
            Anular
          </button>
        )}
      </div>

      {expandido && (
        <div className="mt-2 rounded-xl bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              <span className={tituloCls}>Monto (saldo {formatCurrency(Number(fila.saldo), fila.moneda)})</span>
              <input type="text" inputMode="decimal" value={montoAbono} onChange={(e) => setMontoAbono(e.target.value)} placeholder="0,00" className={inputCls} />
            </label>
            <label className={labelCls}>
              <span className={tituloCls}>Método</span>
              <Select value={metodo} options={METODOS} onChange={(v) => setMetodo(v as PaymentMethod)} ariaLabel="Método de pago" className="mt-1" />
            </label>
          </div>
          <label className={`${labelCls} mt-2`}>
            <span className={tituloCls}>Referencia</span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Opcional" className={inputCls} />
          </label>
          <button
            type="button"
            disabled={trabajando}
            onClick={abonar}
            className="mt-2 w-full rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {trabajando ? "Registrando…" : "Registrar abono"}
          </button>
        </div>
      )}

      {confirmarAnular && (
        <div className="mt-2 rounded-xl bg-red-50 p-3 dark:bg-red-900/20">
          <p className="text-xs font-bold text-red-700 dark:text-red-300">
            ¿Anular el recibo {fila.numero}? Queda en el historial con marca ANULADO.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={trabajando} onClick={anular} className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              Sí, anular
            </button>
            <button type="button" onClick={() => setConfirmarAnular(false)} className="rounded-xl bg-surface px-3 py-1.5 text-xs font-bold text-foreground">
              No
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
    </li>
  );
}

/* ════════════════ Pestaña ════════════════ */

export function RecibosTab() {
  const [recibos, setRecibos] = useState<ReciboFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setError(null);
    try {
      setRecibos(await listarRecibos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los recibos");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      setError(null);
      try {
        const rs = await listarRecibos();
        if (vivo) setRecibos(rs);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los recibos");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">Recibos</h2>
        {!editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
          >
            <IconPlus className="h-4 w-4" /> Nuevo recibo
          </button>
        )}
      </div>

      {error && (
        <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {editando && (
        <EditorRecibo
          onListo={cargar}
          onCancelar={() => {
            setEditando(false);
            cargar();
          }}
        />
      )}

      {cargando ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : recibos.length === 0 && !editando ? (
        <p className="text-sm text-muted">
          Aún no hay recibos. Crea el primero para generar su PDF.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recibos.map((r) => (
            <FilaRecibo key={r.id} fila={r} onCambio={cargar} />
          ))}
        </ul>
      )}
    </div>
  );
}
