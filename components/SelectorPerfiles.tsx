"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthGate";
import PerfilCard from "./PerfilCard";
import Onboarding, { type DatosOnboarding } from "./Onboarding";
import Logo from "./Logo";
import { logEvent } from "../lib/logger";
import SelectorAvatar from "./SelectorAvatar";
import CampoClave from "./CampoClave";
import { crearEstadoInicial, crearHabitoSueno } from "../lib/store";
import type { AppState } from "../lib/types";
import { habitoDesdePlantilla } from "../lib/plantillas";
import {
  actualizarPerfil,
  claveEstado,
  crearPerfil,
  eliminarPerfil,
  leerPerfiles,
  verificarPin,
  COLORES_PERFIL,
  MAX_PERFILES,
  type Perfil,
} from "../lib/perfiles";
import { IconAlerta, IconCandado, IconPlus, IconX } from "../lib/icons";

type Modal =
  | { tipo: "crear" }
  | { tipo: "editar"; perfil: Perfil }
  | { tipo: "eliminar"; perfil: Perfil }
  | { tipo: "pin"; perfil: Perfil; accion: "entrar" | "eliminar" }
  | null;

/** ¿Cuántos hábitos tiene cada perfil? Se lee directo del localStorage. */
function contarHabitos(perfiles: Perfil[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of perfiles) {
    try {
      const raw = window.localStorage.getItem(claveEstado(`perfil:${p.id}`));
      const data: unknown = raw ? JSON.parse(raw) : null;
      const habits = (data as { habits?: unknown[] } | null)?.habits;
      out[p.id] = Array.isArray(habits) ? habits.length : 0;
    } catch {
      out[p.id] = 0;
    }
  }
  return out;
}

