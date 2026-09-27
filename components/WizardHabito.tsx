"use client";

import { useState, type ReactNode } from "react";
import type { Categoria, EstadoHabit, Habit, Moment, TipoHabit } from "../lib/types";
import { DIAS_SEMANA } from "../lib/dates";
import { habitColors as COLORES } from "../lib/design-tokens";
import { PLANTILLAS, habitoDesdePlantilla, type Plantilla } from "../lib/plantillas";
import {
  IconAlerta,
  IconCategoria,
  IconCheck,
  IconChevronDerecha,
  IconFlechaAtras,
  IconPlus,
  IconX,
} from "../lib/icons";
import { TimeField } from "./TimeField";

const PASOS = [
  { id: "que", titulo: "¿Qué hábito?" },
  { id: "cuando", titulo: "¿Cuándo?" },
  { id: "vista", titulo: "¿Cómo se ve?" },
];

const CATEGORIAS: { valor: Categoria; etiqueta: string }[] = [
  { valor: "salud", etiqueta: "Salud" },
  { valor: "productividad", etiqueta: "Productividad" },
  { valor: "crecimiento", etiqueta: "Crecimiento" },
  { valor: "bienestar", etiqueta: "Bienestar" },
  { valor: "personal", etiqueta: "Personal" },
  { valor: "otro", etiqueta: "Otro" },
];

/** Nombres legibles para los colores (los lectores de pantalla no entienden hex). */
const NOMBRES_COLORES: Record<string, string> = {
  "#F84818": "Brasa",
  "#F88808": "Naranja",
  "#F8B808": "Dorado",
  "#6366f1": "Índigo",
  "#ef4444": "Rojo",
  "#3b82f6": "Azul",
  "#a855f7": "Violeta",
  "#22c55e": "Verde",
};

const OPCIONES_MOMENTO = [
  { valor: "manana", etiqueta: "Mañana" },
  { valor: "tarde", etiqueta: "Tarde" },
  { valor: "noche", etiqueta: "Noche" },
  { valor: "cualquier", etiqueta: "Flexible" },
  { valor: "hora", etiqueta: "Hora exacta" },
];

const ETIQUETA_VENTANA: Record<string, string> = {
  manana: "Mañana",
  tarde: "Tarde",
  noche: "Noche",
  cualquier: "Flexible",
};

const UNIDADES_SUGERIDAS = ["vasos", "páginas", "minutos", "km", "veces", "litros"];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function claveMomento(m: Moment): string {
  return m.tipo === "hora" ? `hora:${m.hora ?? "09:00"}` : `ventana:${m.ventana ?? "cualquier"}`;
}

function seleccionMomento(m: Moment): string {
  return m.tipo === "hora" ? "hora" : (m.ventana ?? "cualquier");
}

/** Default inteligente al añadir: primera ventana libre, si no una hora libre. */
function momentoSugerido(existentes: Moment[]): Moment {
  const usadas = new Set(existentes.map(claveMomento));
  for (const v of ["manana", "tarde", "noche"]) {
    if (!usadas.has(`ventana:${v}`)) return { id: uid(), tipo: "ventana", ventana: v };
  }
  let h = 9;
  while (h < 22 && usadas.has(`hora:${String(h).padStart(2, "0")}:00`)) h++;
  return { id: uid(), tipo: "hora", hora: `${String(h).padStart(2, "0")}:00` };
}

/** Grupo accesible de opciones (reemplaza el <span> suelto: da contexto al lector). */
function Grupo({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id}>
      <span id={id} className="mb-2 block text-sm font-medium">
        {titulo}
      </span>
      {children}
    </div>
  );
}

/** Stepper −/+ con botones grandes (adiós flechitas nativas en móvil). */
function Stepper({
  valor,
  min,
  max,
  onChange,
  etiqueta,
}: {
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  etiqueta: string;
}) {
  const base =
    "flex h-11 w-11 items-center justify-center rounded-full border border-border text-xl font-bold transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-inherit";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`Disminuir ${etiqueta}`}
        disabled={valor <= min}
        onClick={() => onChange(valor - 1)}
        className={base}
      >
        −
      </button>
      <span aria-live="polite" aria-label={`${etiqueta}: ${valor}`} className="w-12 text-center text-lg font-bold tabular-nums">
        {valor}
      </span>
      <button
        type="button"
        aria-label={`Aumentar ${etiqueta}`}
        disabled={valor >= max}
        onClick={() => onChange(valor + 1)}
        className={base}
      >
        +
      </button>
    </div>
  );
}

