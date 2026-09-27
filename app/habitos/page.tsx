"use client";

import { useMemo, useState } from "react";
import { useStoreActions, useStoreState } from "../../lib/store-context";
import { Select } from "../../components/Select";
import { DIAS_SEMANA } from "../../lib/dates";
import type { Categoria, Habit, EstadoHabit, TipoHabit } from "../../lib/types";
import { habitColors as COLORES } from "../../lib/design-tokens";
import {
  IconAlerta,
  IconBorrar,
  IconCategoria,
  IconCheck,
  IconDescanso,
  IconDuplicar,
  IconEditar,
  IconFlechaAtras,
  IconPlus,
  IconRayo,
  IconX,
} from "../../lib/icons";

const CATEGORIAS: { valor: Categoria; etiqueta: string }[] = [
  { valor: "salud", etiqueta: "Salud" },
  { valor: "productividad", etiqueta: "Productividad" },
  { valor: "crecimiento", etiqueta: "Crecimiento" },
  { valor: "bienestar", etiqueta: "Bienestar" },
  { valor: "personal", etiqueta: "Personal" },
  { valor: "otro", etiqueta: "Otro" },
];


interface Plantilla {
  nombre: string;
  categoria: Categoria;
  color: string;
  tipo: TipoHabit;
  objetivo: number;
  unidad?: string;
  momentos: { tipo: "hora" | "ventana"; hora?: string; ventana?: string }[];
}

