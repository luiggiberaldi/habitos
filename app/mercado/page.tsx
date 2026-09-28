"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fmtCantidad,
  merRpc,
} from "../../lib/mercado/mercado";
import {
  MER_UNIDADES,
  type MerInventarioItem,
  type MerListaItem,
  type MerMovReciente,
  type MerPrecio,
  type MerPresupuesto,
  type MerTipoMov,
  type MerUnidad,
} from "../../lib/mercado/types";
import { listarCuentasConSaldos } from "../../lib/finanzas/finanzas";
import { MONEDAS, type FinCuentaConSaldo } from "../../lib/finanzas/types";
import { Select } from "../../components/core/ui/Select";
import { DatosMercado } from "../../components/mercado/DatosMercado";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import {
  IconAlerta,
  IconCaja,
  IconCheck,
  IconDeshacer,
  IconEditar,
  IconFlechaAtras,
  IconLista,
  IconPlus,
  IconX,
} from "../../lib/core/ui/icons";

const TIPOS_MOV: { valor: MerTipoMov; etiqueta: string }[] = [
  { valor: "compra", etiqueta: "Comprar" },
  { valor: "consumo", etiqueta: "Gastar" },
  { valor: "ajuste", etiqueta: "Ajustar" },
  { valor: "danado", etiqueta: "Se dañó" },
];

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const tituloCls = "text-xs font-bold text-muted";

const fmtUsd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `$${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

const fmtBs = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `Bs ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/** Encabezado serio: presupuesto mensual + estado del inventario. */
function Encabezado({
  presupuesto,
  porAgotarse,
  cargando,
}: {
  presupuesto: MerPresupuesto | null;
  porAgotarse: number;
  cargando: boolean;
}) {
  return (
    <header
      className="relative overflow-hidden rounded-3xl p-5 text-white"
      style={{ background: flameGradient, boxShadow: "0 18px 40px -12px rgba(248,72,24,.45)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 85% 0%, rgba(255,255,255,.18), transparent 60%)" }}
      />
      <div className="relative [text-shadow:0_1px_10px_rgba(0,0,0,0.30)]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">
            Presupuesto mensual estimado
          </p>
          <IconCaja className="h-5 w-5 text-white/80" aria-hidden="true" />
        </div>
        <p className="mt-1 text-3xl font-black tracking-tight">
          {cargando ? "…" : fmtUsd(presupuesto?.total_usd ?? 0)}
        </p>
        <p className="mt-1 text-xs text-white/75">
          {porAgotarse === 0
            ? "Alacena al día."
            : `${porAgotarse} producto${porAgotarse === 1 ? "" : "s"} por agotarse (menos de 7 días).`}
        </p>
      </div>
    </header>
  );
}

