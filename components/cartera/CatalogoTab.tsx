"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "../core/ui/Select";
import { IconPlus, IconX, IconCheck, IconAlerta } from "../../lib/core/ui/icons";
import {
  listarProductos,
  guardarProducto,
  desactivarProducto,
  formatoMonto,
  UNIDADES_CATALOGO,
  MONEDAS_CARTERA,
  type ProductoCatalogo,
  type MonedaCartera,
} from "../../lib/cartera/cliente";

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const labelCls = "block";
const tituloCls = "text-xs font-bold text-muted";

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/* ════════════════ Formulario nuevo producto ════════════════ */

function FormProducto({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState<string>("und");
  const [categoria, setCategoria] = useState("");
  const [precio, setPrecio] = useState("");
  const [moneda, setMoneda] = useState<MonedaCartera>("USD");
  const [costo, setCosto] = useState("");
  const [notas, setNotas] = useState("");
  const [paso, setPaso] = useState<"form" | "confirmar">("form");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const precioNum = parseNum(precio);
  const costoNum = parseNum(costo);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await guardarProducto({
        nombre,
        unidad,
        categoria: categoria || "General",
        precioVenta: precioNum,
        moneda,
        costo: costoNum > 0 ? costoNum : null,
        notas,
      });
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
        <h3 className="text-sm font-bold text-foreground">Confirmar producto</h3>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Producto</dt>
            <dd className="font-bold text-foreground">{nombre.trim()}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Precio de venta</dt>
            <dd className="font-bold text-foreground">{formatoMonto(precioNum, moneda)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Unidad / Categoría</dt>
            <dd className="font-bold text-foreground">
              {UNIDADES_CATALOGO.find((u) => u.value === unidad)?.label} · {categoria.trim() || "General"}
            </dd>
          </div>
          {costoNum > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Costo</dt>
              <dd className="font-bold text-foreground">{formatoMonto(costoNum, moneda)}</dd>
            </div>
          )}
        </dl>
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setPaso("form")} className="flex-1 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-bold text-foreground">
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
        <h3 className="text-sm font-bold text-foreground">Nuevo producto</h3>
        <button type="button" aria-label="Cerrar" onClick={onCancelar} className="rounded-full p-1.5 text-muted hover:text-foreground">
          <IconX className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          <span className={tituloCls}>Nombre *</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Queso blanco" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Categoría</span>
          <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej. Lácteos" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Precio de venta *</span>
          <input type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select ariaLabel="Moneda" value={moneda} onChange={(v) => setMoneda(v as MonedaCartera)} options={MONEDAS_CARTERA.map((m) => ({ value: m.value, label: m.label }))} className="mt-1" />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Unidad</span>
          <Select ariaLabel="Unidad" value={unidad} onChange={setUnidad} options={UNIDADES_CATALOGO.map((u) => ({ value: u.value, label: u.label }))} className="mt-1" />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Costo (opcional)</span>
          <input type="text" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0,00" className={inputCls} />
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
          if (!nombre.trim()) return setError("El producto necesita un nombre");
          if (!(precioNum > 0)) return setError("El precio de venta debe ser mayor a 0");
          setPaso("confirmar");
        }}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"
      >
        Revisar y guardar
      </button>
    </div>
  );
}

/* ════════════════ Fila de producto ════════════════ */

function FilaProducto({ producto, onCambio }: { producto: ProductoCatalogo; onCambio: () => void }) {
  const [expandido, setExpandido] = useState(false);
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desactivar = async () => {
    setError(null);
    setTrabajando(true);
    try {
      await desactivarProducto(producto.id);
      setConfirmarDesactivar(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desactivar");
    } finally {
      setTrabajando(false);
    }
  };

  const margen =
    producto.costo && producto.costo > 0
      ? Math.round((1 - producto.costo / producto.precio_venta) * 100)
      : null;

  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expandido}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{producto.nombre}</p>
          <p className="truncate text-xs text-muted">
            {producto.categoria} · {UNIDADES_CATALOGO.find((u) => u.value === producto.unidad)?.label ?? producto.unidad}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-foreground">
          {formatoMonto(Number(producto.precio_venta), producto.moneda)}
        </span>
      </button>

      {expandido && (
        <div className="mt-3 border-t border-border pt-3">
          <dl className="space-y-1.5 text-xs">
            {producto.costo != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Costo</dt>
                <dd className="font-bold text-foreground">
                  {formatoMonto(Number(producto.costo), producto.moneda)}
                  {margen !== null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">({margen}% margen)</span>}
                </dd>
              </div>
            )}
            {producto.notas && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Notas</dt>
                <dd className="text-right font-bold text-foreground">{producto.notas}</dd>
              </div>
            )}
          </dl>
          {error && (
            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
          )}
          <div className="mt-2">
            {confirmarDesactivar ? (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 dark:bg-red-900/20">
                <p className="flex-1 text-xs font-bold text-red-700 dark:text-red-300">
                  ¿Desactivar {producto.nombre}?
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
                Desactivar producto
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/* ════════════════ Pestaña ════════════════ */

export function CatalogoTab() {
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string>("todas");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      setProductos(await listarProductos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los productos");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await listarProductos();
        if (vivo) setProductos(lista);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los productos");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const categorias = useMemo(
    () => ["todas", ...Array.from(new Set(productos.map((p) => p.categoria))).sort()],
    [productos]
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        (categoria === "todas" || p.categoria === categoria) &&
        (!q || p.nombre.toLowerCase().includes(q))
    );
  }, [productos, busqueda, categoria]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">Catálogo</h2>
        <button
          type="button"
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
        >
          {mostrarForm ? <IconX className="h-4 w-4" /> : <IconPlus className="h-4 w-4" />}
          {mostrarForm ? "Cerrar" : "Producto"}
        </button>
      </div>

      {mostrarForm && (
        <FormProducto
          onListo={() => {
            setMostrarForm(false);
            cargar();
          }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      <div className="flex gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto…"
          className="w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        />
        {categorias.length > 2 && (
          <div className="w-36 shrink-0">
            <Select ariaLabel="Filtrar por categoría" value={categoria} onChange={setCategoria} options={categorias.map((c) => ({ value: c, label: c === "todas" ? "Todas" : c }))} />
          </div>
        )}
      </div>

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
          {busqueda || categoria !== "todas"
            ? "Ningún producto coincide."
            : "Aún no hay productos. Agrega el primero a tu catálogo."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtrados.map((p) => (
            <FilaProducto key={p.id} producto={p} onCambio={cargar} />
          ))}
        </ul>
      )}
    </div>
  );
}
