// components/GestionHogar.tsx — Sección "Hogar" en Ajustes (Fase 0).
//
// El hogar es la unidad de datos compartidos de Senda (Finanzas, Mercado).
// Flujo: crear hogar → invitar por correo (si la cuenta existe entra
// directo; si no, se ofrece crearla aquí mismo y se reintenta la
// invitación). Sin alert()/confirm(): errores inline y confirmación en
// dos toques para acciones destructivas.

import { useCallback, useEffect, useState } from "react";
import {
  IconAlerta,
  IconCheck,
  IconEditar,
  IconOjo,
  IconOjoTachado,
  IconPlus,
  IconUsuarios,
  IconX,
} from "../lib/core/ui/icons";
import { getSupabase } from "../lib/core/supabase";
import {
  crearCuentaNube,
  crearHogar,
  expulsarDelHogar,
  invitarAlHogar,
  obtenerMiHogar,
  renombrarHogar,
  salirDelHogar,
  type MiHogar,
} from "../lib/core/hogar";

type FaseCarga = "cargando" | "lista" | "sin-conexion" | "error";

export default function GestionHogar() {
  const [fase, setFase] = useState<FaseCarga>("cargando");
  const [hogar, setHogar] = useState<MiHogar | null>(null);
  const [error, setError] = useState("");

  const recargar = useCallback(async () => {
    setFase("cargando");
    setError("");
    try {
      const h = await obtenerMiHogar(getSupabase());
      setHogar(h);
      setFase("lista");
    } catch (e) {
      const msg = (e as Error).message;
      setFase(msg === "Sin conexión con la nube." ? "sin-conexion" : "error");
      setError(msg);
    }
  }, []);

  // Carga inicial: todo el setState vive dentro del flujo async con guard
  // `activo` (patrón AuthGate: set-state-in-effect no permite setState
  // síncrono en el cuerpo del efecto).
  useEffect(() => {
    let activo = true;
    void (async () => {
      try {
        const h = await obtenerMiHogar(getSupabase());
        if (!activo) return;
        setHogar(h);
        setFase("lista");
      } catch (e) {
        if (!activo) return;
        const msg = (e as Error).message;
        setFase(msg === "Sin conexión con la nube." ? "sin-conexion" : "error");
        setError(msg);
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  return (
    <section className="card p-4 sm:p-5" aria-label="Hogar">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <IconUsuarios className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Hogar</h2>
          <p className="text-sm text-muted">
            {hogar
              ? "Los datos compartidos (Finanzas, Mercado) viven aquí."
              : "Crea tu hogar para compartir Finanzas y Mercado."}
          </p>
        </div>
      </div>

      {fase === "cargando" && (
        <p className="mt-4 text-sm text-muted" aria-live="polite">Cargando hogar…</p>
      )}

      {fase === "sin-conexion" && (
        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          Sin conexión: la gestión del hogar necesita internet. Tus hábitos siguen funcionando normal.
        </p>
      )}

      {fase === "error" && (
        <div className="mt-4">
          <p className="text-sm text-red-500">{error || "No se pudo cargar el hogar."}</p>
          <button type="button" onClick={() => void recargar()} className="btn-secondary mt-2 min-h-11">
            Reintentar
          </button>
        </div>
      )}

      {fase === "lista" && !hogar && <CrearHogar onCreado={() => void recargar()} />}

      {fase === "lista" && hogar && (
        <DetalleHogar hogar={hogar} onCambio={() => void recargar()} />
      )}
    </section>
  );
}

/** Formulario para crear el hogar cuando aún no existe. */
function CrearHogar({ onCreado }: { onCreado: () => void }) {
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function crear() {
    if (ocupado) return;
    setOcupado(true);
    setError("");
    try {
      await crearHogar(getSupabase(), nombre.trim() || "Mi hogar");
      onCreado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-4">
      <label htmlFor="hogar-nombre" className="text-sm font-medium">Nombre del hogar</label>
      <div className="mt-2 flex gap-2">
        <input
          id="hogar-nombre"
          type="text"
          value={nombre}
          maxLength={60}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Mi hogar"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm"
        />
        <button type="button" onClick={() => void crear()} disabled={ocupado} className="btn-primary min-h-11 shrink-0">
          {ocupado ? "Creando…" : "Crear hogar"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}

/** Hogar existente: miembros, invitar, renombrar, salir/expulsar. */
function DetalleHogar({ hogar, onCambio }: { hogar: MiHogar; onCambio: () => void }) {
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState(hogar.nombre);
  const [error, setError] = useState("");

  async function guardarNombre() {
    setError("");
    try {
      await renombrarHogar(getSupabase(), nuevoNombre);
      setEditandoNombre(false);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        {editandoNombre ? (
          <>
            <input
              type="text"
              value={nuevoNombre}
              maxLength={60}
              onChange={(e) => setNuevoNombre(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm font-semibold"
              aria-label="Nombre del hogar"
            />
            <button type="button" onClick={() => void guardarNombre()} className="btn-primary min-h-11 px-3" aria-label="Guardar nombre">
              <IconCheck className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => { setEditandoNombre(false); setNuevoNombre(hogar.nombre); }}
              className="btn-secondary min-h-11 px-3"
              aria-label="Cancelar"
            >
              <IconX className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate font-semibold">{hogar.nombre}</p>
            {hogar.soy_admin && (
              <button
                type="button"
                onClick={() => setEditandoNombre(true)}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <IconEditar className="h-4 w-4" /> Renombrar
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {hogar.miembros.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.email}
                {m.es_yo && <span className="text-muted"> (tú)</span>}
              </p>
              <p className="text-xs text-muted">{m.rol === "admin" ? "Administrador" : "Miembro"}</p>
            </div>
            {hogar.soy_admin && !m.es_yo && m.rol !== "admin" && (
              <BotonExpulsar userId={m.user_id} email={m.email} onCambio={onCambio} />
            )}
          </li>
        ))}
      </ul>

      {hogar.soy_admin && <InvitarMiembro onInvitado={onCambio} />}

      <div className="mt-4 border-t border-border pt-4">
        <BotonSalir soyAdmin={hogar.soy_admin} totalMiembros={hogar.miembros.length} onCambio={onCambio} />
      </div>
    </div>
  );
}

/** Expulsar con confirmación en dos toques (nada de confirm() nativo). */
function BotonExpulsar({ userId, email, onCambio }: { userId: string; email: string; onCambio: () => void }) {
  const [armado, setArmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    try {
      await expulsarDelHogar(getSupabase(), userId);
      onCambio();
    } catch {
      setArmado(false);
    } finally {
      setOcupado(false);
    }
  }

  if (!armado) {
    return (
      <button
        type="button"
        onClick={() => { setArmado(true); window.setTimeout(() => setArmado(false), 6000); }}
        className="min-h-11 rounded-xl px-3 text-xs font-medium text-red-500 hover:bg-red-500/10"
      >
        Expulsar
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void confirmar()}
      disabled={ocupado}
      title={`Expulsar a ${email}`}
      className="min-h-11 rounded-xl bg-red-500 px-3 text-xs font-semibold text-white disabled:opacity-50"
    >
      {ocupado ? "…" : "¿Seguro?"}
    </button>
  );
}

/**
 * Invitar por correo. Si la cuenta no existe, se ofrece crearla aquí mismo
 * (vía crear-usuario) y se reintenta la invitación automáticamente.
 */
function InvitarMiembro({ onInvitado }: { onInvitado: () => void }) {
  const [email, setEmail] = useState("");
  const [fase, setFase] = useState<"idle" | "invitando" | "crear-cuenta" | "creando">("idle");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function invitar() {
    if (fase === "invitando" || fase === "creando") return;
    setFase("invitando");
    setError("");
    setOk("");
    try {
      const r = await invitarAlHogar(getSupabase(), email.trim());
      setOk(`${r.email} ya es parte del hogar.`);
      setEmail("");
      setFase("idle");
      onInvitado();
    } catch (e) {
      if ((e as { codigo?: string }).codigo === "CUENTA_NO_EXISTE") {
        setFase("crear-cuenta");
      } else {
        setError((e as Error).message);
        setFase("idle");
      }
    }
  }

  async function crearEInvitar() {
    if (fase === "creando") return;
    if (clave.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setFase("creando");
    setError("");
    try {
      await crearCuentaNube(getSupabase(), email.trim(), clave);
      const r = await invitarAlHogar(getSupabase(), email.trim());
      setOk(`Cuenta creada y ${r.email} agregado al hogar.`);
      setEmail("");
      setClave("");
      setFase("idle");
      onInvitado();
    } catch (e) {
      setError((e as Error).message);
      setFase("crear-cuenta");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">Invitar al hogar</p>
      <p className="mt-1 text-xs text-muted">
        Por correo. Si la persona ya tiene cuenta entra directo; si no, la creas aquí.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          autoComplete="email"
          disabled={fase === "invitando" || fase === "creando"}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm"
          aria-label="Correo de la persona a invitar"
        />
        <button
          type="button"
          onClick={() => void invitar()}
          disabled={fase === "invitando" || fase === "creando" || !email.trim()}
          className="btn-primary min-h-11 shrink-0 disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1">
            <IconPlus className="h-4 w-4" /> {fase === "invitando" ? "…" : "Invitar"}
          </span>
        </button>
      </div>

      {(fase === "crear-cuenta" || fase === "creando") && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <p className="flex items-start gap-2 text-sm">
            <IconAlerta className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
            <span>
              <strong>{email.trim()}</strong> aún no tiene cuenta. Créala con una contraseña
              temporal y se la compartes para que entre.
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type={verClave ? "text" : "password"}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Contraseña temporal (mín. 8)"
                minLength={8}
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-4 pr-11 text-sm"
                aria-label="Contraseña temporal"
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-foreground"
                aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {verClave ? <IconOjoTachado className="h-4 w-4" /> : <IconOjo className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void crearEInvitar()}
              disabled={fase === "creando"}
              className="btn-primary min-h-11 shrink-0 disabled:opacity-50"
            >
              {fase === "creando" ? "Creando…" : "Crear e invitar"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {ok && (
        <p className="mt-2 inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
          <IconCheck className="h-4 w-4" /> {ok}
        </p>
      )}
    </div>
  );
}

/** Salir del hogar con confirmación en dos toques. */
function BotonSalir({ soyAdmin, totalMiembros, onCambio }: { soyAdmin: boolean; totalMiembros: number; onCambio: () => void }) {
  const [armado, setArmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function confirmar() {
    setOcupado(true);
    setError("");
    try {
      await salirDelHogar(getSupabase());
      onCambio();
    } catch (e) {
      setError((e as Error).message);
      setArmado(false);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      {!armado ? (
        <button
          type="button"
          onClick={() => { setArmado(true); window.setTimeout(() => setArmado(false), 8000); }}
          className="min-h-11 w-full rounded-xl border border-red-500/50 px-4 text-sm font-semibold text-red-500 hover:bg-red-500/10 sm:w-auto"
        >
          Salir del hogar
        </button>
      ) : (
        <div className="rounded-xl border border-red-500/50 p-3">
          <p className="text-sm">
            {soyAdmin && totalMiembros > 1
              ? "Eres administrador: al salir, el miembro más antiguo quedará como admin. ¿Salir del hogar?"
              : totalMiembros > 1
                ? "¿Salir del hogar? Dejarás de ver los datos compartidos."
                : "¿Eliminar el hogar? Eres el único miembro."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={ocupado}
              className="min-h-11 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {ocupado ? "Saliendo…" : totalMiembros > 1 ? "Sí, salir" : "Sí, eliminar"}
            </button>
            <button type="button" onClick={() => setArmado(false)} className="btn-secondary min-h-11">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
