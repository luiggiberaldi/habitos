"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStoreState } from "../lib/habitos/store-context";
import { useAuth } from "../components/AuthGate";
import { nivelEfectivo, NIVELES } from "../lib/habitos/gamificacion";
import { completadosPara, esDescanso, todayKey } from "../lib/habitos/dates";
import { flameGradient } from "../lib/core/ui/design-tokens";
import { listarCuentasConSaldos, patrimonioUsd } from "../lib/finanzas/finanzas";
import { merRpc } from "../lib/mercado/mercado";
import { AvatarNivel } from "../components/AvatarNivel";
import Logo from "../components/Logo";
import TarjetaTasas from "../components/TarjetaTasas";
import {
  IconCaja,
  IconCampana,
  IconChevronDerecha,
  IconFuego,
  IconMaletin,
} from "../lib/core/ui/icons";

/**
 * Hub de Senda — Inicio. Puerta de entrada a los espacios.
 * Muestra el nivel (el juego vive en Hábitos) y tarjetas por módulo
 * con su resumen vivo. Finanzas y Mercado llegan en sus fases.
 */
export default function Hub() {
  const { state } = useStoreState();
  const { perfil, user } = useAuth();
  const hoy = todayKey();

  const nombre = perfil?.nombre ?? user?.email?.split("@")[0] ?? "";

  const nivel = useMemo(
    () => nivelEfectivo(state.juego?.xpTotal ?? 0, state.juego?.nivelMaximo ?? 1),
    [state.juego],
  );
  const xpParaNivel =
    nivel.xpSiguiente !== null ? nivel.xpSiguiente - (state.juego?.xpTotal ?? 0) : 0;
  const nombreSiguiente = NIVELES[nivel.nivel]?.nombre ?? null;

  const habitosHoy = useMemo(
    () => state.habits.filter((h) => h.estado === "activo" && h.tipo !== "sueno" && !esDescanso(h, hoy)),
    [state.habits, hoy],
  );
  const habitosCompletados = useMemo(
    () => habitosHoy.filter((h) => completadosPara(h, hoy, state.completions).size >= h.objetivo).length,
    [habitosHoy, hoy, state.completions],
  );

  const fechaHoy = useMemo(() => {
    const f = new Intl.DateTimeFormat("es-VE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
    return f.charAt(0).toUpperCase() + f.slice(1);
  }, []);

  const [patrimonio, setPatrimonio] = useState<number | null>(null);
  const [mercadoResumen, setMercadoResumen] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    listarCuentasConSaldos()
      .then((c) => { if (vivo) setPatrimonio(patrimonioUsd(c)); })
      .catch(() => { if (vivo) setPatrimonio(null); });
    merRpc.inventario()
      .then((inv) => {
        if (!vivo) return;
        const bajos = inv.filter((i) => i.dias_agotamiento !== null && i.dias_agotamiento <= 7).length;
        setMercadoResumen(
          inv.length === 0
            ? "Inventario, lista de compras y precios"
            : bajos === 0
              ? `${inv.length} producto${inv.length === 1 ? "" : "s"} en inventario`
              : `${bajos} por agotarse · ${inv.length} en inventario`,
        );
      })
      .catch(() => { if (vivo) setMercadoResumen("Inventario, lista de compras y precios"); });
    return () => { vivo = false; };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Encabezado */}
      <header
        className="relative overflow-hidden rounded-3xl p-5 text-white"
        style={{ background: flameGradient, boxShadow: "0 18px 40px -12px rgba(248,72,24,.45)" }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 85% 0%, rgba(255,255,255,.18), transparent 60%)" }}
        />
        <div className="relative [text-shadow:0_1px_10px_rgba(0,0,0,0.30)]">
          <span className="inline-flex items-center gap-2 rounded-2xl bg-white/95 px-2.5 py-1.5 shadow">
            <Logo className="h-7 w-7" withWordmark wordmarkClassName="text-base font-bold tracking-tight text-[#CE3F14]" />
          </span>
          <p className="mt-3 text-xs text-white/85">{fechaHoy}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
            {nombre ? `Hola, ${nombre}` : "Hola"}
          </h1>
        </div>
      </header>

      {/* Nivel (el juego vive en Hábitos) */}
      <section
        aria-label="Tu nivel"
        className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm"
      >
        <AvatarNivel nivel={nivel.nivel} nombre={nivel.nombre} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            Nivel {nivel.nivel} · {nivel.nombre}
          </p>
          <p className="text-xs text-muted">
            {nivel.xpSiguiente !== null && nombreSiguiente
              ? `Te faltan ${xpParaNivel} XP para ${nombreSiguiente}`
              : "Nivel máximo alcanzado"}
          </p>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(nivel.progreso * 100)}
            aria-label="Progreso al siguiente nivel"
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(nivel.progreso * 100)}%`,
                background: flameGradient,
              }}
            />
          </div>
        </div>
        <Link
          href="/niveles"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:opacity-80"
        >
          Ver niveles
          <IconChevronDerecha className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </section>

      {/* Tasas del día (Fase 0.4: servicio de tasas) */}
      <TarjetaTasas />

      {/* Espacios */}
      <section aria-label="Tus espacios">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">
          Tus espacios
        </h2>
        <div className="flex flex-col gap-3">
          <Link
            href="/habitos"
            className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm transition-transform active:scale-[.99]"
          >
            <span
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl p-3"
              style={{ background: "#FFEDE3" }}
            >
              <IconFuego className="h-7 w-7 text-[#F84818]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-foreground">Hábitos</span>
              <span className="block truncate text-xs text-muted">
                {habitosCompletados} de {habitosHoy.length} hábitos hoy
              </span>
            </span>
            <IconChevronDerecha className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          </Link>

          <Link
            href="/finanzas"
            className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm transition-transform active:scale-[.99]"
          >
            <span
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl p-3"
              style={{ background: "#E8F0F3" }}
            >
              <IconMaletin className="h-7 w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-foreground">
                Finanzas
              </span>
              <span className="block truncate text-xs text-muted">
                {patrimonio === null
                  ? "Cuentas, gastos e ingresos del hogar"
                  : `Patrimonio: $ ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(patrimonio)}`}
              </span>
            </span>
            <IconChevronDerecha className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          </Link>

          <Link
            href="/mercado"
            className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm transition-transform active:scale-[.99]"
          >
            <span
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl p-3"
              style={{ background: "#EAF4EF" }}
            >
              <IconCaja className="h-7 w-7 text-[#2E9E7B]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-foreground">
                Mercado
              </span>
              <span className="block truncate text-xs text-muted">
                {mercadoResumen ?? "Inventario, lista de compras y precios"}
              </span>
            </span>
            <IconChevronDerecha className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          </Link>

          <Link
            href="/control"
            className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-sm transition-transform active:scale-[.99]"
          >
            <span
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl p-3"
              style={{ background: "#EDE9F7" }}
            >
              <IconCampana className="h-7 w-7 text-[#5B4BB5]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-foreground">
                Control
              </span>
              <span className="block truncate text-xs text-muted">
                Pagos, presupuestos, deudas, metas y cierre
              </span>
            </span>
            <IconChevronDerecha className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
