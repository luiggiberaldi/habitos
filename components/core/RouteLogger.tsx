"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { logEvent } from "../../lib/core/logger";

/**
 * Auditoría de navegación: registra cada cambio de ruta.
 * La primera vista la cubre APP_OPENED (con la ruta incluida); aquí solo los
 * cambios posteriores dentro de la misma carga de página.
 */
export default function RouteLogger() {
  const pathname = usePathname();
  const primera = useRef(true);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    logEvent("PAGE_VIEWED", "navegacion", null, { ruta: pathname });
  }, [pathname]);

  return null;
}
