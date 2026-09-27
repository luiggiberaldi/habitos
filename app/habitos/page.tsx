"use client";

import { useMemo, useState } from "react";
import { useStoreActions, useStoreState } from "../../lib/store-context";
import type { Habit, EstadoHabit } from "../../lib/types";
import { habitColors as COLORES } from "../../lib/design-tokens";
import { WizardHabito } from "../../components/WizardHabito";
import {
  IconBorrar,
  IconCategoria,
  IconCheck,
  IconDescanso,
  IconDuplicar,
  IconEditar,
  IconPlus,
  IconRayo,
} from "../../lib/icons";

import { PLANTILLAS, habitoDesdePlantilla, type Plantilla } from "../../lib/plantillas";

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

  // Sueño se configura desde su tarjeta en la home: aquí no aparece
  // (no se puede borrar, archivar ni editar como hábito normal).
  const habitosVisibles = useMemo(
    () => state.habits.filter((h) => h.tipo !== "sueno" && (filtro === "todos" || h.estado === filtro)),
    [state.habits, filtro],
  );

  const contadores = useMemo(() => {
    // Igual que la lista: Sueño no se gestiona aquí, tampoco se cuenta.
    const visibles = state.habits.filter((h) => h.tipo !== "sueno");
    const c = { todos: visibles.length, activo: 0, pausado: 0, archivado: 0 };
    for (const h of visibles) c[h.estado]++;
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
    guardarHabit(habitoDesdePlantilla(p));
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
    const esNuevo = !state.habits.some((h) => h.id === formulario.id);
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <WizardHabito
          habit={formulario}
          esNuevo={esNuevo}
          onGuardar={guardar}
          onCancelar={() => setFormulario(null)}
        />
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

