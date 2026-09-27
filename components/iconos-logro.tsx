import type { IconoLogro } from "../lib/gamificacion";
import {
  IconCopo,
  IconCorona,
  IconEstrella,
  IconFuego,
  IconMedalla,
  IconObjetivo,
  IconRayo,
  IconRegalo,
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
  regalo: IconRegalo,
  objetivo: IconObjetivo,
  copo: IconCopo,
};
