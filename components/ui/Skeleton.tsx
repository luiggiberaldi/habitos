/**
 * Bloques esqueleto con shimmer para estados de carga (patrón de Uiverse):
 * la pantalla muestra la forma del contenido en vez de un texto plano.
 */

/** Bloque genérico pulsante. Todo redondeado (regla de UI 1). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`animate-pulse rounded-xl bg-surface-2 ${className}`} />
  );
}

/** Esqueleto de la lista de ligas: dos tarjetas con la forma real. */
export function SkeletonLiga() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando ligas">
      {[0, 1].map((i) => (
        <div key={i} className="card p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-5/6" />
          </div>
          <Skeleton className="mt-4 h-11 w-full" />
        </div>
      ))}
      <span className="sr-only">Cargando tus ligas…</span>
    </div>
  );
}