function Tabs({
  tab,
  setTab,
  pendientes,
}: {
  tab: string;
  setTab: (t: "alacena" | "lista" | "registrar" | "datos") => void;
  pendientes: number;
}) {
  const items = [
    { id: "alacena", etiqueta: "Alacena" },
    { id: "lista", etiqueta: `Lista${pendientes ? ` (${pendientes})` : ""}` },
    { id: "registrar", etiqueta: "Registrar" },
    { id: "datos", etiqueta: "Datos" },
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-2 rounded-2xl bg-surface p-1.5">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`min-w-0 rounded-xl px-2 py-2 text-center text-sm font-bold transition-colors ${
            tab === t.id ? "bg-accent text-white" : "text-muted hover:text-foreground"
          }`}
        >
          {t.etiqueta}
        </button>
      ))}
    </div>
  );
}

function colorStock(item: MerInventarioItem): string {
  if (item.dias_agotamiento !== null && item.dias_agotamiento <= 7) return "text-red-500";
  if (item.dias_agotamiento !== null && item.dias_agotamiento <= 30) return "text-amber-500";
  return "text-emerald-500";
}

function HistorialPrecios({ productoId }: { productoId: string }) {
  const [precios, setPrecios] = useState<MerPrecio[] | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const p = await merRpc.precios(productoId);
        if (vivo) setPrecios(p);
      } catch {
        if (vivo) setPrecios([]);
      }
    })();
    return () => { vivo = false; };
  }, [productoId]);
  if (precios === null) return <p className="mt-3 text-xs text-muted">Cargando…</p>;
  if (!precios.length) return <p className="mt-3 text-xs text-muted">Sin compras registradas.</p>;
  // Comparador por comercio: el más barato de cada comercio.
  const porComercio = new Map<string, MerPrecio>();
  for (const p of precios) {
    const c = p.comercio ?? "Sin comercio";
    const cur = porComercio.get(c);
    if (!cur || p.precio_usd_unitario < cur.precio_usd_unitario) porComercio.set(c, p);
  }
  const mejor = [...porComercio.entries()].sort((a, b) => a[1].precio_usd_unitario - b[1].precio_usd_unitario);
  return (
    <div className="mt-3 rounded-xl bg-background p-3">
      <p className={tituloCls}>Por comercio (más barato)</p>
      <ul className="mt-1 space-y-1">
        {mejor.map(([comercio, p]) => (
          <li key={comercio} className="flex justify-between text-xs">
            <span className="text-foreground">{comercio}</span>
            <span className="font-bold text-foreground">{fmtUsd(p.precio_usd_unitario)}</span>
          </li>
        ))}
      </ul>
      <p className={`${tituloCls} mt-3`}>Historial</p>
      <ul className="mt-1 space-y-1">
        {precios.slice(0, 6).map((p, i) => (
          <li key={i} className="flex justify-between text-xs text-muted">
            <span>{p.fecha}{p.comercio ? ` · ${p.comercio}` : ""}</span>
            <span>
              {fmtUsd(p.precio_usd_unitario)}/{p.moneda === "USD" ? "$" : p.moneda}
              {p.precio_bs_historico !== null && p.precio_bs_historico !== undefined && (
                <span className="text-muted"> · {fmtBs(p.precio_bs_historico)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Botones de consumo rápido según la unidad (un tap = un consumo). */
function pasosConsumoRapido(unidad: string): { cantidad: number; etiqueta: string }[] {
  switch (unidad) {
    case "und":
    case "paquete":
    case "caja":
      return [{ cantidad: 1, etiqueta: "−1" }];
    case "kg":
      return [
        { cantidad: 0.1, etiqueta: "−100g" },
        { cantidad: 0.5, etiqueta: "−500g" },
      ];
    case "g":
      return [
        { cantidad: 100, etiqueta: "−100" },
        { cantidad: 500, etiqueta: "−500" },
      ];
    case "L":
      return [
        { cantidad: 0.25, etiqueta: "−250ml" },
        { cantidad: 1, etiqueta: "−1L" },
      ];
    case "ml":
      return [
        { cantidad: 250, etiqueta: "−250" },
        { cantidad: 500, etiqueta: "−500" },
      ];
    default:
      return [{ cantidad: 1, etiqueta: "−1" }];
  }
}

function TarjetaProducto({
  item,
  onAgregarLista,
  onConsumoRapido,
  onEditar,
  consumiendo,
}: {
  item: MerInventarioItem;
  onAgregarLista: (p: MerInventarioItem) => void;
  onConsumoRapido: (p: MerInventarioItem, cantidad: number) => void;
  onEditar: (p: MerInventarioItem) => void;
  consumiendo: boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{item.nombre}</p>
          <p className="text-xs text-muted">{item.categoria}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <p className={`text-lg font-black ${colorStock(item)}`}>
            {fmtCantidad(item.stock)}{" "}
            <span className="text-xs font-bold text-muted">{item.unidad}</span>
          </p>
          <button
            type="button"
            onClick={() => onEditar(item)}
            aria-label={`Editar ${item.nombre}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-foreground"
          >
            <IconEditar className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {item.precio_usd_unitario !== null && (
          <span>
            {fmtUsd(item.precio_usd_unitario)}/{item.unidad}
            {item.variacion_pct !== null && item.variacion_pct !== 0 && (
              <span className={item.variacion_pct > 0 ? "text-red-500" : "text-emerald-500"}>
                {" "}({item.variacion_pct > 0 ? "+" : ""}{item.variacion_pct}%)
              </span>
            )}
          </span>
        )}
        {item.dias_agotamiento !== null && (
          <span className={colorStock(item)}>
            {item.dias_agotamiento <= 0 ? "Agotado" : `~${item.dias_agotamiento} días`}
            {item.consumo_estimado && <span className="text-muted"> (estimado)</span>}
          </span>
        )}
        {item.sugerido_comprar !== null && item.sugerido_comprar > 0 && (
          <span className="font-bold text-amber-500">
            Sugerido: {fmtCantidad(item.sugerido_comprar)} {item.unidad}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {pasosConsumoRapido(item.unidad).map((p) => (
          <button
            key={p.etiqueta}
            type="button"
            disabled={consumiendo}
            onClick={() => onConsumoRapido(item, p.cantidad)}
            aria-label={`Descontar ${p.etiqueta} de ${item.nombre}`}
            className="rounded-xl bg-background px-3 py-1.5 text-xs font-black text-foreground hover:bg-accent hover:text-white disabled:opacity-50"
          >
            {p.etiqueta}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExpandido(!expandido)}
          className="flex-1 rounded-xl bg-background px-3 py-1.5 text-xs font-bold text-muted hover:text-foreground"
        >
          {expandido ? "Ocultar precios" : "Historial de precios"}
        </button>
        {item.sugerido_comprar !== null && item.sugerido_comprar > 0 && (
          <button
            type="button"
            onClick={() => onAgregarLista(item)}
            className="flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-white"
          >
            <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> A la lista
          </button>
        )}
      </div>
      {expandido && <HistorialPrecios productoId={item.id} />}
    </div>
  );
}

/** Modal: marcar un artículo de la lista como comprado (precio + comercio + cuenta). */
function ModalComprar({
  item,
  cuentas,
  onCerrar,
  onConfirmado,
}: {
  item: MerListaItem;
  cuentas: FinCuentaConSaldo[];
  onCerrar: () => void;
  onConfirmado: (msg: string) => void;
}) {
  const [precio, setPrecio] = useState("");
  const [moneda, setMoneda] = useState("VES");
  const [comercio, setComercio] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar]);

  const confirmar = async () => {
    const p = Number(precio);
    if (!p || p <= 0) { setError("Indica el precio total de la compra."); return; }
    setGuardando(true);
    try {
      await merRpc.listaComprar({
        productoId: item.producto_id,
        cantidad: item.cantidad,
        precioTotal: p,
        moneda,
        comercio: comercio.trim() || null,
        cuentaId: cuenta || null,
      });
      onConfirmado(
        cuenta
          ? `Compra registrada (${item.nombre}). Egreso creado en Finanzas.`
          : `Compra registrada (${item.nombre}).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la compra.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Comprar ${item.nombre}`}>
      <button type="button" aria-label="Cerrar" onClick={onCerrar} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="text-base font-black text-foreground">Marcar como comprado</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-foreground">
            <IconX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          {item.nombre} · {fmtCantidad(item.cantidad)} {item.unidad}
        </p>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 p-3 text-sm text-red-500">
            <IconAlerta className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={tituloCls}>Precio total *</span>
            <input className={inputCls} type="number" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" autoFocus />
          </label>
          <label className="block">
            <span className={tituloCls}>Moneda</span>
            <Select ariaLabel="Moneda" value={moneda} onChange={setMoneda} options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))} />
          </label>
          <label className="block">
            <span className={tituloCls}>Comercio</span>
            <input className={inputCls} value={comercio} onChange={(e) => setComercio(e.target.value)} placeholder="Makro" />
          </label>
          <label className="block">
            <span className={tituloCls}>Cuenta (crea el egreso)</span>
            <Select
              ariaLabel="Cuenta del pago"
              value={cuenta}
              onChange={setCuenta}
              options={[
                { value: "", label: "Sin cuenta" },
                ...cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` })),
              ]}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={confirmar}
          disabled={guardando}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          <IconCheck className="h-4 w-4" aria-hidden="true" />
          {guardando ? "Registrando…" : "Confirmar compra"}
        </button>
      </div>
    </div>
  );
}

/** Hoja de edición de producto (sin tocar la unidad ni el stock). */
function SheetEditar({
  item,
  categorias,
  onCerrar,
  onGuardado,
}: {
  item: MerInventarioItem;
  categorias: string[];
  onCerrar: () => void;
  onGuardado: (msg: string) => void;
}) {
  const [nombre, setNombre] = useState(item.nombre);
  const [categoria, setCategoria] = useState(item.categoria);
  const [horizonte, setHorizonte] = useState(String(item.horizonte_compra_dias ?? 14));
  const [estimado, setEstimado] = useState(
    item.consumo_semanal_estim !== null && item.consumo_semanal_estim !== undefined
      ? String(item.consumo_semanal_estim) : "",
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar]);

  const guardar = async (activo: boolean | null) => {
    const hz = Number(horizonte);
    if (!hz || hz < 1 || hz > 90) { setError("El horizonte debe estar entre 1 y 90 días."); return; }
    const est = estimado.trim() === "" ? null : Number(estimado);
    if (est !== null && (Number.isNaN(est) || est < 0)) { setError("El consumo semanal debe ser un número positivo."); return; }
    setGuardando(true);
    try {
      await merRpc.productoActualizar({
        productoId: item.id,
        nombre: nombre.trim() || null,
        categoria: categoria.trim() || null,
        horizonteDias: hz,
        consumoSemanalEstim: est,
        quitarEstimado: estimado.trim() === "" && item.consumo_semanal_estim !== null,
        activo,
      });
      onGuardado(activo === false ? `${item.nombre} desactivado.` : "Producto actualizado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Editar ${item.nombre}`}>
      <button type="button" aria-label="Cerrar" onClick={onCerrar} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="text-base font-black text-foreground">Editar producto</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-foreground">
            <IconX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 p-3 text-sm text-red-500">
            <IconAlerta className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={tituloCls}>Nombre</span>
            <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="block">
            <span className={tituloCls}>Categoría</span>
            <input className={inputCls} value={categoria} onChange={(e) => setCategoria(e.target.value)} list="mer-categorias-editar" />
            <datalist id="mer-categorias-editar">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={tituloCls}>Horizonte de compra (días)</span>
            <input className={inputCls} type="number" min="1" max="90" value={horizonte} onChange={(e) => setHorizonte(e.target.value)} />
          </label>
          <label className="block">
            <span className={tituloCls}>Consumo semanal aprox. ({item.unidad})</span>
            <input className={inputCls} type="number" min="0" step="0.001" value={estimado} onChange={(e) => setEstimado(e.target.value)} placeholder="Vacío = sin estimado" />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          El estimado calibra el agotamiento mientras anotas consumos reales. La unidad y el stock no se cambian aquí.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => guardar(true)}
            disabled={guardando}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <IconCheck className="h-4 w-4" aria-hidden="true" />
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={() => guardar(false)}
            disabled={guardando}
            className="rounded-xl bg-background px-4 py-2.5 text-sm font-bold text-red-500 disabled:opacity-50"
          >
            Desactivar
          </button>
        </div>
      </div>
    </div>
  );
}

