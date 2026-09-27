"use client";

import { useEffect, useRef } from "react";

/** Paleta brasa de la app para el confeti. */
const COLORES = ["#F84818", "#F88808", "#F8B808", "#FFD166", "#FFFFFF", "#CE3F14"];

interface ParticulaConfeti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
}

/**
 * Explosión de confeti en canvas: una sola ráfaga (~1.4s) desde el centro
 * del área, con gravedad y rotación. Sin dependencias, como el resto de
 * micro-interacciones (la PWA sigue liviana).
 * Con `prefers-reduced-motion` no anima: no dibuja nada.
 */
export default function Confeti({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    const ox = w / 2;
    const oy = h * 0.3;

    const particulas: ParticulaConfeti[] = Array.from({ length: 90 }, () => {
      const ang = Math.random() * Math.PI * 2;
      const vel = 2.5 + Math.random() * 5.5;
      return {
        x: ox,
        y: oy,
        vx: Math.cos(ang) * vel,
        vy: Math.sin(ang) * vel - 3.5,
        w: 5 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORES[Math.floor(Math.random() * COLORES.length)],
      };
    });

    const DUR = 1400;
    const GRAVEDAD = 0.22;
    let raf = 0;
    const inicio = performance.now();

    const tick = (ahora: number): void => {
      const t = (ahora - inicio) / DUR;
      if (t >= 1) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      ctx.clearRect(0, 0, w, h);
      for (const p of particulas) {
        p.vy += GRAVEDAD;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
