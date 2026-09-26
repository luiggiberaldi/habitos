"use client";

import { useMemo, useState } from "react";
import { useStore } from "../../lib/store-context";
import { DIAS_SEMANA } from "../../lib/dates";
import type { Categoria, Habit, EstadoHabit, TipoHabit } from "../../lib/types";
import {
  IconAlerta,
  IconBorrar,
  IconCategoria,
  IconCheck,
  IconEditar,
  IconFlechaAtras,
  IconPlus,
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

const COLORES = ["#328b78", "#6366f1", "#d28a4d", "#ef4444", "#3b82f6", "#a855f7", "#22c55e", "#eab308"];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function GestionHabitos() {
  const { state, guardarHabit, eliminarHabit } = useStore();
  const [formulario, setFormulario] = useState<Habit | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | EstadoHabit>("todos");

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
      tipo: "momento",
    };
  }

  function guardar(habit: Habit) {
    guardarHabit(habit);
    setFormulario(null);
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
        <button type="button" onClick={() => setFormulario(nuevaPlantilla())} className="btn-primary min-h-11 shrink-0">
          <IconPlus className="h-4 w-4" /> Nuevo
        </button>
      </header>

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
            <article key={habit.id} className="card flex flex-wrap items-center gap-3 sm:gap-4 p-4 transition-shadow hover:shadow-md">
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
        onGuardar({ ...draft, nombre, momentos: draft.momentos.filter((m) => m.id) });
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
              onClick={() => patch({ tipo: t.valor, ...(t.valor === "cantidad" ? { momentos: [] } : {}) })}
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
              <select
                value={moment.tipo}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    momentos: prev.momentos.map((m) =>
                      m.id === moment.id
                        ? { ...m, tipo: e.target.value as "hora" | "ventana", hora: e.target.value === "hora" ? m.hora ?? "09:00" : undefined, ventana: e.target.value === "ventana" ? m.ventana ?? "cualquier" : undefined }
                        : m,
                    ),
                  }))
                }
                className="input-field !py-1.5 min-w-0 flex-1 basis-28"
              >
                <option value="hora">Hora fija</option>
                <option value="ventana">Ventana</option>
              </select>
              {moment.tipo === "hora" ? (
                <input type="time" value={moment.hora ?? "09:00"} onChange={(e) => setDraft((prev) => ({ ...prev, momentos: prev.momentos.map((m) => (m.id === moment.id ? { ...m, hora: e.target.value } : m)) }))} className="input-field !py-1.5 min-w-0 flex-1 basis-28" />
              ) : (
                <select value={moment.ventana ?? "cualquier"} onChange={(e) => setDraft((prev) => ({ ...prev, momentos: prev.momentos.map((m) => (m.id === moment.id ? { ...m, ventana: e.target.value } : m)) }))} className="input-field !py-1.5 min-w-0 flex-1 basis-28">
                  <option value="manana">Mañana</option>
                  <option value="tarde">Tarde</option>
                  <option value="noche">Noche</option>
                  <option value="cualquier">Cualquier momento</option>
                </select>
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

      <button type="submit" disabled={!draft.nombre.trim()} className="btn-primary w-full justify-center">
        <IconCheck className="h-4 w-4" /> Guardar hábito
      </button>
    </form>
  );
}
