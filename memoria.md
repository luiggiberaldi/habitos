# Memoria del proyecto — Hábitos

> Contexto durable para agentes y colaboradores. Actualizar cuando cambien arquitectura, decisiones o estado relevante.

## Propósito
Aplicación web en español para crear hábitos, registrarlos diariamente y consultar estadísticas, rachas y gamificación.

## Tecnología y comandos
- Next.js 16 App Router, React 19 y TypeScript.
- Estilos con Tailwind CSS 4; persistencia/sincronización con Supabase.
- Desde este directorio (`app/habitos`): `npm run dev`, `npm run lint`, `npm run build`.
- Typecheck: `npx tsc --noEmit`.
- Antes de modificar APIs/convenios de Next.js, seguir las instrucciones locales de `AGENTS.md` y consultar la documentación incluida en `node_modules/next/dist/docs/`.

## Estructura principal
- `app/page.tsx`: vista Hoy y registro de cumplimientos.
- `app/habitos/page.tsx`: alta, edición y gestión de hábitos.
- `app/estadisticas/page.tsx`: estadísticas y rachas.
- `app/ajustes/page.tsx`: preferencias.
- `lib/types.ts`: modelos de dominio.
- `lib/store.ts`: estado, validación, normalización y operaciones de cumplimiento.
- `lib/store-context.tsx`: contexto React que expone el estado y acciones.
- `lib/dates.ts`: fechas y cálculo de cumplimientos.
- `lib/gamificacion.ts`: puntos y consistencia.
- `lib/supabase.ts`: integración de persistencia.
- `docs/`: documentación de producto y planes.

## Modelo y comportamiento
- Los días se representan con `0 = domingo` hasta `6 = sábado`.
- Los hábitos existentes sin `tipo` se interpretan como hábitos por momento, para conservar compatibilidad con datos guardados.
- `tipo: "momento"`: cada momento tiene un registro idempotente por hábito, momento y fecha (`YYYY-MM-DD`).
- `tipo: "cantidad"`: cada toque agrega un evento distinto con timestamp; no tiene momentos programados. `unidad` es opcional y el objetivo diario define el umbral/meta.
- Las estadísticas, puntos y rachas deben distinguir esos dos tipos: en cantidad cuentan eventos únicos; por momento cuentan momentos únicos.
- Mantener `eventId` único y validar/normalizar datos antiguos al cargarlos.

## Convenciones de cambio
- Interfaz y textos en español; priorizar accesibilidad, uso móvil y consistencia con componentes/clases existentes.
- Cambios en el modelo deben contemplar carga de estado persistido y todas las vistas que agregan o presentan cumplimientos.
- No introducir dependencias nuevas si la funcionalidad se resuelve con las existentes.
- Ejecutar typecheck, lint y pruebas/build relevantes después de cambios no triviales.

## Estado conocido
- Hay documentación de producto pendiente en `README.md` (plan para mejorar claridad de Hoy y Estadísticas) y `docs/plan-notificaciones-push.md`.
- Revisar el esquema y políticas de Supabase cuando se cambien campos persistidos; no asumir que el tipo TypeScript actual basta para migrar la base.

## Archivos de contexto Vibe System
Mantener junto a esta memoria `bitacora.md` (cronología), `inteligencia.md` (aprendizajes reutilizables) y `agent.md` (instrucciones de trabajo). Consultar esos archivos antes de iniciar tareas relacionadas y actualizarlos cuando corresponda.
