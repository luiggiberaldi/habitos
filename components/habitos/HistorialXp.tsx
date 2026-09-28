"use client";

import { useMemo } from "react";
import { useStoreState } from "../../lib/habitos/store-context";
import { totalesHistorialXp } from "../../lib/habitos/juego";
import type { MotivoXp, MovimientoXp } from "../../lib/habitos/types";
import { todayKey } from "../../lib/habitos/dates";
import {
  IconCheck,
  IconDeshacer,
  IconEstrella,
  IconLuna,
  IconMovimiento,
  IconObjetivo,
  IconRegalo,
  IconRayo,
  IconTrofeo,
} from "../../lib/core/ui/icons";

const ETIQUETAS: Record<MotivoXp, { texto: string; Icono: typeof IconRayo }> = {
  registro: { texto: "Hábito registrado", Icono: IconCheck },
  objetivo: { texto: "Objetivo del día", Icono: IconObjetivo },
  desafio: { texto: "Desafío semanal", Icono: IconEstrella },
  cofre: { texto: "Cofre del día", Icono: IconRegalo },
  logro: { texto: "Logro reclamado", Icono: IconTrofeo },
  sueno: { texto: "Sueño", Icono: IconLuna },
  "sueno-olvido": { texto: "Sueño sin marcar", Icono: IconLuna },
  revertido: { texto: "Registro deshecho", Icono: IconDeshacer },
  historial: { texto: "Saldo anterior", Icono: IconMovimiento },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function fechaCorta(fecha: string): string {
  const hoy = todayKey();
  if (fecha === hoy) return "Hoy";
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const ayerKey = `${ayer.getFullYear()}-${String(ayer.getMonth() + 1).padStart(2, "0")}-${String(ayer.getDate()).padStart(2, "0")}`;
  if (fecha === ayerKey) return "Ayer";
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return fecha;
  return `${d} ${MESES[m - 1]}`;
}

function Fila({ mov }: { mov: MovimientoXp }) {
  const { texto, Icono } = ETIQUETAS[mov.motivo] ?? ETIQUETAS.historial;
  const gana = mov.delta > 0;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          gana ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        }`}
      >
        <Icono className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{texto}</p>
        <p className="truncate text-xs text-muted">
          {mov.detalle} · {fechaCorta(mov.fecha)}
        </p>
      </div>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${
          gana ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        }`}
      >
        {gana ? `+${mov.delta}` : mov.delta} XP
      </span>
    </li>
  );
}

/**
 * Historial de XP: cuánto se ha ganado, cuánto se ha perdido y por qué.
 * Lee los movimientos guardados en JuegoState (sincronizados como el resto
 * del juego); el pasado anterior al historial aparece como "Saldo anterior".
 */
export function HistorialXp() {
  const { state } = useStoreState();
  const movimientos = useMemo(
    () => [...(state.juego?.historialXp ?? [])].sort((a, b) => b.ts - a.ts),
    [state.juego],
  );
  const { ganado, perdido } = useMemo(() => totalesHistorialXp(state.juego), [state.juego]);
  const tieneSaldoAnterior = movimientos.some((m) => m.motivo === "historial");

  return (
    <section aria-labelledby="titulo-historial-xp" className="card p-4 sm:p-5">
      <h2 id="titulo-historial-xp" className="flex items-center gap-2 text-base font-bold">
        <IconMovimiento className="h-5 w-5 text-accent" aria-hidden="true" />
        Historial de XP
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-500/10 p-3">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Ganado</p>
          <p className="text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">+{ganado} XP</p>
        </div>
        <div className="rounded-2xl bg-rose-500/10 p-3">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Perdido</p>
          <p className="text-xl font-bold text-rose-600 tabular-nums dark:text-rose-400">−{perdido} XP</p>
        </div>
      </div>

      {movimientos.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Todavía no hay movimientos. Desde ahora, cada XP que ganes o pierdas
          queda registrado aquí con su motivo.
        </p>
      ) : (
        <>
          <ul className="mt-2 max-h-96 divide-y divide-muted/20 overflow-y-auto">
            {movimientos.map((m) => (
              <Fila key={m.id} mov={m} />
            ))}
          </ul>
          {tieneSaldoAnterior && (
            <p className="mt-3 text-xs text-muted">
              El “Saldo anterior” es un estimado del XP acumulado antes de que
              existiera este historial.
            </p>
          )}
        </>
      )}
    </section>
  );
}