export default function SelectorPerfiles() {
  const { entrarAPerfil, cambiarModo } = useAuth();
  const [perfiles, setPerfiles] = useState<Perfil[]>(() => leerPerfiles());
  const [modal, setModal] = useState<Modal>(null);
  /** Asistente de primer uso: se muestra solo cuando aún no hay perfiles. */
  const [onboarding, setOnboarding] = useState(() => leerPerfiles().length === 0);

  const recargar = () => setPerfiles(leerPerfiles());
  const conteos = useMemo(() => contarHabitos(perfiles), [perfiles]);
  const lleno = perfiles.length >= MAX_PERFILES;

  const guardar = (
    nombre: string,
    color: string,
    avatar: string | null,
    foto: string | null,
    pin: string | null,
    editando: Perfil | null,
  ) => {
    if (editando) {
      const p = actualizarPerfil(editando.id, { nombre, color, avatar, foto, pin });
      if (p) logEvent("PERFIL_ACTUALIZADO", "perfil", p.id, { nombre: p.nombre, pin: p.pin ? "si" : "no" }, `perfil:${p.id}`);
    } else {
      const p = crearPerfil(nombre, color, avatar, pin, foto);
      if (p) logEvent("PERFIL_CREATED", "perfil", p.id, { nombre: p.nombre, pin: p.pin ? "si" : "no" }, `perfil:${p.id}`);
    }
    setModal(null);
    recargar();
  };

  /** Crea el perfil desde el onboarding con los hábitos elegidos (sin demos). */
  const completarOnboarding = (datos: DatosOnboarding) => {
    const p = crearPerfil(datos.nombre, datos.color, datos.avatar, null, datos.foto);
    if (!p) return;
    const base = crearEstadoInicial();
    const sueno = crearHabitoSueno(Math.random().toString(36).slice(2, 10));
    const estado: AppState = {
      ...base,
      // El sueño nace con el perfil: siempre activo, no se puede borrar.
      habits: [...datos.plantillas.map(habitoDesdePlantilla), sueno],
      completions: [],
    };
    try {
      window.localStorage.setItem(claveEstado(`perfil:${p.id}`), JSON.stringify(estado));
    } catch {
      // Si el almacenamiento falla, el perfil entra igual con el estado inicial.
    }
    logEvent("PERFIL_CREATED", "perfil", p.id, { nombre: p.nombre, onboarding: "si" }, `perfil:${p.id}`);
    setOnboarding(false);
    entrarAPerfil(p.id);
  };

  /** Entrar o eliminar pasando por el PIN cuando el perfil lo tiene. */
  const pedirPinSiAplica = (p: Perfil, accion: "entrar" | "eliminar") => {
    if (p.pin) setModal({ tipo: "pin", perfil: p, accion });
    else if (accion === "entrar") entrarAPerfil(p.id);
    else setModal({ tipo: "eliminar", perfil: p });
  };

  const alPasarPin = (p: Perfil, accion: "entrar" | "eliminar") => {
    if (accion === "entrar") {
      setModal(null);
      entrarAPerfil(p.id);
    } else {
      setModal({ tipo: "eliminar", perfil: p });
    }
  };

  const confirmarEliminar = (p: Perfil) => {
    eliminarPerfil(p.id);
    setModal(null);
    recargar();
  };

  if (onboarding) {
    return (
      <Onboarding
        onCompletar={completarOnboarding}
        onOmitir={() => {
          setOnboarding(false);
          setModal({ tipo: "crear" });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3">
        <Logo className="h-14 w-14" withWordmark />
      </div>
      <h1 className="text-center text-2xl font-bold">¿Quién está ahí?</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Cada perfil guarda sus hábitos solo en este dispositivo.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-5 sm:grid-cols-3">
        {perfiles.map((p) => (
          <PerfilCard
            key={p.id}
            perfil={p}
            numHabitos={conteos[p.id] ?? 0}
            onEntrar={() => pedirPinSiAplica(p, "entrar")}
            onEditar={() => setModal({ tipo: "editar", perfil: p })}
            onEliminar={() => pedirPinSiAplica(p, "eliminar")}
          />
        ))}
        {!lleno && (
          <button
            type="button"
            onClick={() => setOnboarding(true)}
            aria-label="Crear perfil"
            className="flex aspect-[5/6] w-full flex-col items-center justify-center gap-3 rounded-[2rem] border-2 border-dashed border-border text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <IconPlus className="h-10 w-10" />
            <span className="text-sm font-semibold">Nuevo perfil</span>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => cambiarModo("cuenta")}
        className="mt-10 text-sm font-medium text-accent hover:underline"
      >
        O usa tu cuenta en la nube
      </button>

      {modal?.tipo === "crear" && (
        <ModalPerfil key="crear" onCerrar={() => setModal(null)} onGuardar={(n, c, a, f, pin) => guardar(n, c, a, f, pin, null)} />
      )}
      {modal?.tipo === "editar" && (
        <ModalPerfil
          key={modal.perfil.id}
          perfil={modal.perfil}
          onCerrar={() => setModal(null)}
          onGuardar={(n, c, a, f, pin) => guardar(n, c, a, f, pin, modal.perfil)}
        />
      )}
      {modal?.tipo === "pin" && (
        <ModalPin
          key={`pin-${modal.perfil.id}-${modal.accion}`}
          perfil={modal.perfil}
          accion={modal.accion}
          onCerrar={() => setModal(null)}
          onExito={() => alPasarPin(modal.perfil, modal.accion)}
        />
      )}
      {modal?.tipo === "eliminar" && (
        <ModalEliminar
          perfil={modal.perfil}
          onCerrar={() => setModal(null)}
          onConfirmar={() => confirmarEliminar(modal.perfil)}
        />
      )}
    </div>
  );
}

/** Modal propio (nada de prompt/confirm nativos) para crear o editar un perfil. */
function ModalPerfil({
  perfil,
  onCerrar,
  onGuardar,
}: {
  perfil?: Perfil;
  onCerrar: () => void;
  onGuardar: (nombre: string, color: string, avatar: string | null, foto: string | null, pin: string | null) => void;
}) {
  const [nombre, setNombre] = useState(perfil?.nombre ?? "");
  const [color, setColor] = useState(perfil?.color ?? COLORES_PERFIL[0]);
  const [avatar, setAvatar] = useState<string | null>(perfil?.avatar ?? null);
  const [foto, setFoto] = useState<string | null>(perfil?.foto ?? null);
  const [pinInput, setPinInput] = useState("");
  const [pinConfirmar, setPinConfirmar] = useState("");
  const [quitarPin, setQuitarPin] = useState(false);
  const [editandoPin, setEditandoPin] = useState(false);
  /** PIN actual: se exige para cambiar o quitar un PIN existente. */
  const [pinActual, setPinActual] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  const tienePin = !!perfil?.pin && !quitarPin;
  const pinLimpio = pinInput.replace(/\D/g, "").slice(0, 4);
  const pinConfirmarLimpio = pinConfirmar.replace(/\D/g, "").slice(0, 4);
  const pinActualLimpio = pinActual.replace(/\D/g, "").slice(0, 4);
  const pinValido = pinLimpio === "" || /^\d{4}$/.test(pinLimpio);
  // Si se escribe un PIN nuevo hay que confirmarlo: debe coincidir.
  const pinConfirmado = pinLimpio === "" || pinConfirmarLimpio === pinLimpio;
  // Cambiar o quitar un PIN existente exige el PIN actual (seguridad:
  // cualquiera con el teléfono abierto no debería poder desactivarlo).
  const requierePinActual = !!perfil?.pin && (quitarPin || /^\d{4}$/.test(pinLimpio));
  const pinActualOk = !requierePinActual || (perfil ? verificarPin(perfil, pinActualLimpio) : false);
  const valido = nombre.trim().length > 0 && pinValido && pinConfirmado && pinActualOk;
  const inicial = (nombre.trim()[0] ?? "?").toUpperCase();

  /** PIN final al guardar: null = quitar/sin PIN, 4 dígitos = nuevo, o el existente. */
  const pinFinal = (): string | null => {
    if (quitarPin) return null;
    if (/^\d{4}$/.test(pinLimpio)) return pinLimpio;
    return perfil?.pin ?? null;
  };

  /** Campo "PIN actual": se muestra al cambiar o quitar un PIN existente. */
  const pinActualField = requierePinActual ? (
    <div className="mt-3">
      <label className="mb-1 block text-xs font-medium text-muted" htmlFor="pin-actual">
        PIN actual
      </label>
      <CampoClave
        id="pin-actual"
        nombre="PIN actual"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={pinActualLimpio}
        onChange={(e) => setPinActual(e.target.value)}
        placeholder="••••"
        aria-label="PIN actual"
        className="input-field text-center text-xl tracking-[0.75em] placeholder:text-muted/60"
      />
      {pinActualLimpio.length === 4 && !pinActualOk && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-500">
          El PIN actual no coincide.
        </p>
      )}
    </div>
  ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={perfil ? "Editar perfil" : "Nuevo perfil"}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{perfil ? "Editar perfil" : "Nuevo perfil"}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nombre
          <input
            type="text"
            autoFocus
            maxLength={24}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Mamá, Pedro…"
            className="input-field"
          />
        </label>

        <p className="mb-2 mt-5 text-sm font-medium">Avatar</p>
        <SelectorAvatar
          avatar={avatar}
          foto={foto}
          color={color}
          inicial={inicial}
          onAvatar={setAvatar}
          onFoto={setFoto}
        />

        <p className="mb-2 mt-5 text-sm font-medium">Color del avatar</p>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Color del avatar">
          {COLORES_PERFIL.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={`h-11 w-11 rounded-full transition-transform ${
                color === c ? "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface" : "hover:scale-105"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <p className="mb-2 mt-5 text-sm font-medium">
          PIN de seguridad <span className="font-normal text-muted">(opcional)</span>
        </p>
        {tienePin && !editandoPin ? (
          <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3">
            <IconCandado className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium">PIN activado</span>
            <button
              type="button"
              onClick={() => setEditandoPin(true)}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
            >
              Cambiar
            </button>
            <button
              type="button"
              onClick={() => setQuitarPin(true)}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface hover:text-foreground"
            >
              Quitar
            </button>
          </div>
        ) : quitarPin ? (
          <>
            <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3">
              <IconCandado className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
              <span className="flex-1 text-sm text-muted">Se quitará el PIN al guardar</span>
              <button
                type="button"
                onClick={() => {
                  setQuitarPin(false);
                  setPinActual("");
                }}
                className="min-h-9 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
              >
                Deshacer
              </button>
            </div>
            {pinActualField}
          </>
        ) : (
          <>
            {pinActualField}
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="pin-nuevo">
              {perfil?.pin ? "Nuevo PIN" : "PIN"}
            </label>
            <CampoClave
              id="pin-nuevo"
              nombre="PIN"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pinLimpio}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              aria-label="PIN de 4 dígitos"
              aria-invalid={!pinValido}
              className="input-field text-center text-xl tracking-[0.75em] placeholder:text-muted/60"
            />
            <p className="mt-1.5 text-xs text-muted">
              {perfil?.pin ? "Escribe el nuevo PIN (déjalo vacío para no cambiarlo)." : "Se pedirá al entrar a este perfil. Déjalo vacío para no usar PIN."}
            </p>
            {!pinValido && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-500">
                El PIN debe tener 4 dígitos.
              </p>
            )}
            {pinLimpio !== "" && (
              <>
                <label className="mb-1 mt-3 block text-xs font-medium text-muted" htmlFor="pin-confirmar">
                  Confirmar PIN
                </label>
                <CampoClave
                  id="pin-confirmar"
                  nombre="PIN"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={pinConfirmarLimpio}
                  onChange={(e) => setPinConfirmar(e.target.value)}
                  placeholder="••••"
                  aria-label="Confirmar PIN de 4 dígitos"
                  aria-invalid={!pinConfirmado}
                  className="input-field text-center text-xl tracking-[0.75em] placeholder:text-muted/60"
                />
                {!pinConfirmado && pinConfirmarLimpio !== "" && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-500">
                    Los PIN no coinciden.
                  </p>
                )}
              </>
            )}
          </>
        )}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCerrar} className="btn-secondary min-h-11 flex-1">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valido}
            onClick={() => valido && onGuardar(nombre.trim(), color, avatar, foto, pinFinal())}
            className="btn-primary min-h-11 flex-1 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirmación propia para eliminar un perfil y todos sus datos. */
function ModalEliminar({
  perfil,
  onCerrar,
  onConfirmar,
}: {
  perfil: Perfil;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  const [armado, setArmado] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Eliminar perfil"
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-red-500/30 bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <IconAlerta className="h-6 w-6 shrink-0 text-red-500" />
          <h2 className="text-lg font-bold">Eliminar perfil</h2>
        </div>
        <p className="mt-3 text-sm text-muted">
          Se borrarán los hábitos, rachas y datos de <strong className="text-foreground">{perfil.nombre}</strong> en
          este dispositivo. Esta acción no se puede deshacer.
        </p>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCerrar} className="btn-secondary min-h-11 flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => (armado ? onConfirmar() : setArmado(true))}
            className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white transition-colors ${
              armado ? "bg-red-600 hover:bg-red-700" : "bg-red-500/80 hover:bg-red-500"
            }`}
          >
            {armado ? "Sí, eliminar" : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pide el PIN de 4 dígitos antes de entrar o eliminar un perfil protegido. */
function ModalPin({
  perfil,
  accion,
  onCerrar,
  onExito,
}: {
  perfil: Perfil;
  accion: "entrar" | "eliminar";
  onCerrar: () => void;
  onExito: () => void;
}) {
  const [intento, setIntento] = useState("");
  const [fallos, setFallos] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  const manejarCambio = (valor: string) => {
    const limpio = valor.replace(/\D/g, "").slice(0, 4);
    setIntento(limpio);
    if (limpio.length !== 4) return;
    if (verificarPin(perfil, limpio)) {
      onExito();
    } else {
      setFallos((f) => f + 1);
      window.setTimeout(() => setIntento(""), 300);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={`PIN de ${perfil.nombre}`}
    >
      <div
        className="w-full max-w-xs rounded-3xl border border-border bg-surface p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: perfil.color }}
        >
          <IconCandado className="h-6 w-6 text-white" aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-lg font-bold">{perfil.nombre}</h2>
        <p className="mt-1 text-sm text-muted">
          {accion === "entrar" ? "Escribe el PIN para entrar" : "Escribe el PIN para eliminar este perfil"}
        </p>

        <div key={fallos} className={`mt-5 flex justify-center gap-3 ${fallos > 0 ? "animate-shake" : ""}`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`h-4 w-4 rounded-full transition-colors ${
                i < intento.length ? "bg-accent" : "bg-surface-2"
              }`}
            />
          ))}
        </div>

        <div className="mx-auto mt-4 w-44">
          <CampoClave
            nombre="PIN"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={4}
            value={intento}
            onChange={(e) => manejarCambio(e.target.value)}
            aria-label="PIN de 4 dígitos"
            placeholder="••••"
            className="input-field w-full text-center text-2xl tracking-[0.5em]"
          />
        </div>

        <p role="alert" aria-live="assertive" className="mt-3 min-h-5 text-sm font-medium text-red-500">
          {fallos > 0 ? "PIN incorrecto, intenta de nuevo." : ""}
        </p>

        <button type="button" onClick={onCerrar} className="btn-secondary mt-2 min-h-11 w-full">
          Cancelar
        </button>
      </div>
    </div>
  );
}
