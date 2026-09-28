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

export type FilaTasa = {
  fecha: string;
  bcv: number | null;
  paralelo: number | null;
  usdt: number | null;
};

/**
 * Historial de tasas (Fase 0.4+). Lee `fin_tasas` directo: la lectura es
 * pública por RLS. Devuelve las últimas `dias` filas ordenadas por fecha
 * ascendente. Con pocos días devuelve lo que haya; el componente decide qué
 * estadísticas son calculables.
 */
export async function obtenerHistorialTasas(
  dias = 90,
): Promise<FilaTasa[]> {
  const { getSupabase } = await import("./supabase");
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { data, error } = await supabase
    .from("fin_tasas")
    .select("fecha,bcv,paralelo,usdt")
    .order("fecha", { ascending: false })
    .limit(Math.max(2, Math.min(365, dias)));
  if (error) throw new Error(error.message.slice(0, 120));
  const filas = ((data ?? []) as FilaTasa[]).reverse();
  return filas.map((f) => ({
    fecha: f.fecha,
    bcv: f.bcv === null ? null : Number(f.bcv),
    paralelo: f.paralelo === null ? null : Number(f.paralelo),
    usdt: f.usdt === null ? null : Number(f.usdt),
  }));
}
