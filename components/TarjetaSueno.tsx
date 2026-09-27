"use client";

import { useEffect, useMemo, useState } from "react";
import { formatHoraA12, hhmmDeFecha, hhmmDeTimestamp, moverFecha, todayKey } from "../lib/dates";
import { nochesSueno } from "../lib/gamificacion";
import { IconAjustes, IconCheck, IconLuna, IconSol, IconX } from "../lib/icons";
import { TimeField } from "./TimeField";
import { useStoreActions, useStoreState } from "../lib/store-context";
import type { Habit, MarcaSueno } from "../lib/types";

/* --------------------------- Modal de confirmación --------------------------- */

interface ModalHoraState {
  cual: MarcaSueno;
  hora: string;
  fecha: string;
  existe: boolean;
}

function ModalHora({ modal, onClose }: { modal: ModalHoraState; onClose: () => void }) {
  const { registrarSueno } = useStoreActions();
  const { state } = useStoreState();
  const habit = state.habits.find((h) => h.tipo === "sueno") ?? null;
  // El modal se monta de nuevo en cada apertura (key en el padre): el estado
  // inicial basta, sin sincronizar por efecto.
  const [hora, setHora] = useState(modal.hora);
  const esLevantar = modal.cual === "levantar";
  const habitoId = habit?.id ?? "";

  useEffect(() => {
    const alTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alTeclar);
    return () => window.removeEventListener("keydown", alTeclar);
  }, [onClose]);

  const confirmar = () => {
    if (!habitoId || !/^\d{2}:\d{2}$/.test(hora)) return;
    registrarSueno(habitoId, modal.cual, hora, modal.fecha);
    onClose();
  };

  const etiquetaFecha = esLevantar ? "Hoy" : modal.fecha === todayKey() ? "Esta noche" : "Anoche";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={esLevantar ? "Me levanté" : "Me acosté"}
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">{esLevantar ? "Me levanté" : "Me acosté"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-2 text-muted hover:bg-surface-2"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          ¿A qué hora {esLevantar ? "te levantaste" : "te acostaste"}? ({etiquetaFecha.toLowerCase()})
        </p>
        <TimeField
          value={hora}
          onChange={setHora}
          className="mt-4 w-full rounded-2xl border border-border bg-surface-2 px-4 py-3 text-xl text-fg"
          ariaLabel={esLevantar ? "Hora en que te levantaste" : "Hora en que te acostaste"}
        />
        <p className="mt-3 text-xs text-muted">
          {modal.existe
            ? "Vas a corregir la marca de este día; el XP se recalcula."
            : "Cuenta para este día. Si fue a tiempo, ganas +10 XP."}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-border px-4 py-3 font-semibold text-fg hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!/^\d{2}:\d{2}$/.test(hora)}
            className="btn-primary flex-1 rounded-2xl px-4 py-3 font-semibold disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Configuración ------------------------------ */

function ModalConfig({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const { guardarHabit } = useStoreActions();
  const [horaAcostar, setHoraAcostar] = useState(habit.horaAcostar ?? "22:00");
  const [horaLevantar, setHoraLevantar] = useState(habit.horaLevantar ?? "06:00");
  const [objetivoHoras, setObjetivoHoras] = useState(habit.objetivoHoras ?? 8);

  useEffect(() => {
    const alTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alTeclar);
    return () => window.removeEventListener("keydown", alTeclar);
  }, [onClose]);

  const valido =
    /^\d{2}:\d{2}$/.test(horaAcostar) &&
    /^\d{2}:\d{2}$/.test(horaLevantar) &&
    Number.isFinite(objetivoHoras) &&
    objetivoHoras >= 4 &&
    objetivoHoras <= 12;

  const guardar = () => {
    if (!valido) return;
    guardarHabit({ ...habit, horaAcostar, horaLevantar, objetivoHoras });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurar sueño"
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">Configurar sueño</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-2 text-muted hover:bg-surface-2"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium text-fg">Acostarme a las</p>
            <TimeField
              value={horaAcostar}
              onChange={setHoraAcostar}
              ariaLabel="Hora de acostarse"
              className="w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-fg"
            />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-fg">Levantarme a las</p>
            <TimeField
              value={horaLevantar}
              onChange={setHoraLevantar}
              ariaLabel="Hora de levantarse"
              className="w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-fg"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Objetivo de horas dormidas</label>
            <input
              type="number"
              min={4}
              max={12}
              step={0.5}
              value={objetivoHoras}
              onChange={(e) => setObjetivoHoras(Number(e.target.value))}
              className="w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-fg"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          El sueño siempre está activo: no se puede borrar ni archivar. El modo vacaciones lo pausa.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-border px-4 py-3 font-semibold text-fg hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!valido}
            className="btn-primary flex-1 rounded-2xl px-4 py-3 font-semibold disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Tarjeta --------------------------------- */

function BotonMarca({
  cual,
  marcado,
  horaMarcada,
  horaObjetivo,
  onAbrir,
}: {
  cual: MarcaSueno;
  marcado: boolean;
  horaMarcada: string | null;
  horaObjetivo: string;
  onAbrir: () => void;
}) {
  const esLevantar = cual === "levantar";
  const Icono = esLevantar ? IconSol : IconLuna;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl border px-4 py-4 transition-colors ${
        marcado
          ? "border-accent/50 bg-accent-soft"
          : "border-border bg-surface-2 hover:border-accent/40"
      }`}
      aria-pressed={marcado}
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
          esLevantar ? "bg-amber-500/15 text-amber-500" : "bg-indigo-500/15 text-indigo-400"
        }`}
      >
        <Icono className="h-6 w-6" />
      </span>
      <span className="font-semibold text-fg">{esLevantar ? "Me levanté" : "Me acosté"}</span>
      <span className="text-xs text-muted">
        {marcado && horaMarcada ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <IconCheck className="h-3.5 w-3.5" /> {formatHoraA12(horaMarcada)}
          </span>
        ) : (
          `Meta ${formatHoraA12(horaObjetivo)}`
        )}
      </span>
    </button>
  );
}

