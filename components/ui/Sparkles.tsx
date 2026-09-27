"use client";

import { useEffect, useRef } from "react";

interface Particula {
  x: number;
  y: number;
  radio: number;
  fase: number;
  velocidad: number;
}

/**
 * Destellos animados sobre un canvas (inspirado en el componente Sparkles de
 * Aceternity UI, reimplementado sin dependencias para no engordar la PWA).
 * Se usa como fondo de celebraciones (subida de nivel, cofre, día completo).
 * Con `prefers-reduced-motion` no anima: deja un puñado de puntos fijos.
 */
export default function Sparkles({
  className = "",
  color = "#F8B808",
  densidad = 36,
}: {
  className?: string;
  color?: string;
  densidad?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    const particulas: Particula[] = Array.from({ length: densidad }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      radio: 0.7 + Math.random() * 1.9,
      fase: Math.random() * Math.PI * 2,
      velocidad: 0.6 + Math.random() * 1.6,
    }));

    const dibujarEstatico = (): void => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (const p of particulas) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dibujarEstatico();
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const dibujar = (t: number): void => {
      const s = (t - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      for (const p of particulas) {
        const brillo = 0.25 + 0.75 * Math.abs(Math.sin(p.fase + s * p.velocidad));
        ctx.globalAlpha = brillo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radio, 0, Math.PI * 2);
        ctx.fill();
        // Cruz de destello en las partículas grandes.
        if (p.radio > 1.8) {
          const l = p.radio * 3.2;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - l, p.y);
          ctx.lineTo(p.x + l, p.y);
          ctx.moveTo(p.x, p.y - l);
          ctx.lineTo(p.x, p.y + l);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(dibujar);
    };
    raf = requestAnimationFrame(dibujar);
    return () => cancelAnimationFrame(raf);
  }, [color, densidad]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`} />;
}
