"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthGate";
import { useStoreActions, useStoreState } from "../../lib/store-context";
import { getSupabase } from "../../lib/supabase";
import {
  crearLiga,
  obtenerMisLigas,
  publicarXpLiga,
  salirDeLiga,
  unirseALiga,
  type LigaVista,
} from "../../lib/liga";
import {
  IconAlerta,
  IconCheck,
  IconPlus,
  IconTrofeo,
  IconUsuarios,
  IconX,
} from "../../lib/icons";

export default function Liga() {
  const { user } = useAuth();
  const { state } = useStoreState();
  const { actualizarJuego } = useStoreActions();
  const [ligas, setLigas] = useState<LigaVista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nombreNueva, setNombreNueva] = useState("");
  const [codigoUnirse, setCodigoUnirse] = useState("");
  const [nombreVisible, setNombreVisible] = useState(state.juego?.nombreLiga ?? "");
  const [confirmarSalida, setConfirmarSalida] = useState<string | null>(null);

  // Sincronizar el input si el nombre cambia desde fuera (patrón "ajustar
  // estado durante el render", recomendado por React en vez de un efecto).
  const nombreLigaStore = state.juego?.nombreLiga ?? "";
  const [nombreLigaPrev, setNombreLigaPrev] = useState(nombreLigaStore);
  if (nombreLigaStore !== nombreLigaPrev) {
    setNombreLigaPrev(nombreLigaStore);
    setNombreVisible(nombreLigaStore);
  }

  const cargar = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !user) {
      setCargando(false);
      return;
    }
    try {
      // Publicar el XP semanal antes de leer el ranking (dato fresco).
      if (state.juego) await publicarXpLiga(supabase, user.id, state.juego);
      setLigas(await obtenerMisLigas(supabase, user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las ligas.");
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Carga inicial diferida (evita setState síncrono en el efecto).
  useEffect(() => {
    const t = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(t);
  }, [cargar]);

  async function conCarga(fn: () => Promise<void>): Promise<void> {
    setError(null);
    setOk(null);
    setOcupado(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo salió mal.");
    } finally {
      setOcupado(false);
    }
  }

  const guardarNombre = (): void => {
    const limpio = nombreVisible.trim().slice(0, 30);
    actualizarJuego({ nombreLiga: limpio });
    setOk(limpio ? `Te verán como "${limpio}" en tus ligas.` : "Nombre borrado.");
  };

  const crear = (): Promise<void> =>
    conCarga(async () => {
      const supabase = getSupabase();
      if (!supabase || !user) throw new Error("Inicia sesión para crear una liga.");
      const vista = await crearLiga(supabase, user.id, nombreNueva, nombreVisible);
      actualizarJuego({ nombreLiga: nombreVisible.trim().slice(0, 30) });
      setNombreNueva("");
      setLigas((prev) => [...prev, vista]);
      setOk(`Liga "${vista.nombre}" creada. Comparte el código ${vista.codigo}.`);
    });

  const unirse = (): Promise<void> =>
    conCarga(async () => {
      const supabase = getSupabase();
      if (!supabase || !user) throw new Error("Inicia sesión para unirte a una liga.");
      const vista = await unirseALiga(supabase, user.id, codigoUnirse, nombreVisible);
      actualizarJuego({ nombreLiga: nombreVisible.trim().slice(0, 30) });
      setCodigoUnirse("");
      setLigas((prev) => (prev.some((l) => l.id === vista.id) ? prev : [...prev, vista]));
      setOk(`Te uniste a "${vista.nombre}".`);
    });

  const salir = (ligaId: string): Promise<void> =>
    conCarga(async () => {
      const supabase = getSupabase();
      if (!supabase || !user) return;
      await salirDeLiga(supabase, user.id, ligaId);
      setConfirmarSalida(null);
      setLigas((prev) => prev.filter((l) => l.id !== ligaId));
      setOk("Saliste de la liga.");
    });

  const copiarCodigo = async (codigo: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codigo);
      setOk(`Código ${codigo} copiado.`);
    } catch {
      setError("No se pudo copiar el código.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <IconUsuarios className="h-6 w-6 text-accent" />
          Liga semanal
        </h1>
        <p className="mt-1 text-sm text-muted">
          Compite por XP con tu gente. Grupos pequeños, ranking que se reinicia cada lunes.
        </p>
      </header>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3" role="alert">
          <IconAlerta className="h-5 w-5 shrink-0 text-danger" />
          <p className="text-sm font-medium text-danger">{error}</p>
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3" role="status">
          <IconCheck className="h-5 w-5 shrink-0 text-accent" />
          <p className="text-sm font-medium text-accent">{ok}</p>
        </div>
      )}

      {/* Tu nombre visible */}
      <section className="card p-5">
        <h2 className="font-semibold">Tu nombre en la liga</h2>
        <p className="mt-1 text-xs text-muted">Así te verán tus compañeros en el ranking.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={nombreVisible}
            onChange={(e) => setNombreVisible(e.target.value)}
            maxLength={30}
            placeholder="p. ej. luigi"
            className="input-field min-h-11 flex-1"
            aria-label="Tu nombre en la liga"
          />
          <button type="button" onClick={guardarNombre} className="btn-secondary min-h-11">
            Guardar
          </button>
        </div>
      </section>

      {cargando ? (
        <p className="text-sm text-muted">Cargando tus ligas…</p>
      ) : ligas.length === 0 ? (
        <>
          {/* Crear liga */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <IconPlus className="h-5 w-5 text-accent" />
              Crear una liga
            </h2>
            <p className="mt-1 text-xs text-muted">Recibirás un código para invitar a tu gente.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={nombreNueva}
                onChange={(e) => setNombreNueva(e.target.value)}
                maxLength={40}
                placeholder="Nombre de la liga"
                className="input-field min-h-11 flex-1"
                aria-label="Nombre de la liga"
              />
              <button type="button" onClick={() => void crear()} disabled={ocupado} className="btn-primary min-h-11 disabled:opacity-50">
                {ocupado ? "Creando…" : "Crear liga"}
              </button>
            </div>
          </section>

          {/* Unirse con código */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <IconUsuarios className="h-5 w-5 text-accent" />
              Unirse con código
            </h2>
            <p className="mt-1 text-xs text-muted">Pide el código de 6 letras a quien creó la liga.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={codigoUnirse}
                onChange={(e) => setCodigoUnirse(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                className="input-field min-h-11 flex-1 uppercase tracking-widest"
                aria-label="Código de la liga"
              />
              <button type="button" onClick={() => void unirse()} disabled={ocupado} className="btn-primary min-h-11 disabled:opacity-50">
                {ocupado ? "Uniendo…" : "Unirse"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          {ligas.map((liga, idx) => {
            const maxXp = Math.max(1, ...liga.miembros.map((m) => m.xpSemanal));
            const miPos = liga.miembros.findIndex((m) => m.esYo) + 1;
            return (
              <section key={liga.id} className="card overflow-hidden" aria-label={`Liga ${liga.nombre}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-5">
                  <div>
                    <h2 className="font-semibold">{liga.nombre}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {miPos > 0 ? `Vas #${miPos} de ${liga.miembros.length}` : `${liga.miembros.length} participantes`} · se
                      reinicia el lunes
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copiarCodigo(liga.codigo)}
                    className="btn-secondary min-h-10 !py-1.5 !px-3 !text-sm"
                    title="Copiar código para invitar"
                  >
                    Código: <span className="font-mono font-bold tracking-widest">{liga.codigo}</span>
                  </button>
                </div>
                <ol className="flex flex-col gap-1 p-3">
                  {liga.miembros.map((m, i) => (
                    <li
                      key={m.userId}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                        m.esYo ? "bg-accent-soft/60" : ""
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          i === 0
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-surface-2 text-muted"
                        }`}
                        aria-label={`Puesto ${i + 1}`}
                      >
                        {i === 0 ? <IconTrofeo className="h-4 w-4" /> : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.nombreVisible}
                          {m.esYo && <span className="ml-1.5 text-xs font-normal text-muted">(tú)</span>}
                        </p>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full rounded-full ${i === 0 ? "bg-amber-400" : "bg-accent"}`}
                            style={{ width: `${Math.round((m.xpSemanal / maxXp) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums">{m.xpSemanal} XP</p>
                    </li>
                  ))}
                </ol>
                <div className="border-t border-border p-4">
                  {confirmarSalida === liga.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-muted">¿Salir de esta liga?</p>
                      <button
                        type="button"
                        onClick={() => void salir(liga.id)}
                        disabled={ocupado}
                        className="btn-secondary min-h-10 !py-1.5 !px-3 !text-sm !text-danger disabled:opacity-50"
                      >
                        Sí, salir
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmarSalida(null)}
                        className="btn-secondary min-h-10 !py-1.5 !px-3 !text-sm"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmarSalida(liga.id)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-danger"
                    >
                      <IconX className="h-4 w-4" />
                      Salir de la liga
                    </button>
                  )}
                </div>
                {idx === ligas.length - 1 && (
                  <div className="border-t border-border p-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={codigoUnirse}
                        onChange={(e) => setCodigoUnirse(e.target.value.toUpperCase())}
                        maxLength={6}
                        placeholder="Unirse a otra con código"
                        className="input-field min-h-11 flex-1 uppercase tracking-widest"
                        aria-label="Código de otra liga"
                      />
                      <button
                        type="button"
                        onClick={() => void unirse()}
                        disabled={ocupado}
                        className="btn-secondary min-h-11 disabled:opacity-50"
                      >
                        Unirse
                      </button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