const ETIQUETA_TIPO: Record<string, string> = {
  compra: "Compra",
  consumo: "Consumo",
  ajuste: "Ajuste",
  danado: "Se dañó",
};

/** Movimientos recientes con deshacer. */
function Recientes({
  recientes,
  onAnular,
  anulando,
}: {
  recientes: MerMovReciente[];
  onAnular: (m: MerMovReciente) => void;
  anulando: boolean;
}) {
  if (!recientes.length) {
    return (
      <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
        Sin movimientos todavía.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {recientes.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-bold ${m.anulado ? "text-muted line-through" : "text-foreground"}`}>
              {ETIQUETA_TIPO[m.tipo] ?? m.tipo} · {m.producto}
            </p>
            <p className="text-xs text-muted">
              {fmtCantidad(m.cantidad)} {m.unidad}
              {m.precio_total !== null && m.precio_total !== undefined
                ? ` · ${m.moneda === "USD" ? fmtUsd(m.precio_total) : fmtBs(m.precio_total)}`
                : ""}
              {m.comercio ? ` · ${m.comercio}` : ""}
              {m.nota ? ` · ${m.nota}` : ""}
            </p>
          </div>
          <button
            type="button"
            disabled={anulando}
            onClick={() => onAnular(m)}
            aria-label={m.anulado ? `Rehacer movimiento de ${m.producto}` : `Deshacer movimiento de ${m.producto}`}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-background px-2.5 py-1.5 text-xs font-bold text-muted hover:text-foreground disabled:opacity-50"
          >
            <IconDeshacer className="h-3.5 w-3.5" aria-hidden="true" />
            {m.anulado ? "Rehacer" : "Deshacer"}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function MercadoPage() {
  const [tab, setTab] = useState<"alacena" | "lista" | "registrar" | "datos">("alacena");
  const [inventario, setInventario] = useState<MerInventarioItem[]>([]);
  const [lista, setLista] = useState<MerListaItem[]>([]);
  const [recientes, setRecientes] = useState<MerMovReciente[]>([]);
  const [presupuesto, setPresupuesto] = useState<MerPresupuesto | null>(null);
  const [cuentas, setCuentas] = useState<FinCuentaConSaldo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscador, setBuscador] = useState("");
  const [comprarItem, setComprarItem] = useState<MerListaItem | null>(null);
  const [editarItem, setEditarItem] = useState<MerInventarioItem | null>(null);
  const [consumiendo, setConsumiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);

  // Formulario de producto.
  const [pNombre, setPNombre] = useState("");
  const [pUnidad, setPUnidad] = useState<MerUnidad>("und");
  const [pCategoria, setPCategoria] = useState("");
  const [pPrecioRef, setPPrecioRef] = useState("");
  const [pStock, setPStock] = useState("");
  // Formulario de movimiento.
  const [mProducto, setMProducto] = useState("");
  const [mTipo, setMTipo] = useState<MerTipoMov>("compra");
  const [mCantidad, setMCantidad] = useState("");
  const [mPrecio, setMPrecio] = useState("");
  const [mMoneda, setMMoneda] = useState("VES");
  const [mComercio, setMComercio] = useState("");
  const [mCuenta, setMCuenta] = useState("");
  const [mNota, setMNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setError(null);
      const [inv, lis, pre, cue, rec] = await Promise.all([
        merRpc.inventario(),
        merRpc.lista(),
        merRpc.presupuesto(),
        listarCuentasConSaldos().catch(() => [] as FinCuentaConSaldo[]),
        merRpc.recientes(15).catch(() => [] as MerMovReciente[]),
      ]);
      setInventario(inv);
      setLista(lis);
      setPresupuesto(pre);
      setCuentas(cue);
      setRecientes(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar Mercado.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setError(null);
      try {
        const [inv, lis] = await Promise.all([
          merRpc.inventario(),
          merRpc.lista(),
        ]);
        if (!vivo) return;
        setInventario(inv);
        setLista(lis);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar Mercado.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const pendientes = useMemo(() => lista.filter((l) => l.estado === "pendiente"), [lista]);
  const porAgotarse = useMemo(
    () => inventario.filter((i) => i.dias_agotamiento !== null && i.dias_agotamiento <= 7).length,
    [inventario],
  );
  const sugeridos = useMemo(
    () =>
      inventario.filter(
        (i) => (i.sugerido_comprar ?? 0) > 0 && !lista.some((l) => l.producto_id === i.id),
      ),
    [inventario, lista],
  );
  const categorias = useMemo(
    () => [...new Set(inventario.map((i) => i.categoria).filter(Boolean))].sort(),
    [inventario],
  );
  const filtrados = useMemo(() => {
    const q = buscador.trim().toLowerCase();
    if (!q) return inventario;
    return inventario.filter((i) => i.nombre.toLowerCase().includes(q));
  }, [inventario, buscador]);
  const sinCalibracion = useMemo(
    () => inventario.length > 0 && inventario.every((i) => i.consumo_diario === null),
    [inventario],
  );

  const crearProducto = async () => {
    if (!pNombre.trim() || !pCategoria.trim()) {
      setError("El producto necesita nombre y categoría.");
      return;
    }
    const stockIni = pStock.trim() === "" ? 0 : Number(pStock);
    if (Number.isNaN(stockIni) || stockIni < 0) {
      setError("La cantidad inicial no puede ser negativa.");
      return;
    }
    setGuardando(true);
    try {
      await merRpc.productoUpsert({
        nombre: pNombre.trim(),
        unidad: pUnidad,
        categoria: pCategoria.trim(),
        precioRef: pPrecioRef ? Number(pPrecioRef) : null,
        stockInicial: stockIni,
      });
      setPNombre(""); setPCategoria(""); setPPrecioRef(""); setPStock("");
      setAviso("Producto creado.");
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el producto.");
    } finally {
      setGuardando(false);
    }
  };

  const registrarMovimiento = async () => {
    if (!mProducto) { setError("Elige el producto."); return; }
    const cantidad = Number(mCantidad);
    if (!cantidad || cantidad <= 0) { setError("La cantidad debe ser mayor que cero."); return; }
    if (mTipo === "compra" && (!Number(mPrecio) || Number(mPrecio) <= 0)) {
      setError("La compra necesita el precio total."); return;
    }
    setGuardando(true);
    try {
      const r = await merRpc.movimiento({
        productoId: mProducto,
        tipo: mTipo,
        cantidad,
        precioTotal: mTipo === "compra" ? Number(mPrecio) : null,
        moneda: mTipo === "compra" ? mMoneda : null,
        comercio: mComercio.trim() || null,
        cuentaId: mTipo === "compra" && mCuenta ? mCuenta : null,
        nota: mNota.trim() || null,
      });
      setMCantidad(""); setMPrecio(""); setMComercio(""); setMNota("");
      setAviso(
        mTipo === "compra" && r.fin_movimiento_id
          ? `Compra registrada (${r.producto}). Egreso creado en Finanzas.`
          : `Movimiento registrado (${r.producto}).`,
      );
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar.");
    } finally {
      setGuardando(false);
    }
  };

  const quitarDeLista = async (item: MerListaItem) => {
    try {
      await merRpc.listaToggle({ productoId: item.producto_id, estado: "quitar" });
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar de la lista.");
    }
  };

  const consumoRapido = async (p: MerInventarioItem, cantidad: number) => {
    setConsumiendo(true);
    try {
      await merRpc.movimiento({
        productoId: p.id,
        tipo: "consumo",
        cantidad,
        nota: "consumo rápido",
      });
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descontar.");
    } finally {
      setConsumiendo(false);
    }
  };

  const anularMov = async (m: MerMovReciente) => {
    setAnulando(true);
    try {
      const r = await merRpc.anular(m.id);
      setAviso(r.anulado ? "Movimiento deshecho." : "Movimiento restaurado.");
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo deshacer.");
    } finally {
      setAnulando(false);
    }
  };

  const compraConfirmada = async (msg: string) => {
    setComprarItem(null);
    setAviso(msg);
    await recargar();
  };

  const edicionGuardada = async (msg: string) => {
    setEditarItem(null);
    setAviso(msg);
    await recargar();
  };

  const agregarLista = async (p: MerInventarioItem) => {
    try {
      await merRpc.listaToggle({
        productoId: p.id,
        cantidad: p.sugerido_comprar ?? 1,
        estado: "pendiente",
      });
      setAviso(`${p.nombre} agregado a la lista.`);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar a la lista.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/"
          aria-label="Volver al inicio"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted hover:text-foreground"
        >
          <IconFlechaAtras className="h-5 w-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-black text-foreground">Mercado</h1>
      </div>

      <Encabezado presupuesto={presupuesto} porAgotarse={porAgotarse} cargando={cargando} />

      <div className="mt-4">
        <Tabs tab={tab} setTab={setTab} pendientes={pendientes.length} />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-3 text-sm text-red-500">
          <IconAlerta className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {aviso && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-emerald-500/10 p-3 text-sm text-emerald-600">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{aviso}</p>
        </div>
      )}

      {cargando ? (
        <p className="mt-8 text-center text-sm text-muted">Cargando alacena…</p>
      ) : (
        <>
          {tab === "alacena" && (
            <section className="mt-4 space-y-3">
              {sinCalibracion && (
                <div className="flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <IconAlerta className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    Aún no hay consumos registrados: el agotamiento y las sugerencias se calibran
                    cuando anotes lo que gastas. Toca los botones − de cada producto o escribe por
                    WhatsApp «gasté 2 huevos».
                  </p>
                </div>
              )}
              {inventario.length > 0 && (
                <input
                  className={inputCls}
                  value={buscador}
                  onChange={(e) => setBuscador(e.target.value)}
                  placeholder="Buscar en la alacena…"
                  aria-label="Buscar en la alacena"
                />
              )}
              {inventario.length === 0 && (
                <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
                  Sin productos todavía. Crea el primero en la pestaña Registrar.
                </p>
              )}
              {filtrados.length === 0 && inventario.length > 0 && (
                <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
                  Nada coincide con «{buscador.trim()}».
                </p>
              )}
              {filtrados.map((item) => (
                <TarjetaProducto
                  key={item.id}
                  item={item}
                  onAgregarLista={agregarLista}
                  onConsumoRapido={consumoRapido}
                  onEditar={setEditarItem}
                  consumiendo={consumiendo}
                />
              ))}
              {inventario.length > 0 && (
                <p className="rounded-2xl bg-surface p-3 text-center text-xs text-muted">
                  Tip: por WhatsApp escribe «mercado gasté 2 huevos» y se descuenta solo.
                </p>
              )}
              {presupuesto && presupuesto.items.length > 0 && (
                <div className="rounded-2xl bg-surface p-4">
                  <p className={tituloCls}>Presupuesto mensual por producto</p>
                  <ul className="mt-2 space-y-1.5">
                    {presupuesto.items.map((it) => (
                      <li key={it.producto} className="flex justify-between text-sm">
                        <span className="text-muted">
                          {it.producto}{" "}
                          <span className="text-xs">
                            ({fmtCantidad(it.consumo_mensual)} {it.unidad}/mes)
                          </span>
                        </span>
                        <span className="font-bold text-foreground">{fmtUsd(it.costo_mensual_usd)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {tab === "lista" && (
            <section className="mt-4 space-y-3">
              {sugeridos.length > 0 && (
                <div className="rounded-2xl bg-amber-500/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-600">
                    Sugeridos por consumo
                  </p>
                  <ul className="mt-2 space-y-2">
                    {sugeridos.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">
                          {s.nombre}{" "}
                          <span className="text-xs text-muted">
                            ({fmtCantidad(s.sugerido_comprar)} {s.unidad})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => agregarLista(s)}
                          className="flex items-center gap-1 rounded-xl bg-accent px-2.5 py-1 text-xs font-bold text-white"
                        >
                          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Agregar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lista.length === 0 && (
                <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
                  La lista está vacía. Agrega productos desde la alacena.
                </p>
              )}
              {lista.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface p-4">
                  <button
                    type="button"
                    aria-label={`Marcar ${item.nombre} como comprado`}
                    onClick={() => setComprarItem(item)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-muted/40 text-transparent hover:border-accent"
                  >
                    <IconCheck className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">
                      {item.nombre}
                    </p>
                    <p className="text-xs text-muted">
                      {fmtCantidad(item.cantidad)} {item.unidad}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => quitarDeLista(item)}
                    aria-label={`Quitar ${item.nombre} de la lista`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-red-500"
                  >
                    <IconX className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </section>
          )}

          {tab === "registrar" && (
            <section className="mt-4 space-y-4">
              <div className="rounded-2xl bg-surface p-4">
                <p className="text-sm font-black text-foreground">Nuevo producto</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={tituloCls}>Nombre *</span>
                    <input
                      className={inputCls}
                      value={pNombre}
                      onChange={(e) => setPNombre(e.target.value)}
                      placeholder="Arroz"
                    />
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Unidad *</span>
                    <Select
                      ariaLabel="Unidad del producto"
                      value={pUnidad}
                      onChange={(v) => setPUnidad(v as MerUnidad)}
                      options={MER_UNIDADES.map((u) => ({ value: u.valor, label: u.etiqueta }))}
                    />
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Categoría *</span>
                    <input
                      className={inputCls}
                      value={pCategoria}
                      onChange={(e) => setPCategoria(e.target.value)}
                      placeholder="granos"
                      list="mer-categorias"
                    />
                    <datalist id="mer-categorias">
                      {categorias.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Cantidad inicial (0 si no tienes)</span>
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      step="0.001"
                      value={pStock}
                      onChange={(e) => setPStock(e.target.value)}
                      placeholder="5"
                    />
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Precio de referencia (opcional)</span>
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      step="0.01"
                      value={pPrecioRef}
                      onChange={(e) => setPPrecioRef(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={crearProducto}
                  disabled={guardando}
                  className="mt-3 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <IconPlus className="h-4 w-4" aria-hidden="true" />
                  {guardando ? "Guardando…" : "Crear producto"}
                </button>
              </div>

              <div className="rounded-2xl bg-surface p-4">
                <p className="text-sm font-black text-foreground">Movimiento de alacena</p>
                <div className="mt-3 grid grid-cols-4 gap-2 rounded-2xl bg-background p-1.5">
                  {TIPOS_MOV.map((t) => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => setMTipo(t.valor)}
                      className={`min-w-0 rounded-xl px-2 py-2 text-center text-sm font-bold ${
                        mTipo === t.valor ? "bg-accent text-white" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {t.etiqueta}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className={tituloCls}>Producto *</span>
                    <Select
                      ariaLabel="Producto"
                      value={mProducto}
                      onChange={setMProducto}
                      options={[
                        { value: "", label: "Elige un producto…" },
                        ...inventario.map((i) => ({
                          value: i.id,
                          label: `${i.nombre} (${fmtCantidad(i.stock)} ${i.unidad})`,
                        })),
                      ]}
                    />
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Cantidad * ({mTipo === "compra" ? "comprada" : "usada"})</span>
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      step="0.001"
                      value={mCantidad}
                      onChange={(e) => setMCantidad(e.target.value)}
                      placeholder="1"
                    />
                  </label>
                  {mTipo === "compra" && (
                    <>
                      <label className="block">
                        <span className={tituloCls}>Precio total *</span>
                        <input
                          className={inputCls}
                          type="number"
                          min="0"
                          step="0.01"
                          value={mPrecio}
                          onChange={(e) => setMPrecio(e.target.value)}
                          placeholder="0.00"
                        />
                      </label>
                      <label className="block">
                        <span className={tituloCls}>Moneda</span>
                        <Select
                          ariaLabel="Moneda"
                          value={mMoneda}
                          onChange={setMMoneda}
                          options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
                        />
                      </label>
                      <label className="block">
                        <span className={tituloCls}>Comercio</span>
                        <input
                          className={inputCls}
                          value={mComercio}
                          onChange={(e) => setMComercio(e.target.value)}
                          placeholder="Makro"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className={tituloCls}>Cuenta del pago (crea el egreso en Finanzas)</span>
                        <Select
                          ariaLabel="Cuenta del pago"
                          value={mCuenta}
                          onChange={setMCuenta}
                          options={[
                            { value: "", label: "Sin cuenta (no genera egreso)" },
                            ...cuentas.map((c) => ({
                              value: c.id,
                              label: `${c.nombre} (${c.moneda})`,
                            })),
                          ]}
                        />
                      </label>
                    </>
                  )}
                  <label className="block sm:col-span-2">
                    <span className={tituloCls}>Nota</span>
                    <input
                      className={inputCls}
                      value={mNota}
                      onChange={(e) => setMNota(e.target.value)}
                      placeholder="Opcional"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={registrarMovimiento}
                  disabled={guardando}
                  className="mt-3 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <IconCheck className="h-4 w-4" aria-hidden="true" />
                  {guardando ? "Guardando…" : "Registrar"}
                </button>
              </div>

              <div className="rounded-2xl bg-surface p-4">
                <p className="text-sm font-black text-foreground">Recientes</p>
                <p className="mt-1 text-xs text-muted">
                  Deshaz un movimiento si te equivocaste.
                </p>
                <div className="mt-3">
                  <Recientes recientes={recientes} onAnular={anularMov} anulando={anulando} />
                </div>
              </div>
            </section>
          )}

          {tab === "datos" && <DatosMercado />}
        </>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">
        <IconLista className="h-4 w-4" aria-hidden="true" />
        <span>El stock se calcula desde compras y consumos. Nada se guarda a mano.</span>
      </div>

      {comprarItem && (
        <ModalComprar
          item={comprarItem}
          cuentas={cuentas}
          onCerrar={() => setComprarItem(null)}
          onConfirmado={compraConfirmada}
        />
      )}
      {editarItem && (
        <SheetEditar
          item={editarItem}
          categorias={categorias}
          onCerrar={() => setEditarItem(null)}
          onGuardado={edicionGuardada}
        />
      )}
    </div>
  );
}
