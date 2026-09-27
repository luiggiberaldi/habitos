"use client";

import { useState } from "react";
import Logo from "./Logo";
import SelectorAvatar from "./SelectorAvatar";
import { COLORES_PERFIL } from "../lib/habitos/perfiles";
import { PLANTILLAS, type Plantilla } from "../lib/habitos/plantillas";
import { IconCheck, IconFlechaAtras } from "../lib/core/ui/icons";
import { IconCategoria } from "../lib/habitos/iconos-categoria";

export interface DatosOnboarding {
  nombre: string;
  color: string;
  avatar: string | null;
  foto: string | null;
  plantillas: Plantilla[];
}

const PASOS = ["Avatar", "Perfil", "Hábitos"] as const;

/** Primeras plantillas preseleccionadas: agua y lectura, los hábitos base de luigi. */
const PRESELECCIONADAS = ["Tomar agua", "Leer"];

export default function Onboarding({
  onCompletar,
  onOmitir,
}: {
  onCompletar: (datos: DatosOnboarding) => void | Promise<void>;
  onOmitir: () => void;
}) {
  const [paso, setPaso] = useState(0);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState(COLORES_PERFIL[0]);
  const [elegidas, setElegidas] = useState<string[]>(PRESELECCIONADAS);
  const [guardando, setGuardando] = useState(false);

  const inicial = (nombre.trim()[0] ?? "?").toUpperCase();

  const alternarPlantilla = (nombreP: string) =>
    setElegidas((prev) =>
      prev.includes(nombreP) ? prev.filter((n) => n !== nombreP) : [...prev, nombreP],
    );

  const puedeAvanzar =
    paso === 0 ? true : paso === 1 ? nombre.trim().length > 0 : elegidas.length > 0;

  const avanzar = async () => {
    if (guardando) return;
    if (paso < PASOS.length - 1) {
      setPaso(paso + 1);
      return;
    }
    setGuardando(true);
    try {
      await onCompletar({
        nombre: nombre.trim(),
        color,
        avatar,
        foto,
        plantillas: PLANTILLAS.filter((p) => elegidas.includes(p.nombre)),
      });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Logo className="h-14 w-14" withWordmark />
      </div>

      {/* Progreso */}
      <div className="mb-8 flex items-center gap-2" aria-label={`Paso ${paso + 1} de ${PASOS.length}`}>
        {PASOS.map((etiqueta, i) => (
          <div key={etiqueta} className="flex items-center gap-2">
            <span
              className={`h-2.5 rounded-full transition-all ${
                i === paso ? "w-8 bg-accent" : i < paso ? "w-2.5 bg-accent/60" : "w-2.5 bg-border"
              }`}
            />
          </div>
        ))}
      </div>

      <div className="w-full max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-xl sm:p-8">
        <div className="mb-1 flex items-center gap-2">
          {paso > 0 && (
            <button
              type="button"
              onClick={() => setPaso(paso - 1)}
              aria-label="Volver al paso anterior"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
            >
              <IconFlechaAtras className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-xl font-bold">
            {paso === 0 && "Elige tu avatar"}
            {paso === 1 && "¿Quién eres?"}
            {paso === 2 && "Tus primeros hábitos"}
          </h1>
        </div>
        <p className="mb-6 text-sm text-muted">
          {paso === 0 && "Así te verás en la app. Puedes cambiarlo cuando quieras."}
          {paso === 1 && "Un nombre corto para tu perfil."}
          {paso === 2 && "Empieza con estos y agrega más cuando quieras."}
        </p>

        {paso === 0 && (
          <SelectorAvatar
            avatar={avatar}
            foto={foto}
            color={color}
            inicial={inicial}
            onAvatar={setAvatar}
            onFoto={setFoto}
            tamano="lg"
          />
        )}

        {paso === 1 && (
          <div>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Nombre
              <input
                type="text"
                autoFocus
                maxLength={24}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Luigi, Novia…"
                className="input-field"
              />
            </label>
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
                  className={`h-10 w-10 rounded-full transition-transform ${
                    color === c
                      ? "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        )}

        {paso === 2 && (
          <div className="flex flex-col gap-2.5">
            {PLANTILLAS.map((p) => {
              const activa = elegidas.includes(p.nombre);
              return (
                <button
                  key={p.nombre}
                  type="button"
                  aria-pressed={activa}
                  onClick={() => alternarPlantilla(p.nombre)}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${
                    activa
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-accent/50"
                  }`}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    <IconCategoria categoria={p.categoria} className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{p.nombre}</span>
                    <span className="block text-xs text-muted">
                      {p.tipo === "cantidad"
                        ? `${p.objetivo} ${p.unidad ?? "veces"} al día`
                        : "Una vez al día"}
                    </span>
                  </span>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      activa ? "border-accent bg-accent text-white" : "border-border text-transparent"
                    }`}
                  >
                    <IconCheck className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={avanzar}
          disabled={!puedeAvanzar || guardando}
          className="btn-primary mt-8 min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          {guardando
            ? "Creando perfil…"
            : paso < PASOS.length - 1
              ? "Continuar"
              : `Empezar con ${elegidas.length} ${elegidas.length === 1 ? "hábito" : "hábitos"}`}
        </button>

        {paso === 0 && (
          <button
            type="button"
            onClick={onOmitir}
            className="mt-4 w-full text-center text-sm text-muted hover:text-foreground hover:underline"
          >
            Crear perfil sin ayuda
          </button>
        )}
      </div>
    </div>
  );
}
