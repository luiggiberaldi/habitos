This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Plan de mejoras — dashboards más claros y detallados

### Objetivo
Hacer que las vistas **Hoy** y **Estadísticas** expliquen de un vistazo qué significan las cifras, cómo se calcularon y qué acciones o tendencias representan, manteniendo una interfaz compacta y legible en móvil y escritorio. La referencia visual adjunta orienta el calendario de actividad y sus métricas.

### Dashboard de Estadísticas
- [ ] **Métricas con contexto:** acompañar puntos, registros, días activos y consistencia con periodo analizado, unidad y una explicación breve; incluir comparación con el periodo anterior equivalente (diferencia y tendencia), sin presentar porcentajes engañosos cuando la base sea cero.
- [ ] **Calendario de actividad legible:** reducir y uniformar las celdas, conservar alineación por día de semana, incluir fecha, cantidad de registros e intensidad/porcentaje en tooltip accesible, y una leyenda que explique claramente los niveles (incluido cero).
- [ ] **Resumen semanal:** mostrar registros frente a objetivo, días activos y cambios destacados de la semana, indicando explícitamente el rango de fechas.
- [ ] **Desglose por hábito:** permitir entender qué hábitos contribuyen a los resultados con registros/objetivos, consistencia y racha, evitando depender solo del color.
- [ ] **Estados y accesibilidad:** explicar periodos sin actividad y ausencia de datos con mensajes útiles; soportar teclado, lectores de pantalla, contraste y pantallas pequeñas.

### Dashboard de Hoy
- [ ] **Progreso accionable:** explicar el total completado frente al total previsto, diferenciar descansos y hábitos programados para hoy, y mostrar qué falta para completar el día.
- [ ] **Contexto por hábito/momento:** presentar horario, subtareas pendientes/completadas y racha sin ambigüedades; ofrecer recordatorios opcionales sin bloquear el registro.
- [ ] **Resumen al cierre del día:** al completar todo, mostrar un resumen de logros y puntos con lenguaje claro, sin ocultar la lista ni las opciones de deshacer.

### Criterios de aceptación
- Cada métrica tiene nombre, unidad, periodo y ayuda/contexto suficiente para interpretarla sin documentación externa.
- Calendario identificable por fecha y actividad aun sin distinguir colores; leyenda y tooltips coinciden con el cálculo real.
- Las comparaciones usan ventanas equivalentes y declaran el cambio absoluto/relativo; si no hay referencia, se indica «sin datos previos».
- Hoy explica numerador/denominador del progreso y mantiene controles de registro/subtareas accesibles en móvil y teclado.
- Verificar los estados con datos, sin datos y actividad parcial, además de lint, typecheck y build.

### Prioridad sugerida
1. Calendario compacto con tooltips/leyenda y métricas contextualizadas.
2. Progreso de Hoy explicado y resumen semanal.
3. Comparativas y desglose por hábito.
4. Accesibilidad, estados vacíos y validación responsive de todas las vistas.