export function TarjetaSueno({ habit }: { habit: Habit }) {
  const { state } = useStoreState();
  const completions = state.completions;
  const [modal, setModal] = useState<ModalHoraState | null>(null);
  const [configAbierta, setConfigAbierta] = useState(false);

  const hoy = todayKey();
  const ahora = useMemo(() => new Date(), []);
  // "Me acosté" después de medianoche pertenece a la noche anterior.
  const nocheAcostar = hhmmDeFecha(ahora) < "12:00" ? moverFecha(hoy, -1) : hoy;

  const evento = (cual: MarcaSueno, fecha: string) =>
    completions.find((c) => c.habitId === habit.id && c.momentId === cual && c.fecha === fecha) ?? null;

  const levantarHoy = evento("levantar", hoy);
  const acostarNoche = evento("acostar", nocheAcostar);

  // Horas dormidas de la última noche completa (log invisible → referencia visual).
  const noches = nochesSueno(habit, completions);
  const ultima = noches.length > 0 ? noches[noches.length - 1] : null;
  const objetivoHoras = habit.objetivoHoras ?? 8;
  const horasTexto =
    ultima && Math.abs(ultima.horas - objetivoHoras) < 0.05
      ? `${ultima.horas.toFixed(1)} h`
      : ultima
        ? `${ultima.horas.toFixed(1)} h / ${objetivoHoras} h`
        : null;

  const abrir = (cual: MarcaSueno) => {
    // `ahora` fresco en cada apertura: el memoizado del componente puede tener
    // horas si la app quedó abierta. La sugerencia es siempre la hora actual
    // (editable); la noche se resuelve con la regla de medianoche.
    const ahoraFresco = new Date();
    const hoyFresco = todayKey(ahoraFresco);
    const fecha =
      cual === "levantar"
        ? hoyFresco
        : hhmmDeFecha(ahoraFresco) < "12:00"
          ? moverFecha(hoyFresco, -1)
          : hoyFresco;
    const existente = evento(cual, fecha);
    setModal({
      cual,
      hora: existente ? hhmmDeTimestamp(existente.timestamp) : hhmmDeFecha(ahoraFresco),
      fecha,
      existe: !!existente,
    });
  };

  return (
    <>
      <section
        aria-label="Sueño"
        className="rounded-3xl border border-border bg-surface p-5 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
            <IconLuna className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-fg">Sueño</h2>
            <p className="truncate text-xs text-muted">
              {formatHoraA12(habit.horaAcostar ?? "22:00")} → {formatHoraA12(habit.horaLevantar ?? "06:00")}
              {horasTexto ? ` · Anoche: ${horasTexto}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfigAbierta(true)}
            aria-label="Configurar sueño"
            className="rounded-2xl p-2.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <IconAjustes className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex gap-3">
          <BotonMarca
            cual="levantar"
            marcado={!!levantarHoy}
            horaMarcada={levantarHoy ? hhmmDeTimestamp(levantarHoy.timestamp) : null}
            horaObjetivo={habit.horaLevantar ?? "06:00"}
            onAbrir={() => abrir("levantar")}
          />
          <BotonMarca
            cual="acostar"
            marcado={!!acostarNoche}
            horaMarcada={acostarNoche ? hhmmDeTimestamp(acostarNoche.timestamp) : null}
            horaObjetivo={habit.horaAcostar ?? "22:00"}
            onAbrir={() => abrir("acostar")}
          />
        </div>
      </section>
      {modal && <ModalHora key={`${modal.cual}|${modal.fecha}`} modal={modal} onClose={() => setModal(null)} />}
      {configAbierta && <ModalConfig habit={habit} onClose={() => setConfigAbierta(false)} />}
    </>
  );
}
