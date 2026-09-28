/**
 * Tasas del día (Fase 0.4). Cliente: habla con GET/POST /api/tasas
 * (proxy servidor), nunca directo con las fuentes ni con la Edge Function.
 */

export type TasasDelDia = {
  fecha: string;
  bcv: number | null;
  paralelo: number | null; // interno (Finanzas lo usa para VES→USD); ya no se muestra
  euro: number | null; // euro oficial BCV
  usdt: number | null;
  fuente: string;
  actualizadaEn: string;
  desactualizada: boolean;
};

async function leerRespuesta(r: Response): Promise<TasasDelDia> {
  const d = (await r.json()) as Partial<TasasDelDia> & {
    ok?: boolean;
    error?: string;
  };
  if (!r.ok || d.ok === false || !d.fecha) {
    throw new Error(d.error ?? `Tasas no disponibles (HTTP ${r.status})`);
  }
  return d as TasasDelDia;
}

/** Tasa del día; con refresh=true fuerza la actualización en las fuentes. */
export async function obtenerTasas(refresh = false): Promise<TasasDelDia> {
  const r = await fetch(`/api/tasas${refresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
  });
  return leerRespuesta(r);
}

/** Guarda tasas ingresadas a mano (fuente "manual"). */
export async function guardarTasasManual(input: {
  bcv?: number;
  euro?: number;
  usdt?: number;
}): Promise<TasasDelDia> {
  const r = await fetch("/api/tasas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return leerRespuesta(r);
}

/** "855.6625" → "Bs. 855,66" (formato venezolano). */
export function formatoBs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return (
    "Bs. " +
    new Intl.NumberFormat("es-VE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v)
  );
}

/** "2026-09-28" → "28 sep 2026". */
export function formatoFechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const meses = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  return `${d} ${meses[m - 1]} ${y}`;
}
