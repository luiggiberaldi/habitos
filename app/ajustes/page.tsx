"use client";

import { useStore } from "../../lib/store-context";
import { IconCampana, IconDescanso, IconLuna, IconMovimiento, IconSistema, IconSol } from "../../lib/icons";

export default function Ajustes() {
  const { state, guardarSettings } = useStore();
  const settings = state.settings;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted">Personaliza tu experiencia.</p>
      </header>

      {/* Tema */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <IconLuna className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Apariencia</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3 sm:gap-3">
          {([
            { valor: "claro" as const, etiqueta: "Claro", icon: IconSol },
            { valor: "oscuro" as const, etiqueta: "Oscuro", icon: IconLuna },
            { valor: "sistema" as const, etiqueta: "Sistema", icon: IconSistema },
          ]).map((opcion) => {
            const activo = settings.tema === opcion.valor;
            return (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => guardarSettings({ ...settings, tema: opcion.valor })}
                className={`flex min-h-12 flex-row items-center justify-center gap-2 rounded-xl border-2 p-3 transition-all min-[380px]:min-h-24 min-[380px]:flex-col min-[380px]:p-4 ${
                  activo
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <opcion.icon className={`h-6 w-6 ${activo ? "text-accent" : "text-muted"}`} />
                <span className={`text-sm font-medium capitalize ${activo ? "text-accent" : "text-muted"}`}>
                  {opcion.etiqueta}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Reducir movimiento */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:flex-nowrap sm:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <IconMovimiento className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">Reducir movimiento</h2>
            <p className="text-sm text-muted">Atenúa animaciones y transiciones.</p>
          </div>
        </div>
        <Switch
          checked={settings.reducirMovimiento}
          onChange={(v) => guardarSettings({ ...settings, reducirMovimiento: v })}
        />
      </section>

      {/* Notificaciones */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:flex-nowrap sm:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <IconCampana className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">Notificaciones</h2>
            <p className="text-sm text-muted">Recuerda tus momentos del día.</p>
          </div>
        </div>
        <Switch
          checked={settings.notificaciones}
          onChange={(v) => guardarSettings({ ...settings, notificaciones: v })}
        />
      </section>

      {/* Horas de descanso */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <IconDescanso className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">Horas de descanso</h2>
            <p className="text-sm text-muted">Ventana sin recordatorios de hábitos.</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-[380px]:flex-row">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Inicio</span>
            <input
              type="time"
              value={settings.horasDescanso.inicio}
              onChange={(e) =>
                guardarSettings({
                  ...settings,
                  horasDescanso: { ...settings.horasDescanso, inicio: e.target.value },
                })
              }
              className="input-field"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Fin</span>
            <input
              type="time"
              value={settings.horasDescanso.fin}
              onChange={(e) =>
                guardarSettings({
                  ...settings,
                  horasDescanso: { ...settings.horasDescanso, fin: e.target.value },
                })
              }
              className="input-field"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="switch-track min-h-11 min-w-11 shrink-0"
      data-checked={checked ? "true" : "false"}
    >
      <span className="switch-thumb" />
    </button>
  );
}
