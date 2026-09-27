"use client";

import { useRef, useState } from "react";
import { AVATARES } from "../lib/avatares";
import { procesarFoto } from "../lib/foto";
import { IconCamara } from "../lib/icons";

interface Props {
  avatar: string | null;
  foto: string | null;
  color: string;
  inicial: string;
  onAvatar: (id: string | null) => void;
  onFoto: (dataUrl: string | null) => void;
  /** Tamaño de las fichas: md = h-14 (modal), lg = h-16 (onboarding). */
  tamano?: "md" | "lg";
}

/**
 * Selector de avatar de perfil: inicial con color, galería de avatares
 * o foto personalizada (se recorta a 256px y se guarda en el perfil).
 * La foto tiene prioridad: elegir otra opción la descarta.
 */
export default function SelectorAvatar({
  avatar,
  foto,
  color,
  inicial,
  onAvatar,
  onFoto,
  tamano = "md",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const ficha = tamano === "lg" ? "h-16 w-16" : "h-14 w-14";
  const textoInicial = tamano === "lg" ? "text-2xl" : "text-xl";
  const seleccionada = "scale-105 ring-2 ring-accent ring-offset-2 ring-offset-surface";
  // Hay foto: la ficha de foto es la seleccionada. Sin foto: gana el avatar
  // de galería elegido, o la inicial.
  const fotoActiva = foto !== null;

  const elegirGaleria = (id: string | null) => {
    onFoto(null);
    onAvatar(id);
  };

  const alElegirArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite elegir el mismo archivo de nuevo
    if (!file) return;
    setProcesando(true);
    setError(null);
    try {
      onFoto(await procesarFoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo usar esa imagen.");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="Avatar del perfil">
        <button
          key="inicial"
          type="button"
          role="radio"
          aria-checked={!fotoActiva && avatar === null}
          aria-label="Inicial del nombre"
          title="Inicial"
          onClick={() => elegirGaleria(null)}
          className={`flex ${ficha} items-center justify-center rounded-full ${textoInicial} font-bold text-white transition-transform ${
            !fotoActiva && avatar === null ? seleccionada : "hover:scale-105"
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
            aria-checked={!fotoActiva && avatar === a.id}
            aria-label={a.nombre}
            title={a.nombre}
            onClick={() => elegirGaleria(a.id)}
            className={`${ficha} overflow-hidden rounded-full transition-transform ${
              !fotoActiva && avatar === a.id ? seleccionada : "hover:scale-105"
            }`}
          >
            <img src={a.src} alt="" className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
        <button
          key="foto"
          type="button"
          role="radio"
          aria-checked={fotoActiva}
          aria-label={fotoActiva ? "Foto personalizada (toca para cambiarla)" : "Subir foto personalizada"}
          title={fotoActiva ? "Cambiar foto" : "Foto personalizada"}
          onClick={() => inputRef.current?.click()}
          disabled={procesando}
          className={`${ficha} overflow-hidden rounded-full border-2 border-dashed border-border transition-transform ${
            fotoActiva ? seleccionada : "hover:scale-105"
          } ${procesando ? "opacity-60" : ""}`}
        >
          {fotoActiva && foto ? (
            <img src={foto} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted">
              <IconCamara className="h-6 w-6" />
            </span>
          )}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={alElegirArchivo}
      />
      {procesando && <p className="mt-1.5 text-xs text-muted">Procesando foto…</p>}
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-500">
          {error}
        </p>
      )}
      {fotoActiva && (
        <p className="mt-1.5 text-xs text-muted">Elegir otra opción quita la foto personalizada.</p>
      )}
    </div>
  );
}
