"use client";

import { useState } from "react";
import { LOGROS, type CategoriaLogro, type LogroDef } from "../../lib/gamificacion";
import { useStoreState } from "../../lib/store-context";
import { ICONOS_LOGRO } from "../../components/iconos-logro";
import Celebracion, { type CelebracionData } from "../../components/Celebracion";
import { IconCandado, IconEstrella, IconTrofeo } from "../../lib/icons";

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
  onCelebrar,
}: {
  logro: LogroDef;
  desbloqueado: boolean;
  onCelebrar: (logro: LogroDef) => void;
}) {
  const Icono = ICONOS_LOGRO[logro.icono];
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
          desbloqueado ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted"
        }`}
      >
        <IconEstrella className="h-3 w-3" />+{logro.xp} XP
      </span>
    </>
  );
  const clases = `flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-transform ${
    desbloqueado
      ? "border-accent/30 bg-accent-soft/40 cursor-pointer hover:scale-[1.03] active:scale-95"
      : "border-border bg-surface-2/40 opacity-60"
  }`;
  return desbloqueado ? (
    <li>
      <button type="button" onClick={() => onCelebrar(logro)} className={`${clases} w-full`} aria-label={`Celebrar logro ${logro.nombre}`}>
        {contenido}
      </button>
    </li>
  ) : (
    <li className={clases}>{contenido}</li>
  );
}

/**
 * Sala de trofeos: pestaña propia de logros. Pulsar uno desbloqueado
 * revive la celebración con su XP y su mensaje de ánimo.
 */
export default function Logros() {
  const { state } = useStoreState();
  const [revivir, setRevivir] = useState<CelebracionData | null>(null);
  const desbloqueados = new Set(state.juego?.logros ?? []);
  const xpLogros = LOGROS.filter((l) => desbloqueados.has(l.id)).reduce((s, l) => s + l.xp, 0);

  const celebrar = (logro: LogroDef): void => {
    const Icono = ICONOS_LOGRO[logro.icono];
    setRevivir({
      icono: <Icono className="h-10 w-10" />,
      titulo: `¡${logro.nombre}!`,
      detalle: `+${logro.xp} XP · ${logro.mensaje}`,
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
            <p className="mt-1 text-sm text-muted">Tu sala de trofeos. Toca uno ganado para revivirlo.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
            {desbloqueados.size}/{LOGROS.length}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
            <IconEstrella className="h-3 w-3" />+{xpLogros} XP
          </span>
        </div>
      </header>

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
              {deCategoria.map((logro) => (
                <TarjetaLogro
                  key={logro.id}
                  logro={logro}
                  desbloqueado={desbloqueados.has(logro.id)}
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
