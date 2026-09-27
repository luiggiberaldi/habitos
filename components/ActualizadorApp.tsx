"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconActualizar, IconX } from "../lib/icons";
import { logEvent } from "../lib/logger";

/**
 * ActualizadorApp: la PWA ya no exige cerrar/reabrir para ver cambios.
 *
 * El service worker hace skipWaiting + clients.claim, así que una versión
 * nueva toma el control sola, pero la pestaña abierta sigue corriendo el JS
 * viejo. Este componente:
 *  - Revisa si hay versión nueva cada vez que la app vuelve a primer plano
 *    y cada 30 minutos (`registration.update()`).
 *  - Cuando el SW nuevo toma el control (`controllerchange`), muestra un
 *    aviso con un botón para recargar y aplicar la versión al instante.
 */
export default function ActualizadorApp() {
  const [hayNueva, setHayNueva] = useState(false);
  const [descartado, setDescartado] = useState(false);
  const recargando = useRef(false);

  const marcarLista = useCallback(() => {
    setHayNueva(true);
    setDescartado(false);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // En la primera instalación no hay nada que actualizar: solo avisar
    // cuando ya había un SW controlando la página.
    const teniaControlador = !!navigator.serviceWorker.controller;
    let registro: ServiceWorkerRegistration | null = null;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    const alCambiarControlador = () => {
      if (recargando.current || !teniaControlador) return;
      marcarLista();
    };

    const vigilarWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller && teniaControlador) {
          marcarLista();
        }
      });
    };

    const revisarAlVolver = () => {
      if (document.visibilityState === "visible") {
        void registro?.update().catch(() => {});
      }
    };

    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registro = reg;
        // Una versión pudo quedar esperando de una visita anterior.
        if (reg.waiting && teniaControlador) {
          marcarLista();
          return;
        }
        reg.addEventListener("updatefound", () => vigilarWorker(reg.installing));
        vigilarWorker(reg.installing);
        document.addEventListener("visibilitychange", revisarAlVolver);
        intervalo = setInterval(() => {
          void reg.update().catch(() => {});
        }, 30 * 60 * 1000);
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", alCambiarControlador);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", alCambiarControlador);
      document.removeEventListener("visibilitychange", revisarAlVolver);
      if (intervalo) clearInterval(intervalo);
    };
  }, [marcarLista]);

  const aplicar = () => {
    if (recargando.current) return;
    recargando.current = true;
    logEvent("APP_UPDATED", "app", null, null);
    window.location.reload();
  };

  if (!hayNueva || descartado) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-6">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-background shadow-2xl"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/15">
          <IconActualizar className="h-5 w-5" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">
          Hay una nueva versión de Hábitos.
        </p>
        <button
          type="button"
          onClick={aplicar}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-transform active:scale-95"
        >
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => setDescartado(true)}
          aria-label="Ahora no"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-background/15"
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
