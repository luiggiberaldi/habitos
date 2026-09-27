"use client";

import { useState } from "react";
import { IconOjo, IconOjoTachado } from "../lib/icons";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Nombre del campo para el lector de pantalla ("PIN", "contraseña"…). */
  nombre?: string;
}

/**
 * Campo de contraseña/PIN con ojito para mostrar u ocultar el valor.
 * Todo redondeado y con iconos del set propio (reglas de UI).
 */
export default function CampoClave({ nombre = "contraseña", className = "", ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Ocultar ${nombre}` : `Mostrar ${nombre}`}
        aria-pressed={visible}
        title={visible ? `Ocultar ${nombre}` : `Mostrar ${nombre}`}
        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        {visible ? <IconOjoTachado className="h-5 w-5" /> : <IconOjo className="h-5 w-5" />}
      </button>
    </div>
  );
}
