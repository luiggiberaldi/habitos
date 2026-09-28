"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthGate";
import AvatarPerfil from "./AvatarPerfil";
import Logo from "./Logo";
import { useStoreActions, useStoreState } from "../lib/habitos/store-context";
import { premiosPendientes } from "../lib/habitos/juego";
import { IconAjustes, IconCaja, IconInicio, IconLista, IconMaletin, IconMas, IconCerrarSesion } from "../lib/core/ui/icons";
// import { IconUsuarios } from "../lib/core/ui/icons"; // Liga oculta por ahora

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => React.JSX.Element; match?: string[] };

/** Pestañas de la suite (barra inferior en móvil, sidebar en desktop). */
const tabs: NavItem[] = [
  { href: "/", label: "Inicio", icon: IconInicio },
  { href: "/habitos", label: "Hábitos", icon: IconLista },
  { href: "/finanzas", label: "Finanzas", icon: IconMaletin },
  { href: "/mercado", label: "Mercado", icon: IconCaja },
  // "Más" agrupa en móvil lo que no cabe en la barra: ajustes, control y coach.
  { href: "/mas", label: "Más", icon: IconMas, match: ["/mas", "/ajustes", "/control", "/coach"] },
];

function estaActivo(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

export default function Nav() {
  const pathname = usePathname();
  const { perfil, salirAPerfil } = useAuth();
  const { sincronizarAhora } = useStoreActions();
  const { state } = useStoreState();
  // Premios de logros desbloqueados sin reclamar (tap en la sala de trofeos).
  const pendientes = premiosPendientes(state.juego);

  // E3: reenviar la cola pendiente antes de salir — si no, quedaba huérfana
  // bajo la clave del usuario anterior.
  // "Salir" vuelve al selector de perfiles (login de usuarios), no cierra la
  // sesión de la nube (eso sigue en Ajustes → Cuenta).
  const salir = async () => {
    try {
      await sincronizarAhora();
    } finally {
      salirAPerfil();
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
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted">Senda</p>
          {tabs.filter((t) => t.href !== "/mas").map((item) => {
            const activo = estaActivo(item, pathname);
            const Icon = item.icon;
            const conPremios = item.href === "/habitos" && pendientes > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={activo ? "page" : undefined}
                aria-label={conPremios ? `Hábitos, ${pendientes} premios por reclamar en Logros` : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  activo
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
                {conPremios && (
                  <span
                    aria-hidden="true"
                    className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-foreground animate-pulse"
                  >
                    {pendientes}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <Link
            href="/ajustes"
            aria-current={pathname.startsWith("/ajustes") ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              pathname.startsWith("/ajustes")
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <IconAjustes className="h-5 w-5" />
            Ajustes
          </Link>
          <button
            onClick={salir}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-all hover:bg-surface-2 hover:text-foreground"
          >
            <IconCerrarSesion className="h-5 w-5" />
            Salir
          </button>
          {perfil ? (
            <Link
              href="/ajustes"
              className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-surface-2"
              aria-label={`Perfil ${perfil.nombre}: ir a ajustes`}
            >
              <AvatarPerfil perfil={perfil} className="h-7 w-7 text-xs" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{perfil.nombre}</span>
              </span>
            </Link>
          ) : null}
        </div>
      </aside>

      {/* Bottom nav mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around">
          {tabs.map((item) => {
            const activo = estaActivo(item, pathname);
            const Icon = item.icon;
            const conPremios = item.href === "/mas" && pendientes > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={activo ? "page" : undefined}
                aria-label={conPremios ? `Más, ${pendientes} premios por reclamar en Logros` : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-3 text-[11px] font-medium transition-colors min-h-[44px] justify-center ${
                  activo ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                <span className="relative">
                  <Icon className={`h-5 w-5 ${activo ? "stroke-[2.2]" : ""}`} />
                  {conPremios && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full bg-accent ring-2 ring-surface animate-pulse"
                    />
                  )}
                </span>
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
