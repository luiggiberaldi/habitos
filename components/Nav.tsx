"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import { useAuth } from "./AuthGate";
import { IconAjustes, IconEstadisticas, IconInicio, IconLista, IconCerrarSesion } from "../lib/icons";

const items = [
  { href: "/", label: "Hoy", icon: IconInicio },
  { href: "/habitos", label: "Hábitos", icon: IconLista },
  { href: "/estadisticas", label: "Estadísticas", icon: IconEstadisticas },
  { href: "/ajustes", label: "Ajustes", icon: IconAjustes },
];

export default function Nav() {
  const pathname = usePathname();
  const { user, cerrarSesion } = useAuth();

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border md:bg-surface md:fixed md:inset-y-0 md:z-30">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo className="h-9 w-9" withWordmark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {items.map((item) => {
            const activo = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  activo
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <button
            onClick={cerrarSesion}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-all hover:bg-surface-2 hover:text-foreground"
          >
            <IconCerrarSesion className="h-5 w-5" />
            Cerrar sesión
          </button>
          {user && (
            <p className="mt-1 px-3 text-xs text-muted truncate">{user.email}</p>
          )}
        </div>
      </aside>

      {/* Bottom nav mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around">
          {items.map((item) => {
            const activo = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-3 text-[11px] font-medium transition-colors min-h-[44px] justify-center ${
                  activo ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${activo ? "stroke-[2.2]" : ""}`} />
                <span className="truncate max-w-full">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={cerrarSesion}
            aria-label="Cerrar sesión"
            className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-3 text-[11px] font-medium text-muted transition-colors hover:text-foreground min-h-[44px]"
          >
            <IconCerrarSesion className="h-5 w-5" />
            <span className="truncate max-w-full">Salir</span>
          </button>
        </div>
      </nav>
    </>
  );
}

