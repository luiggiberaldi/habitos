/**
 * Icono por categoría de hábito (dominio Hábitos).
 * Vive aquí —y no en el set genérico de `lib/core/ui/icons`— porque las
 * categorías (`Categoria`) son conocimiento del dominio de hábitos.
 */
import type { Categoria } from "./types";
import {
  IconBrote,
  IconCaja,
  IconCorazon,
  IconLoto,
  IconMaletin,
  IconPersona,
  type IconProps,
} from "../core/ui/icons";

const categoriaIconMap: Record<Categoria, React.FC<IconProps>> = {
  salud: IconCorazon,
  productividad: IconMaletin,
  crecimiento: IconBrote,
  bienestar: IconLoto,
  personal: IconPersona,
  otro: IconCaja,
};

export function IconCategoria({ categoria, className = "w-6 h-6" }: { categoria: Categoria } & IconProps) {
  const Component = categoriaIconMap[categoria] ?? IconCaja;
  return <Component className={className} />;
}
