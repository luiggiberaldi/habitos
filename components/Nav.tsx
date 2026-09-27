"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import { useAuth } from "./AuthGate";
import { useStoreActions } from "../lib/store-context";
import { IconAjustes, IconEstadisticas, IconInicio, IconLista, IconCerrarSesion } from "../lib/icons";
// import { IconUsuarios } from "../lib/icons"; // Liga oculta por ahora

const items = [
  { href: "/", label: "Hoy", icon: IconInicio },
  { href: "/habitos", label: "Hábitos", icon: IconLista },
  // { href: "/liga", label: "Liga", icon: IconUsuarios }, // ← pestaña oculta por ahora
  { href: "/estadisticas", label: "Estadísticas", icon: IconEstadisticas },
  { href: "/ajustes", label: "Ajustes", icon: IconAjustes },
];

export default function Nav() {
  const pathname = usePathname();
  const { user, cerrarSesion } = useAuth();
  const { sincronizarAhora } = useStoreActions();

  // E3: reenviar la cola pendiente antes de salir — si no, quedaba huérfana
  // bajo la clave del usuario anterior.
  const salir = async () => {
    try {
      await sincronizarAhora();
    } finally {
      await cerrarSesion();
    }
  };

  return (
    <>
      {/* P2.10: skip-link para navegación por teclado. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Saltar al contenido
      </a>
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
                aria-current={activo ? "page" : undefined}
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
            onClick={salir}
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
                aria-current={activo ? "page" : undefined}
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
            onClick={salir}
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

