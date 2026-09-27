"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthGate";
import PerfilCard from "./PerfilCard";
import Logo from "./Logo";
import { logEvent } from "../lib/logger";
import { AVATARES } from "../lib/avatares";
import {
  actualizarPerfil,
  claveEstado,
  crearPerfil,
  eliminarPerfil,
  leerPerfiles,
  COLORES_PERFIL,
  MAX_PERFILES,
  type Perfil,
} from "../lib/perfiles";
import { IconAlerta, IconPlus, IconX } from "../lib/icons";

type Modal =
  | { tipo: "crear" }
  | { tipo: "editar"; perfil: Perfil }
  | { tipo: "eliminar"; perfil: Perfil }
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

  const recargar = () => setPerfiles(leerPerfiles());
  const conteos = useMemo(() => contarHabitos(perfiles), [perfiles]);
  const lleno = perfiles.length >= MAX_PERFILES;

  const guardar = (nombre: string, color: string, avatar: string | null, editando: Perfil | null) => {
    if (editando) {
      const p = actualizarPerfil(editando.id, { nombre, color, avatar });
      if (p) logEvent("PERFIL_ACTUALIZADO", "perfil", p.id, { nombre: p.nombre }, `perfil:${p.id}`);
    } else {
      const p = crearPerfil(nombre, color, avatar);
      if (p) logEvent("PERFIL_CREATED", "perfil", p.id, { nombre: p.nombre }, `perfil:${p.id}`);
    }
    setModal(null);
    recargar();
  };

  const confirmarEliminar = (p: Perfil) => {
    eliminarPerfil(p.id);
    setModal(null);
    recargar();
  };

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
            onEntrar={() => entrarAPerfil(p.id)}
            onEditar={() => setModal({ tipo: "editar", perfil: p })}
            onEliminar={() => setModal({ tipo: "eliminar", perfil: p })}
          />
        ))}
        {!lleno && (
          <button
            type="button"
            onClick={() => setModal({ tipo: "crear" })}
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
        <ModalPerfil key="crear" onCerrar={() => setModal(null)} onGuardar={(n, c, a) => guardar(n, c, a, null)} />
      )}
      {modal?.tipo === "editar" && (
        <ModalPerfil
          key={modal.perfil.id}
          perfil={modal.perfil}
          onCerrar={() => setModal(null)}
          onGuardar={(n, c, a) => guardar(n, c, a, modal.perfil)}
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
  onGuardar: (nombre: string, color: string, avatar: string | null) => void;
}) {
  const [nombre, setNombre] = useState(perfil?.nombre ?? "");
  const [color, setColor] = useState(perfil?.color ?? COLORES_PERFIL[0]);
  const [avatar, setAvatar] = useState<string | null>(perfil?.avatar ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  const valido = nombre.trim().length > 0;
  const inicial = (nombre.trim()[0] ?? "?").toUpperCase();

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
        <div className="grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="Avatar del perfil">
          <button
            key="inicial"
            type="button"
            role="radio"
            aria-checked={avatar === null}
            aria-label="Inicial del nombre"
            title="Inicial"
            onClick={() => setAvatar(null)}
            className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white transition-transform ${
              avatar === null ? "scale-105 ring-2 ring-accent ring-offset-2 ring-offset-surface" : "hover:scale-105"
            }`}
            style={{ backgroundColor: color }}
          >
            {inicial}
          </button>
          {AVATARES.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={avatar === a.id}
              aria-label={a.nombre}
              title={a.nombre}
              onClick={() => setAvatar(a.id)}
              className={`h-14 w-14 overflow-hidden rounded-full transition-transform ${
                avatar === a.id
                  ? "scale-105 ring-2 ring-accent ring-offset-2 ring-offset-surface"
                  : "hover:scale-105"
              }`}
            >
              <img src={a.src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>

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

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCerrar} className="btn-secondary min-h-11 flex-1">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valido}
            onClick={() => valido && onGuardar(nombre.trim(), color, avatar)}
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
