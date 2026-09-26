"use client";

import { useEffect, useRef } from "react";
import { useStoreState } from "../lib/store-context";
import { revisarRecordatorios } from "../lib/notifications";

export default function NotificationManager() {
  const { state } = useStoreState();
  // P1.7: el estado se lee vía ref; el efecto solo se re-ejecuta cuando cambian
  // los ajustes de notificación (antes se re-registraba el SW y se reiniciaba
  // el intervalo en CADA cambio de estado).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const notificaciones = state.settings.notificaciones;
  const horasDescanso = state.settings.horasDescanso;

  useEffect(() => {
    if (!notificaciones || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;

    let activo = true;
    const revisar = () => {
      if (document.visibilityState !== "visible") return;
      void revisarRecordatorios(stateRef.current).catch(() => {
        // Un error temporal de navegador no debe interrumpir la aplicación.
      });
    };
    // P1.7: ruta absoluta — "./sw.js" resolvía relativo a la página (/ajustes/sw.js → 404).
    void navigator.serviceWorker.register("/sw.js").then(() => {
      if (activo) revisar();
    }).catch(() => {});
    const interval = window.setInterval(revisar, 15_000);
    const handleVisibility = () => { if (document.visibilityState === "visible") revisar(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      activo = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [notificaciones, horasDescanso]);

  return null;
}