export function WizardHabito({
  habit,
  esNuevo,
  onGuardar,
  onCancelar,
}: {
  habit: Habit;
  esNuevo: boolean;
  onGuardar: (habit: Habit) => void;
  onCancelar: () => void;
}) {
  const [draft, setDraft] = useState<Habit>(() => structuredClone(habit));
  const [paso, setPaso] = useState(0);
  const [modificado, setModificado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarDescripcion, setMostrarDescripcion] = useState(() => Boolean(habit.descripcion?.trim()));
  /** Bug #5: al pasar a "cantidad" se guardan los momentos para restaurarlos si vuelve. */
  const [stashMomentos, setStashMomentos] = useState<Moment[] | null>(null);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  function patch(p: Partial<Habit>) {
    setDraft((prev) => ({ ...prev, ...p }));
    setModificado(true);
    setError(null);
  }

  function cambiarTipo(t: TipoHabit) {
    if (t === (draft.tipo ?? "momento")) return;
    if (t === "cantidad") {
      setStashMomentos(draft.momentos);
      patch({ tipo: t, momentos: [] });
    } else {
      const restaurados =
        stashMomentos && stashMomentos.length > 0
          ? stashMomentos
          : [{ id: uid(), tipo: "ventana", ventana: "cualquier" } as Moment];
      setStashMomentos(null);
      patch({ tipo: t, momentos: restaurados });
    }
  }

  function validar(pasoActual: number, d: Habit): string | null {
    if (pasoActual === 0) {
      if (!d.nombre.trim()) return "Ponle un nombre a tu hábito para continuar.";
      return null;
    }
    if (pasoActual === 1) {
      // Bug #2: un hábito sin días nunca aparece — exigir al menos uno.
      if (d.dias.length === 0) return "Elige al menos un día de la semana.";
      if ((d.tipo ?? "momento") === "momento") {
        const momentos = d.momentos.filter((m) => m.id);
        if (momentos.length === 0) return "Añade al menos un momento del día.";
        const vistos = new Set<string>();
        for (const m of momentos) {
          const c = claveMomento(m);
          if (vistos.has(c)) return "Hay momentos repetidos. Quita o cambia el duplicado.";
          vistos.add(c);
        }
        if (d.objetivo > momentos.length)
          return `El objetivo (${d.objetivo}) no puede ser mayor que la cantidad de momentos (${momentos.length}).`;
      }
      return null;
    }
    return null;
  }

  function continuar() {
    const err = validar(paso, draft);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setPaso((p) => Math.min(p + 1, PASOS.length - 1));
  }

  function guardar() {
    for (let i = 0; i < PASOS.length; i++) {
      const err = validar(i, draft);
      if (err) {
        setError(err);
        setPaso(i);
        return;
      }
    }
    const nombre = draft.nombre.trim();
    // Bug #3: en "cantidad" los momentos se descartan (la sección ni se muestra).
    const momentos = (draft.tipo ?? "momento") === "cantidad" ? [] : draft.momentos.filter((m) => m.id);
    onGuardar({ ...draft, nombre, momentos });
  }

  function intentarSalir() {
    if (modificado) setConfirmarSalida(true);
    else onCancelar();
  }

  function aplicarPlantilla(p: Plantilla) {
    const base = habitoDesdePlantilla(p);
    setDraft({ ...base, id: draft.id, creadoEn: draft.creadoEn, actualizadoEn: draft.actualizadoEn });
    setStashMomentos(null);
    setModificado(true);
    setError(null);
    if (base.descripcion?.trim()) setMostrarDescripcion(true);
  }

  function anadirMomento() {
    const momentos = [...draft.momentos, momentoSugerido(draft.momentos)];
    setDraft((prev) => ({ ...prev, momentos }));
    setModificado(true);
    setError(null);
  }

  function quitarMomento(id: string) {
    setDraft((prev) => {
      const momentos = prev.momentos.filter((m) => m.id !== id);
      const objetivo =
        (prev.tipo ?? "momento") === "momento"
          ? Math.min(prev.objetivo, Math.max(1, momentos.length))
          : prev.objetivo;
      return { ...prev, momentos, objetivo };
    });
    setModificado(true);
    setError(null);
  }

  function cambiarMomento(id: string, sel: string) {
    setDraft((prev) => ({
      ...prev,
      momentos: prev.momentos.map((m) =>
        m.id === id
          ? sel === "hora"
            ? { ...m, tipo: "hora", hora: m.hora ?? "09:00", ventana: undefined }
            : { ...m, tipo: "ventana", ventana: sel, hora: undefined }
          : m,
      ),
    }));
    setModificado(true);
    setError(null);
  }

  const esCantidad = (draft.tipo ?? "momento") === "cantidad";
  const subtituloVistaPrevia = esCantidad
    ? `Cantidad · meta ${draft.objetivo}${draft.unidad?.trim() ? ` ${draft.unidad.trim()}` : ""}`
    : `${draft.momentos.length} momento${draft.momentos.length !== 1 ? "s" : ""} · objetivo ${draft.objetivo}`;
  const diasResumen = [...draft.dias].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d]);

  return (
    <div>
      <button
        type="button"
        onClick={intentarSalir}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <IconFlechaAtras className="h-4 w-4" /> Volver
      </button>

      <div className="card p-4 sm:p-6">
        <h1 className="text-lg font-bold">{esNuevo ? "Nuevo hábito" : "Editar hábito"}</h1>

        <ol className="mt-4 flex items-center" aria-label="Progreso del asistente">
          {PASOS.map((p, i) => (
            <li key={p.id} className={`flex items-center ${i < PASOS.length - 1 ? "flex-1" : ""}`}>
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  i < paso
                    ? "bg-accent text-accent-foreground"
                    : i === paso
                      ? "bg-accent text-accent-foreground ring-2 ring-accent ring-offset-2 ring-offset-surface"
                      : "border border-border text-muted"
                }`}
                aria-current={i === paso ? "step" : undefined}
              >
                {i < paso ? <IconCheck className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`ml-2 hidden text-xs font-medium sm:inline ${i === paso ? "" : "text-muted"}`}>
                {p.titulo}
              </span>
              {i < PASOS.length - 1 && <span aria-hidden="true" className="mx-2 h-px flex-1 bg-border sm:mx-3" />}
            </li>
          ))}
        </ol>

        <div key={paso} className="animate-paso-in mt-6 flex min-w-0 flex-col gap-5">
          {paso === 0 && (
            <>
              {esNuevo && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted">O empieza con una plantilla:</p>
                  <div className="flex flex-wrap gap-2">
                    {PLANTILLAS.map((p) => (
                      <button
                        key={p.nombre}
                        type="button"
                        onClick={() => aplicarPlantilla(p)}
                        className="chip min-h-10 hover:border-accent hover:text-accent"
                        title={`Usar la plantilla "${p.nombre}"`}
                      >
                        <IconCategoria categoria={p.categoria} className="h-3.5 w-3.5" /> {p.nombre}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Nombre *</span>
                <input
                  value={draft.nombre}
                  onChange={(e) => patch({ nombre: e.target.value })}
                  placeholder="p. ej. Meditar cada mañana"
                  className="input-field min-h-11"
                  aria-invalid={!!error && paso === 0}
                  autoFocus={esNuevo}
                />
              </label>

              {mostrarDescripcion ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Descripción</span>
                  <input
                    value={draft.descripcion ?? ""}
                    onChange={(e) => patch({ descripcion: e.target.value })}
                    placeholder="Opcional"
                    className="input-field min-h-11"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => setMostrarDescripcion(true)}
                  className="self-start text-sm font-medium text-accent hover:underline"
                >
                  + Añadir descripción
                </button>
              )}

              <Grupo id="wiz-categoria" titulo="Categoría">
                <div className="flex flex-wrap gap-2">
                  {CATEGORIAS.map((c) => (
                    <button
                      key={c.valor}
                      type="button"
                      onClick={() => patch({ categoria: c.valor })}
                      aria-pressed={draft.categoria === c.valor}
                      className={`chip inline-flex min-h-10 items-center gap-1.5 ${
                        draft.categoria === c.valor ? "chip-active" : "hover:border-accent"
                      }`}
                    >
                      <IconCategoria categoria={c.valor} className="h-4 w-4" />
                      {c.etiqueta}
                    </button>
                  ))}
                </div>
              </Grupo>

              <Grupo id="wiz-tipo" titulo="Tipo de registro">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { valor: "momento", etiqueta: "Por momento" },
                      { valor: "cantidad", etiqueta: "Por cantidad" },
                    ] as { valor: TipoHabit; etiqueta: string }[]
                  ).map((t) => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => cambiarTipo(t.valor)}
                      aria-pressed={(draft.tipo ?? "momento") === t.valor}
                      className={`chip min-h-10 capitalize ${
                        (draft.tipo ?? "momento") === t.valor ? "chip-active" : "hover:border-accent"
                      }`}
                    >
                      {t.etiqueta}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {esCantidad
                    ? "Sumas cantidades durante el día (vasos, páginas, minutos…)."
                    : "Lo marcas en momentos concretos del día (mañana, tarde, hora fija…)."}
                </p>
              </Grupo>
            </>
          )}

          {paso === 1 && (
            <>
              <Grupo id="wiz-dias" titulo="Días de la semana">
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_SEMANA.map((dia, i) => {
                    const sel = draft.dias.includes(i);
                    return (
                      <button
                        key={dia}
                        type="button"
                        onClick={() => {
                          setDraft((prev) => {
                            const dias = sel
                              ? prev.dias.filter((d) => d !== i)
                              : [...prev.dias, i].sort((a, b) => a - b);
                            return { ...prev, dias };
                          });
                          setModificado(true);
                          setError(null);
                        }}
                        aria-pressed={sel}
                        title={dia}
                        aria-label={dia}
                        className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-medium transition-colors ${
                          sel
                            ? "bg-accent text-accent-foreground"
                            : "border border-border text-muted hover:border-accent"
                        }`}
                      >
                        {dia.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
              </Grupo>

              {esCantidad ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-medium">Meta diaria</span>
                    <Stepper
                      valor={draft.objetivo}
                      min={1}
                      max={200}
                      onChange={(v) => patch({ objetivo: v })}
                      etiqueta="Meta diaria"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium" htmlFor="wiz-unidad">
                      Unidad
                    </label>
                    <input
                      id="wiz-unidad"
                      value={draft.unidad ?? ""}
                      onChange={(e) => patch({ unidad: e.target.value })}
                      placeholder="p. ej. vasos, páginas, km"
                      className="input-field min-h-11"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {UNIDADES_SUGERIDAS.map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => patch({ unidad: u })}
                          className={`chip !min-h-9 !text-xs ${draft.unidad === u ? "chip-active" : "hover:border-accent"}`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="block text-sm font-medium">Objetivo diario</span>
                      <span className="text-xs text-muted">
                        {draft.momentos.length} momento{draft.momentos.length !== 1 ? "s" : ""} configurado
                        {draft.momentos.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <Stepper
                      valor={draft.objetivo}
                      min={1}
                      max={20}
                      onChange={(v) => patch({ objetivo: Math.min(v, Math.max(1, draft.momentos.length)) })}
                      etiqueta="Objetivo diario"
                    />
                  </div>

                  <Grupo id="wiz-momentos" titulo="Momentos del día">
                    <div className="flex flex-col gap-2">
                      {draft.momentos.map((moment) => {
                        const sel = seleccionMomento(moment);
                        return (
                          <div key={moment.id} className="rounded-2xl border border-border p-3">
                            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de momento">
                              {OPCIONES_MOMENTO.map((o) => (
                                <button
                                  key={o.valor}
                                  type="button"
                                  onClick={() => cambiarMomento(moment.id, o.valor)}
                                  aria-pressed={sel === o.valor}
                                  className={`chip !min-h-9 !text-xs ${
                                    sel === o.valor ? "chip-active" : "hover:border-accent"
                                  }`}
                                >
                                  {o.etiqueta}
                                </button>
                              ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              {sel === "hora" ? (
                                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted">
                                  <span>Hora</span>
                                  <TimeField
                                    ariaLabel="Hora del momento"
                                    value={moment.hora ?? "09:00"}
                                    onChange={(hora) => {
                                      setDraft((prev) => ({
                                        ...prev,
                                        momentos: prev.momentos.map((m) =>
                                          m.id === moment.id ? { ...m, hora } : m,
                                        ),
                                      }));
                                      setModificado(true);
                                      setError(null);
                                    }}
                                    className="input-field min-h-10 min-w-0 flex-1"
                                  />
                                </div>
                              ) : (
                                <p className="min-w-0 flex-1 text-sm text-muted">
                                  Se sugiere {ETIQUETA_VENTANA[sel]?.toLowerCase() === "flexible" ? "a cualquier hora" : `en la ${ETIQUETA_VENTANA[sel]?.toLowerCase()}`}.
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => quitarMomento(moment.id)}
                                className="btn-icon min-h-[40px] min-w-[40px] shrink-0 hover:!text-danger"
                                title="Quitar momento"
                                aria-label="Quitar momento"
                              >
                                <IconX className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={anadirMomento}
                      className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                    >
                      <IconPlus className="h-4 w-4" /> Añadir momento
                    </button>
                  </Grupo>
                </>
              )}
            </>
          )}

          {paso === 2 && (
            <>
              <Grupo id="wiz-color" titulo="Color">
                <div className="flex flex-wrap gap-2">
                  {COLORES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => patch({ color })}
                      aria-pressed={draft.color === color}
                      aria-label={`Color ${NOMBRES_COLORES[color] ?? color}`}
                      title={NOMBRES_COLORES[color] ?? color}
                      className={`h-11 w-11 rounded-full transition-transform ${
                        draft.color === color
                          ? "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </Grupo>

              <div>
                <span className="mb-2 block text-sm font-medium">Vista previa</span>
                <article className="card flex items-center gap-3 p-4" aria-label="Vista previa del hábito">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${draft.color}1f`, color: draft.color }}
                  >
                    <IconCategoria categoria={draft.categoria} className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{draft.nombre.trim() || "Tu hábito"}</h2>
                    <p className="truncate text-sm text-muted">{subtituloVistaPrevia}</p>
                  </div>
                </article>
              </div>

              <dl className="flex flex-col gap-2 rounded-2xl border border-border p-4 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Tipo</dt>
                  <dd className="font-medium">{esCantidad ? "Por cantidad" : "Por momento"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Días</dt>
                  <dd className="text-right font-medium capitalize">{diasResumen.join(", ") || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">{esCantidad ? "Meta" : "Objetivo"}</dt>
                  <dd className="font-medium">
                    {draft.objetivo}
                    {esCantidad && draft.unidad?.trim() ? ` ${draft.unidad.trim()}` : ""}
                  </dd>
                </div>
                {!esCantidad && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Momentos</dt>
                    <dd className="text-right font-medium">
                      {draft.momentos
                        .map((m) =>
                          m.tipo === "hora" ? (m.hora ?? "09:00") : (ETIQUETA_VENTANA[m.ventana ?? "cualquier"] ?? ""),
                        )
                        .join(" · ") || "—"}
                    </dd>
                  </div>
                )}
              </dl>

              {!esNuevo && (
                <Grupo id="wiz-estado" titulo="Estado">
                  <div className="flex flex-wrap gap-2">
                    {(["activo", "pausado", "archivado"] as EstadoHabit[]).map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => patch({ estado: e })}
                        aria-pressed={draft.estado === e}
                        className={`chip min-h-10 capitalize ${draft.estado === e ? "chip-active" : "hover:border-accent"}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </Grupo>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
              <IconAlerta className="h-4 w-4 shrink-0 translate-y-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          {paso > 0 && (
            <button type="button" onClick={() => { setPaso((p) => p - 1); setError(null); }} className="btn-secondary min-h-11 flex-1 justify-center">
              <IconFlechaAtras className="h-4 w-4" /> Atrás
            </button>
          )}
          {paso < PASOS.length - 1 ? (
            <button type="button" onClick={continuar} className="btn-primary min-h-11 flex-1 justify-center">
              Continuar <IconChevronDerecha className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={guardar} className="btn-primary min-h-11 flex-1 justify-center">
              <IconCheck className="h-4 w-4" /> {esNuevo ? "Crear hábito" : "Guardar cambios"}
            </button>
          )}
        </div>
      </div>

      {confirmarSalida && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmarSalida(false)} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiz-salida-titulo"
            className="card w-full max-w-sm p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <IconAlerta className="h-6 w-6 shrink-0 text-accent" />
              <div>
                <h2 id="wiz-salida-titulo" className="text-lg font-bold">
                  ¿Descartar los cambios?
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Tienes cambios sin guardar en este hábito. Si sales ahora se perderán.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmarSalida(false)}
                className="btn-secondary min-h-11 flex-1 justify-center"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={onCancelar}
                className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-semibold text-white"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
