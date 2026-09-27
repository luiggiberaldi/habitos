"use client";

import Link from "next/link";
import {
  IconAjustes,
  IconChevronDerecha,
  IconEstadisticas,
  IconMedalla,
  IconTrofeo,
} from "../../lib/core/ui/icons";

/**
 * "Más" — accesos del módulo Hábitos que no caben en la barra inferior
 * de la suite (Logros, Niveles, Estadísticas, Ajustes).
 */
const ENLACES = [
  { href: "/logros", etiqueta: "Logros", detalle: "Tu sala de trofeos", Icono: IconTrofeo },
  { href: "/niveles", etiqueta: "Niveles", detalle: "Los 9 niveles y tu progreso", Icono: IconMedalla },
  { href: "/estadisticas", etiqueta: "Estadísticas", detalle: "Tus números en el tiempo", Icono: IconEstadisticas },
  { href: "/ajustes", etiqueta: "Ajustes", detalle: "Cuenta, usuarios y la app", Icono: IconAjustes },
];

export default function Mas() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Más</h1>
      <nav aria-label="Más opciones" className="flex flex-col gap-3">
        {ENLACES.map(({ href, etiqueta, detalle, Icono }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm transition-transform active:scale-[.99]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2">
              <Icono className="h-6 w-6 text-muted" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-foreground">{etiqueta}</span>
              <span className="block truncate text-xs text-muted">{detalle}</span>
            </span>
            <IconChevronDerecha className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
