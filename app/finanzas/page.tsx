"use client";

import Link from "next/link";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import { IconMaletin, IconFlechaAtras } from "../../lib/core/ui/icons";

/** Placeholder de Finanzas hasta la Fase 1. */
export default function FinanzasProximamente() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6">
      <span
        className="flex h-20 w-20 items-center justify-center rounded-3xl"
        style={{ background: "#E8F0F3" }}
      >
        <IconMaletin className="h-10 w-10" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Finanzas</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">
          El libro del hogar: cuentas en Bs, $ y crypto, movimientos, presupuestos
          y deudas. Llega en la Fase 1.
        </p>
      </div>
      <span
        className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white"
        style={{ background: flameGradient }}
      >
        Próximamente
      </span>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
        style={{ background: "#FFEDE3", color: "#CE3F14" }}
      >
        <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
        Volver al inicio
      </Link>
    </div>
  );
}