/** Plantillas de un tap: crear sin pasar por el formulario completo. */
const PLANTILLAS: Plantilla[] = [
  { nombre: "Tomar agua", categoria: "salud", color: "#3b82f6", tipo: "cantidad", objetivo: 8, unidad: "vasos", momentos: [] },
  { nombre: "Leer", categoria: "crecimiento", color: "#a855f7", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "noche" }] },
  { nombre: "Caminar", categoria: "salud", color: "#22c55e", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "manana" }] },
  { nombre: "Meditar", categoria: "bienestar", color: "#6366f1", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "manana" }] },
  { nombre: "Ejercicio", categoria: "salud", color: "#ef4444", tipo: "momento", objetivo: 1, momentos: [{ tipo: "ventana", ventana: "tarde" }] },
];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function GestionHabitos() {
  const { state } = useStoreState();
  const { guardarHabit, eliminarHabit, cambiarEstadoTodos } = useStoreActions();
  const [formulario, setFormulario] = useState<Habit | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | EstadoHabit>("todos");
  const [creacionRapida, setCreacionRapida] = useState(false);
  const [nombreRapido, setNombreRapido] = useState("");

  const habitosVisibles = useMemo(
    () => state.habits.filter((h) => filtro === "todos" || h.estado === filtro),
    [state.habits, filtro],
  );

  const contadores = useMemo(() => {
    const c = { todos: state.habits.length, activo: 0, pausado: 0, archivado: 0 };
    for (const h of state.habits) c[h.estado]++;
    return c;
  }, [state.habits]);

  function nuevaPlantilla(): Habit {
    const ahora = new Date().toISOString();
    return {
      id: uid(),
      nombre: "",
      descripcion: "",
      icono: "",
      color: COLORES[0],
      categoria: "salud",
      dias: [1, 2, 3, 4, 5, 6, 0],
      objetivo: 1,
      momentos: [{ id: uid(), tipo: "ventana", ventana: "cualquier" }],
      estado: "activo",
      creadoEn: ahora,
      actualizadoEn: ahora, // P1.3: marca LWW presente desde la creación.
      tipo: "momento",
    };
  }

  function guardar(habit: Habit) {
    guardarHabit(habit);
    setFormulario(null);
  }

  /** Creación rápida: solo el nombre, el resto va por defecto (todos los días, un momento flexible). */
  function crearRapido() {
    const nombre = nombreRapido.trim();
    if (!nombre) return;
    guardarHabit({ ...nuevaPlantilla(), nombre });
    setNombreRapido("");
    setCreacionRapida(false);
  }

  function crearDesdePlantilla(p: Plantilla) {
    guardarHabit({
      ...nuevaPlantilla(),
      nombre: p.nombre,
      categoria: p.categoria,
      color: p.color,
      tipo: p.tipo,
      objetivo: p.objetivo,
      unidad: p.unidad,
      momentos: p.momentos.map((m) => ({ id: uid(), ...m })),
    });
    setCreacionRapida(false);
  }

  /** Duplica un hábito con momentos nuevos e ids frescos. */
  function duplicar(habit: Habit) {
    const ahora = new Date().toISOString();
    guardarHabit({
      ...habit,
      id: uid(),
      nombre: `${habit.nombre || "Hábito"} (copia)`,
      momentos: habit.momentos.map((m) => ({ ...m, id: uid() })),
      estado: "activo",
      creadoEn: ahora,
      actualizadoEn: ahora,
    });
  }

  if (formulario) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setFormulario(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <IconFlechaAtras className="h-4 w-4" /> Volver
        </button>
        <HabitForm habit={formulario} onGuardar={guardar} onCancelar={() => setFormulario(null)} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Hábitos</h1>
          <p className="mt-1 text-sm text-muted">Gestiona y configura tus hábitos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contadores.activo > 0 && (
            <button type="button" onClick={() => cambiarEstadoTodos("pausado")} className="btn-secondary min-h-11 shrink-0" title="Pausar todos los hábitos (modo vacaciones)">
              <IconDescanso className="h-4 w-4" /> Pausar todos
            </button>
          )}
          {contadores.activo === 0 && contadores.pausado > 0 && (
            <button type="button" onClick={() => cambiarEstadoTodos("activo")} className="btn-secondary min-h-11 shrink-0" title="Reanudar todos los hábitos pausados">
              <IconCheck className="h-4 w-4" /> Reanudar todos
            </button>
          )}
          <button type="button" onClick={() => setCreacionRapida((v) => !v)} aria-expanded={creacionRapida} className="btn-secondary min-h-11 shrink-0" title="Crear un hábito con un solo campo">
            <IconRayo className="h-4 w-4" /> Rápido
          </button>
          <button type="button" onClick={() => setFormulario(nuevaPlantilla())} className="btn-primary min-h-11 shrink-0">
            <IconPlus className="h-4 w-4" /> Nuevo
          </button>
        </div>
      </header>

      {creacionRapida && (
        <section className="card p-4" aria-label="Creación rápida de hábito">
          <div className="flex gap-2">
            <input
              value={nombreRapido}
              onChange={(e) => setNombreRapido(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") crearRapido(); }}
              placeholder="Nombre del hábito (ej. Meditar)"
              aria-label="Nombre del hábito"
              className="input-field min-h-11 min-w-0 flex-1"
            />
            <button type="button" onClick={crearRapido} disabled={!nombreRapido.trim()} className="btn-primary min-h-11 shrink-0">
              Crear
            </button>
          </div>
          <p className="mb-2 mt-4 text-xs font-medium text-muted">O empieza con una plantilla:</p>
          <div className="flex flex-wrap gap-2">
            {PLANTILLAS.map((p) => (
              <button key={p.nombre} type="button" onClick={() => crearDesdePlantilla(p)} className="chip min-h-10 hover:border-accent hover:text-accent" title={`Crear "${p.nombre}"`}>
                <IconCategoria categoria={p.categoria} className="h-3.5 w-3.5" /> {p.nombre}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(["todos", "activo", "pausado", "archivado"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`chip ${filtro === f ? "chip-active" : "hover:border-accent hover:text-accent"}`}
          >
            {f === "todos" ? "Todos" : f.charAt(0).toUpperCase() + f.slice(1)} · {contadores[f]}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        {habitosVisibles.length === 0 ? (
          <div className="card border-dashed p-10 text-center">
            <p className="text-sm text-muted">No hay hábitos aquí todavía.</p>
          </div>
        ) : (
          habitosVisibles.map((habit) => (
            <article key={habit.id} className={`card flex flex-wrap items-center gap-3 sm:gap-4 p-4 transition-shadow hover:shadow-md ${habit.estado !== "activo" ? "opacity-60" : ""}`}>
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${habit.color}1f`, color: habit.color }}
              >
                <IconCategoria categoria={habit.categoria} className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-semibold">{habit.nombre || "Sin nombre"}</h2>
                  {habit.estado !== "activo" && (
                    <span className="chip !text-[10px] capitalize">{habit.estado}</span>
                  )}
                </div>
                <p className="truncate text-sm text-muted">
                  {habit.tipo === "cantidad"
                    ? `Cantidad · meta ${habit.objetivo}${habit.unidad ? ` ${habit.unidad}` : ""}`
                    : `${habit.momentos.length} momento${habit.momentos.length !== 1 ? "s" : ""} · objetivo ${habit.objetivo}`}
                </p>
              </div>
              {confirmarBorrado === habit.id ? (
                <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                  <button type="button" onClick={() => eliminarHabit(habit.id)} className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white">
                    Borrar
                  </button>
                  <button type="button" onClick={() => setConfirmarBorrado(null)} className="btn-secondary !py-1.5 !px-3 !text-sm">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={habit.estado === "activo"}
                    aria-label={`${habit.estado === "activo" ? "Pausar" : "Reactivar"} ${habit.nombre || "hábito"}`}
                    title={habit.estado === "activo" ? "Pausar" : "Reactivar"}
                    onClick={() =>
                      guardarHabit({
                        ...habit,
                        estado: habit.estado === "activo" ? "pausado" : "activo",
                      })
                    }
                    className="flex min-h-[44px] min-w-[56px] shrink-0 items-center justify-center"
                  >
                    <span
                      aria-hidden="true"
                      className={`relative h-7 w-12 rounded-full transition-colors ${habit.estado === "activo" ? "bg-accent" : "bg-border"}`}
                    >
                      <span
                        className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${habit.estado === "activo" ? "translate-x-5" : "translate-x-0"}`}
                      />
                    </span>
                  </button>
                  <button type="button" onClick={() => duplicar(habit)} className="btn-icon min-h-[40px] min-w-[40px]" title="Duplicar" aria-label={`Duplicar ${habit.nombre || "hábito"}`}>
                    <IconDuplicar className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setFormulario(habit)} className="btn-icon min-h-[40px] min-w-[40px]" title="Editar" aria-label="Editar">
                    <IconEditar className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setConfirmarBorrado(habit.id)} className="btn-icon min-h-[40px] min-w-[40px] hover:!text-danger hover:!bg-danger-soft" title="Eliminar" aria-label="Eliminar">
                    <IconBorrar className="h-4 w-4" />
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function HabitForm({
  habit,
  onGuardar,
  onCancelar,
}: {
  habit: Habit;
  onGuardar: (habit: Habit) => void;
  onCancelar: () => void;
}) {
  const [draft, setDraft] = useState<Habit>(structuredClone(habit));
  const [errorNom, setErrorNom] = useState<string | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null); // P2.5

  function patch(p: Partial<Habit>) {
    setDraft((prev) => ({ ...prev, ...p }));
    if ("nombre" in p && p.nombre !== undefined) setErrorNom(null);
  }

  function alternarMomento(id: string) {
    setDraft((prev) => {
      const existentes = prev.momentos.filter((m) => m.id !== id);
      return { ...prev, momentos: existentes.length === prev.momentos.length ? prev.momentos : existentes };
    });
  }

  return (
    <form
      className="card flex min-w-0 flex-col gap-5 p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const nombre = draft.nombre.trim();
        if (!nombre) {
          setErrorNom("El nombre es obligatorio.");
          return;
        }
        // P2.5: un hábito "momento" necesita al menos un momento y el objetivo
        // no puede exceder la cantidad de momentos (sería imposible de cumplir).
        const momentos = draft.momentos.filter((m) => m.id);
        if ((draft.tipo ?? "momento") === "momento") {
          if (momentos.length === 0) {
            setErrorForm("Añade al menos un momento para un hábito por momento.");
            return;
          }
          if (draft.objetivo > momentos.length) {
            setErrorForm(`El objetivo (${draft.objetivo}) no puede ser mayor que la cantidad de momentos (${momentos.length}).`);
            return;
          }
        }
        setErrorForm(null);
        onGuardar({ ...draft, nombre, momentos });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{habit.id ? "Editar hábito" : "Nuevo hábito"}</h2>
        <button type="button" onClick={onCancelar} className="btn-secondary !py-1.5 !text-sm">
          Cancelar
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Nombre *</span>
        <input value={draft.nombre} onChange={(e) => patch({ nombre: e.target.value })} placeholder="p. ej. Meditar cada mañana" className="input-field" aria-invalid={!!errorNom} />
        {errorNom && (
          <span role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <IconAlerta className="h-4 w-4 shrink-0" />
            {errorNom}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Descripción</span>
        <input value={draft.descripcion ?? ""} onChange={(e) => patch({ descripcion: e.target.value })} placeholder="Opcional" className="input-field" />
      </label>

      <div>
        <span className="mb-2 block text-sm font-medium">Categoría</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => patch({ categoria: c.valor })}
              className={`inline-flex items-center gap-1.5 chip ${
                draft.categoria === c.valor ? "chip-active" : "hover:border-accent"
              }`}
            >
              <IconCategoria categoria={c.valor} className="h-4 w-4" />
              {c.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium">Tipo de registro</span>
        <div className="flex flex-wrap gap-2">
          {([{ valor: "momento", etiqueta: "Por momento" }, { valor: "cantidad", etiqueta: "Por cantidad" }] as { valor: TipoHabit; etiqueta: string }[]).map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() =>
                patch({
                  tipo: t.valor,
                  // P2.5: al volver a "momento" sin momentos, crear uno por defecto —
                  // un hábito de momento sin momentos es imposible de completar.
                  ...(t.valor === "cantidad"
                    ? { momentos: [] }
                    : draft.momentos.length > 0
                      ? {}
                      : { momentos: [{ id: uid(), tipo: "ventana", ventana: "cualquier" }] }),
                })
              }
              className={`chip capitalize ${(draft.tipo ?? "momento") === t.valor ? "chip-active" : "hover:border-accent"}`}
            >
              {t.etiqueta}
              {t.valor === "cantidad" && draft.tipo === "cantidad" && draft.momentos.length === 0 && (
                <span className="ml-1 text-[10px] text-muted">· contador</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium">Color</span>
        <div className="flex flex-wrap gap-2">
          {COLORES.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => patch({ color })}
              className={`h-10 w-10 rounded-full transition-transform ${draft.color === color ? "ring-2 ring-accent ring-offset-2 ring-offset-surface scale-110" : "hover:scale-110"}`}
              style={{ backgroundColor: color }}
              aria-label={`Color ${color}`}
            />
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Días de la semana</span>
        <div className="flex flex-wrap gap-1.5">
          {DIAS_SEMANA.map((dia, i) => {
            const sel = draft.dias.includes(i);
            return (
              <button
                key={dia}
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    dias: sel ? prev.dias.filter((d) => d !== i) : [...prev.dias, i].sort(),
                  }))
                }
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                  sel ? "bg-accent text-accent-foreground" : "border border-border text-muted hover:border-accent"
                }`}
                aria-pressed={sel}
                title={dia}
              >
                {dia.slice(0, 2)}
              </button>
            );
          })}
        </div>
      </label>

      {draft.tipo === "cantidad" ? (
        <>
          <label className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-sm font-medium">Meta diaria</span>
            <input
              type="number"
              min={1}
              max={200}
              value={draft.objetivo}
              onChange={(e) => patch({ objetivo: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
              className="input-field w-24 min-h-10 text-center"
            />
          </label>
          <label className="flex items-center gap-3">
            <span className="flex-1 text-sm font-medium">Unidad</span>
            <input
              value={draft.unidad ?? ""}
              onChange={(e) => patch({ unidad: e.target.value })}
              placeholder="p. ej. vasos, litros, km"
              className="input-field flex-1 min-w-0"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-sm font-medium">Objetivo diario</span>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.objetivo}
            onChange={(e) => patch({ objetivo: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
            className="input-field w-24 min-h-10 text-center"
          />
        </label>
      )}

      {draft.tipo === "cantidad" ? (
        <p className="rounded-xl border border-border bg-surface/50 px-3 py-2 text-xs text-muted">
          Cada registro añadirá un recuento con la hora y fecha exacta, sin momentos del día programados.
        </p>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Momentos del día</span>
          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, momentos: [...prev.momentos, { id: uid(), tipo: "hora", hora: "09:00" }] }))}
            className="min-h-10 text-sm font-medium text-accent hover:underline"
          >
            + Añadir
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {draft.momentos.map((moment) => (
            <div key={moment.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
              <Select
                value={moment.tipo}
                ariaLabel="Tipo de momento"
                options={[
                  { value: "hora", label: "Hora fija" },
                  { value: "ventana", label: "Ventana" },
                ]}
                onChange={(v) =>
                  setDraft((prev) => ({
                    ...prev,
                    momentos: prev.momentos.map((m) =>
                      m.id === moment.id
                        ? { ...m, tipo: v as "hora" | "ventana", hora: v === "hora" ? m.hora ?? "09:00" : undefined, ventana: v === "ventana" ? m.ventana ?? "cualquier" : undefined }
                        : m,
                    ),
                  }))
                }
                className="min-w-0 flex-1 basis-28"
              />
              {moment.tipo === "hora" ? (
                <input type="time" aria-label="Hora del momento" value={moment.hora ?? "09:00"} onChange={(e) => setDraft((prev) => ({ ...prev, momentos: prev.momentos.map((m) => (m.id === moment.id ? { ...m, hora: e.target.value } : m)) }))} className="input-field !py-1.5 min-w-0 flex-1 basis-28" />
              ) : (
                <Select
                  value={moment.ventana ?? "cualquier"}
                  ariaLabel="Ventana del momento"
                  options={[
                    { value: "manana", label: "Mañana" },
                    { value: "tarde", label: "Tarde" },
                    { value: "noche", label: "Noche" },
                    { value: "cualquier", label: "Cualquier momento" },
                  ]}
                  onChange={(v) => setDraft((prev) => ({ ...prev, momentos: prev.momentos.map((m) => (m.id === moment.id ? { ...m, ventana: v } : m)) }))}
                  className="min-w-0 flex-1 basis-28"
                />
              )}
              <button type="button" onClick={() => alternarMomento(moment.id)} className="btn-icon ml-auto min-h-[36px] min-w-[36px] hover:!text-danger" title="Quitar" aria-label="Quitar momento">
                <IconX className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium">Estado</span>
        <div className="flex flex-wrap gap-2">
          {(["activo", "pausado", "archivado"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => patch({ estado: e })}
              className={`chip capitalize ${draft.estado === e ? "chip-active" : "hover:border-accent"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {errorForm && (
        <p role="alert" className="text-sm text-danger">
          {errorForm}
        </p>
      )}
      <button type="submit" disabled={!draft.nombre.trim()} className="btn-primary w-full justify-center">
        <IconCheck className="h-4 w-4" /> Guardar hábito
      </button>
    </form>
  );
}
