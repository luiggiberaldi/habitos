"use client";

import { useState } from "react";
import { LOGROS, type CategoriaLogro, type LogroDef } from "../../lib/habitos/gamificacion";
import { useStore } from "../../lib/habitos/store-context";
import { ICONOS_LOGRO } from "../../components/iconos-logro";
import Celebracion, { type CelebracionData } from "../../components/Celebracion";
import { IconCandado, IconEstrella, IconRegalo, IconTrofeo } from "../../lib/core/ui/icons";

const CATEGORIAS: CategoriaLogro[] = [
  "Rachas",
  "Días perfectos",
  "Registros",
  "Madrugadas",
  "Niveles",
  "Colección",
  "Extras",
];

function TarjetaLogro({
  logro,
  desbloqueado,
  reclamado,
  indice,
  onCelebrar,
}: {
  logro: LogroDef;
  desbloqueado: boolean;
  reclamado: boolean;
  /** Posición en la grilla: entrada escalonada (tope 600ms). */
  indice: number;
  onCelebrar: (logro: LogroDef) => void;
}) {
  const retrasoEntrada = `${Math.min(indice, 10) * 60}ms`;
  const Icono = ICONOS_LOGRO[logro.icono];
  const pendiente = desbloqueado && !reclamado;
  const contenido = (
    <>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full ${
          desbloqueado ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
        }`}
      >
        {desbloqueado ? <Icono className="h-6 w-6" /> : <IconCandado className="h-5 w-5" />}
      </span>
      <p className="text-xs font-semibold leading-tight">{logro.nombre}</p>
      <p className="text-[10px] leading-tight text-muted">{logro.descripcion}</p>
      <span
        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
          pendiente
            ? "bg-accent text-accent-foreground animate-pulse"
            : desbloqueado
              ? "bg-accent-soft text-accent"
              : "bg-surface-2 text-muted"
        }`}
      >
        <IconEstrella className="h-3 w-3" />
        {pendiente ? `¡Reclamar +${logro.xp} XP!` : `+${logro.xp} XP`}
      </span>
    </>
  );
  const clases = `flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-transform ${
    pendiente
      ? "border-accent/60 bg-accent-soft/60 cursor-pointer hover:scale-[1.03] active:scale-95 shadow-[0_0_0_3px_var(--accent-soft)]"
      : desbloqueado
        ? "border-accent/30 bg-accent-soft/40 cursor-pointer hover:scale-[1.03] active:scale-95"
        : "border-border bg-surface-2/40 opacity-60"
  }`;
  return desbloqueado ? (
    <li className="animate-entrada relative pt-2" style={{ animationDelay: retrasoEntrada }}>
      {pendiente && (
        <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground shadow">
          Sin abrir
        </span>
      )}
      <button
        type="button"
        onClick={() => onCelebrar(logro)}
        className={`${clases} w-full`}
        aria-label={pendiente ? `Reclamar premio del logro ${logro.nombre}` : `Celebrar logro ${logro.nombre}`}
      >
        {contenido}
      </button>
    </li>
  ) : (
    <li className={`animate-entrada ${clases}`} style={{ animationDelay: retrasoEntrada }}>{contenido}</li>
  );
}

/**
 * Sala de trofeos: el premio de XP de un logro se libera al tocarlo
 * (animación + XP en ese momento). Tocar uno ya reclamado solo revive
 * la animación, sin otorgar XP de nuevo.
 */
export default function Logros() {
  const { state, reclamarLogro } = useStore();
  const [revivir, setRevivir] = useState<CelebracionData | null>(null);
  const desbloqueados = new Set(state.juego?.logros ?? []);
  const reclamados = new Set(state.juego?.logrosReclamados ?? []);
  const xpReclamado = LOGROS.filter((l) => reclamados.has(l.id)).reduce((s, l) => s + l.xp, 0);
  const pendientes = LOGROS.filter((l) => desbloqueados.has(l.id) && !reclamados.has(l.id));

  const celebrar = (logro: LogroDef): void => {
    const Icono = ICONOS_LOGRO[logro.icono];
    if (!reclamados.has(logro.id)) {
      const res = reclamarLogro(logro.id);
      if (res.xpGanado > 0) {
        setRevivir({
          icono: <Icono className="h-10 w-10" />,
          titulo: logro.nombre,
          detalle: res.nivel
            ? `${logro.mensaje} · ¡Subiste al nivel ${res.nivel.nivel}: ${res.nivel.nombre}!`
            : logro.mensaje,
          efecto: "trofeo",
          xp: res.xpGanado,
        });
        return;
      }
    }
    // Ya reclamado: revive la animación sin otorgar XP de nuevo.
    setRevivir({
      icono: <Icono className="h-10 w-10" />,
      titulo: logro.nombre,
      detalle: `Ya reclamaste sus +${logro.xp} XP · ${logro.mensaje}`,
      efecto: "trofeo",
      xp: logro.xp,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
            <IconTrofeo className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Logros</h1>
            <p className="mt-1 text-sm text-muted">Tu sala de trofeos. Toca un logro ganado para reclamar su premio.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
            {desbloqueados.size}/{LOGROS.length}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
            <IconEstrella className="h-3 w-3" />+{xpReclamado} XP
          </span>
        </div>
      </header>

      {pendientes.length > 0 && (
        <div
          className="card flex items-center gap-3 border-accent/40 bg-accent-soft/60 p-4"
          role="status"
          aria-live="polite"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground animate-pulse">
            <IconRegalo className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">
              Tienes {pendientes.length} {pendientes.length === 1 ? "premio" : "premios"} sin abrir
            </p>
            <p className="text-sm text-muted">Toca cada logro brillante para liberar sus XP.</p>
          </div>
        </div>
      )}

      {CATEGORIAS.map((categoria) => {
        const deCategoria = LOGROS.filter((l) => l.categoria === categoria);
        if (deCategoria.length === 0) return null;
        const ganados = deCategoria.filter((l) => desbloqueados.has(l.id)).length;
        return (
          <section key={categoria} aria-label={categoria}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">{categoria}</h2>
              <span className="text-xs text-muted">
                {ganados}/{deCategoria.length}
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {deCategoria.map((logro, i) => (
                <TarjetaLogro
                  key={logro.id}
                  logro={logro}
                  desbloqueado={desbloqueados.has(logro.id)}
                  reclamado={reclamados.has(logro.id)}
                  indice={i}
                  onCelebrar={celebrar}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {revivir && <Celebracion data={revivir} onCerrar={() => setRevivir(null)} />}
    </div>
  );
}
