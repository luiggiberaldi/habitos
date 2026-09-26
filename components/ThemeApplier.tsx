"use client";

import { useEffect } from "react";
import { useStore } from "../lib/store-context";

export default function ThemeApplier() {
  const { state } = useStore();
  const { tema, reducirMovimiento } = state.settings;

  useEffect(() => {
    const root = document.documentElement;
    const resolved =
      tema === "sistema"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : tema;
    root.dataset.theme = resolved;
  }, [tema]);

  useEffect(() => {
    const matches = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reducir = reducirMovimiento || matches;
    document.documentElement.classList.toggle("reduce-motion", reducir);
  }, [reducirMovimiento]);

  return null;
}
