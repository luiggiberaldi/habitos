"use client";

import { useEffect } from "react";
import { useStoreState } from "../lib/habitos/store-context";

export default function ThemeApplier() {
  const { state } = useStoreState();
  const { tema, reducirMovimiento } = state.settings;

  useEffect(() => {
    const root = document.documentElement;
    // El setting usa español ("claro"/"oscuro") pero el CSS espera "light"/"dark".
    const resolved =
      tema === "sistema"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : tema === "oscuro"
          ? "dark"
          : "light";
    root.dataset.theme = resolved;
  }, [tema]);

  useEffect(() => {
    const matches = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reducir = reducirMovimiento || matches;
    document.documentElement.classList.toggle("reduce-motion", reducir);
  }, [reducirMovimiento]);

  return null;
}
