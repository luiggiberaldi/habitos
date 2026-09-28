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
  type MerPrecio,
  type MerPresupuesto,
  type MerTipoMov,
  type MerUnidad,
} from "../../lib/mercado/types";
import { listarCuentasConSaldos } from "../../lib/finanzas/finanzas";
import { MONEDAS, type FinCuentaConSaldo } from "../../lib/finanzas/types";
import { Select } from "../../components/core/ui/Select";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import {
  IconAlerta,
  IconCaja,
  IconCheck,
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
            ? "Inventario al día."
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
  setTab: (t: "inventario" | "lista" | "registrar") => void;
  pendientes: number;
}) {
  const items = [
    { id: "inventario", etiqueta: "Inventario" },
    { id: "lista", etiqueta: `Lista${pendientes ? ` (${pendientes})` : ""}` },
    { id: "registrar", etiqueta: "Registrar" },
  ] as const;
  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl bg-surface p-1.5">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition-colors ${
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

function TarjetaProducto({
  item,
  onAgregarLista,
}: {
  item: MerInventarioItem;
  onAgregarLista: (p: MerInventarioItem) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{item.nombre}</p>
          <p className="text-xs text-muted">{item.categoria}</p>
        </div>
        <p className={`shrink-0 text-lg font-black ${colorStock(item)}`}>
          {fmtCantidad(item.stock)}{" "}
          <span className="text-xs font-bold text-muted">{item.unidad}</span>
        </p>
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
          </span>
        )}
        {item.sugerido_comprar !== null && item.sugerido_comprar > 0 && (
          <span className="font-bold text-amber-500">
            Sugerido: {fmtCantidad(item.sugerido_comprar)} {item.unidad}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
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

export default function MercadoPage() {
  const [tab, setTab] = useState<"inventario" | "lista" | "registrar">("inventario");
  const [inventario, setInventario] = useState<MerInventarioItem[]>([]);
  const [lista, setLista] = useState<MerListaItem[]>([]);
  const [presupuesto, setPresupuesto] = useState<MerPresupuesto | null>(null);
  const [cuentas, setCuentas] = useState<FinCuentaConSaldo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
      const [inv, lis, pre, cue] = await Promise.all([
        merRpc.inventario(),
        merRpc.lista(),
        merRpc.presupuesto(),
        listarCuentasConSaldos().catch(() => [] as FinCuentaConSaldo[]),
      ]);
      setInventario(inv);
      setLista(lis);
      setPresupuesto(pre);
      setCuentas(cue);
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

  const crearProducto = async () => {
    if (!pNombre.trim() || !pCategoria.trim()) {
      setError("El producto necesita nombre y categoría.");
      return;
    }
    const stockIni = Number(pStock);
    if (!pStock.trim() || Number.isNaN(stockIni) || stockIni <= 0) {
      setError("Indica la cantidad inicial que tienes del producto.");
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

  const toggleLista = async (item: MerListaItem) => {
    try {
      await merRpc.listaToggle({
        productoId: item.producto_id,
        cantidad: item.cantidad,
        estado: item.estado === "pendiente" ? "comprado" : "pendiente",
      });
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la lista.");
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
        <p className="mt-8 text-center text-sm text-muted">Cargando inventario…</p>
      ) : (
        <>
          {tab === "inventario" && (
            <section className="mt-4 space-y-3">
              {inventario.length === 0 && (
                <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
                  Sin productos todavía. Crea el primero en la pestaña Registrar.
                </p>
              )}
              {inventario.map((item) => (
                <TarjetaProducto
                  key={item.id}
                  item={item}
                  onAgregarLista={agregarLista}
                />
              ))}
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
                  La lista está vacía. Agrega productos desde el inventario.
                </p>
              )}
              {lista.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface p-4">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.estado === "comprado"}
                    aria-label={`Marcar ${item.nombre} como comprado`}
                    onClick={() => toggleLista(item)}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      item.estado === "comprado"
                        ? "border-accent bg-accent text-white"
                        : "border-muted/40 text-transparent"
                    }`}
                  >
                    <IconCheck className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-bold ${
                        item.estado === "comprado" ? "text-muted line-through" : "text-foreground"
                      }`}
                    >
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
                    />
                  </label>
                  <label className="block">
                    <span className={tituloCls}>Cantidad inicial *</span>
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
                <p className="text-sm font-black text-foreground">Movimiento de inventario</p>
                <div className="mt-3 flex gap-2 overflow-x-auto rounded-2xl bg-background p-1.5">
                  {TIPOS_MOV.map((t) => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => setMTipo(t.valor)}
                      className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${
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
            </section>
          )}
        </>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">
        <IconLista className="h-4 w-4" aria-hidden="true" />
        <span>El stock se calcula desde compras y consumos. Nada se guarda a mano.</span>
      </div>
    </div>
  );
}
