import { LOGROS, type IconoLogro } from "../lib/gamificacion";
import {
  IconCandado,
  IconCorona,
  IconEstrella,
  IconFuego,
  IconMedalla,
  IconRayo,
  IconSol,
  IconTrofeo,
} from "../lib/icons";

export const ICONOS_LOGRO: Record<IconoLogro, (props: { className?: string }) => React.JSX.Element> = {
  fuego: IconFuego,
  trofeo: IconTrofeo,
  corona: IconCorona,
  estrella: IconEstrella,
  sol: IconSol,
  rayo: IconRayo,
  medalla: IconMedalla,
};

/**
 * Estante de logros: pocos y difíciles; los bloqueados se muestran para dar meta.
 * Vive en Estadísticas (sala de trofeos), no en el inicio.
 */
export default function EstanteLogros({ logros }: { logros: string[] }) {
  return (
    <section className="card p-5" aria-label="Logros">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Logros</h2>
          <p className="mt-1 text-xs text-muted">Pocos, difíciles y para siempre</p>
        </div>
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
          {logros.length}/{LOGROS.length}
        </span>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LOGROS.map((logro) => {
          const desbloqueado = logros.includes(logro.id);
          const Icono = ICONOS_LOGRO[logro.icono];
          return (
            <li
              key={logro.id}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center ${
                desbloqueado ? "border-accent/30 bg-accent-soft/40" : "border-border bg-surface-2/40 opacity-60"
              }`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  desbloqueado ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
                }`}
              >
                {desbloqueado ? <Icono className="h-5 w-5" /> : <IconCandado className="h-5 w-5" />}
              </span>
              <p className="text-xs font-semibold leading-tight">{logro.nombre}</p>
              <p className="text-[10px] leading-tight text-muted">{logro.descripcion}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
