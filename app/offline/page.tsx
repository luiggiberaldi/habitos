"use client";

import Link from "next/link";

/**
 * Página de fallback offline (P2.7): el service worker la sirve cuando una
 * navegación falla sin conexión. No usa el store ni Supabase a propósito.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl" aria-hidden="true">
          📴
        </div>
        <h1 className="mb-2 text-xl font-bold text-foreground">Sin conexión</h1>
        <p className="mb-6 text-sm text-muted">
          No pudimos cargar esta página porque no hay conexión a internet.
          Tus datos guardados siguen disponibles cuando vuelvas a una página ya visitada.
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            Reintentar
          </button>
          <Link href="/" className="btn-secondary">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
