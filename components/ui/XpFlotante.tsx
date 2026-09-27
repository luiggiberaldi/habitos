"use client";

export interface XpFlotanteItem {
  id: number;
  xp: number;
}

/**
 * Etiquetas "+N XP" que suben y se desvanecen sobre la tarjeta del hábito
 * al marcarlo. El padre las añade al marcar y las retira tras ~1.2s.
 * Con `prefers-reduced-motion` la animación queda anulada por la regla global.
 */
export default function XpFlotante({ items }: { items: XpFlotanteItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-10 z-10 flex flex-col items-center"
    >
      {items.map((it) => (
        <span
          key={it.id}
          className="animate-xp-flotar rounded-full bg-accent px-2.5 py-1 text-xs font-extrabold text-accent-foreground shadow-lg"
        >
          +{it.xp} XP
        </span>
      ))}
    </div>
  );
}
