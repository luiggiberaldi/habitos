"use client";

import { useEffect } from "react";
import { useStore } from "../lib/store-context";
import { revisarRecordatorios } from "../lib/notifications";

export default function NotificationManager() {
  const { state } = useStore();

  useEffect(() => {
    if (!state.settings.notificaciones || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;

    let activo = true;
    const revisar = () => {
      if (document.visibilityState !== "visible") return;
      void revisarRecordatorios(state).catch(() => {
        // Un error temporal de navegador no debe interrumpir la aplicación.
      });
    };
    void navigator.serviceWorker.register("./sw.js").then(() => {
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
  }, [state]);

  return null;
}
