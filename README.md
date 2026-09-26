# Hábitos

App de seguimiento de hábitos (PWA) con Next.js 16 + React 19 + TypeScript + Supabase. Interfaz en español, funciona offline y sincroniza con la nube.

## Puesta en marcha

```bash
npm install
cp env.example .env.local   # y completa las variables (ver abajo)
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

Scripts útiles:

| Script | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | build de producción |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint` (en CI se usa `npx eslint .`) |
| `npm run test:smoke` | smoke tests de la lógica crítica de sync (sin dependencias) |

El CI (`.github/workflows/ci.yml`) corre en cada push/PR a `main`: `npm ci` → `typecheck` → `lint` → `build` → `test:smoke`, con Node 24.

## Variables de entorno

`.env.local` está en `.gitignore`: **nunca commitear valores reales**.

| Variable | Dónde se usa | Obligatoria |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | cliente web | sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente web | sí |
| `SUPABASE_ACCESS_TOKEN` | CLI / migraciones vía API | para deploys |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | suscripción web push | para push |
| `VAPID_SUBJECT` | `web-push` (contacto, p. ej. `mailto:`) | para push |
| `CRON_SECRET` | Edge Function `push-notifications` (cabecera `x-cron-secret`) | para el scheduler |

La Edge Function además acepta `DEFAULT_TIMEZONE` (p. ej. `America/Caracas`).

## Arquitectura de sincronización

Fuente de verdad local: `localStorage` (`lib/store.ts`, funciones puras). Persistencia remota: Supabase (`lib/store-context.tsx`).

- **EventIds: un evento, un id.** `lib/event-id.ts` es la única fuente. `registrar()` genera el id **una sola vez** y ese mismo valor viaja al estado local, al upsert en `completions` y a la cola offline. Nunca se derivan dos ids para el mismo evento.
  - Hábitos por momento: id determinista `habitId|momentId|fecha` (idempotente: reintentar no duplica).
  - Hábitos de cantidad: id único `habitId|cantidad|fecha|timestamp-random` (cada tap es un registro propio).
- **Writes remotos inspeccionados.** Todo write pasa por `sincronizar()`, que revisa `result.error` (en supabase-js los errores de RLS/constraints *resuelven*, no rechazan): error de red → cola offline; otro error → se surfacea en `errorSync` ("sin sincronizar") en vez de perderse en silencio.
- **Rehidratación.** Al iniciar sesión: primero se reenvían los pendientes offline, luego se descargan `habits`/`completions` (RLS confina al usuario) y se fusionan por `id`/`eventId` dentro del updater funcional. El estado solo se actualiza si el merge produjo cambios reales.
- **Estrategia de conflictos: last-write-wins.** Al hidratar, gana la versión con `updated_at` (remoto) o `actualizadoEn` (local) mayor; en empate gana local (`lib/sync-merge.ts`). Los borrados viajan como tombstones en `deleted_habits` (migración `0007`) y purgan el hábito en todos los dispositivos.
- **Cola offline.** `habitos-pending-sync-v1` en `localStorage`, acotada a 200 ops; se reenvía al recuperar conexión (previsto: namespace por usuario, P1.5).

## Migraciones (Supabase)

Aplicar **en este orden** (solo con autorización explícita; la auditoría no aplica migraciones):

1. `0004_habitos_core.sql` — tablas `habits`, `completions`, `activity_log` con RLS estricto.
2. `0005_push_log_habit_id_text.sql` — `push_log.habit_id` uuid → text (los ids son text).
3. `0006_push_subscriptions_timezone.sql` — (prevista, P1.8) columna `timezone` para el scheduler.
4. `0003_push_schedule.sql` — **reescrita sin secretos** (ver "Cron" abajo).
5. `0007_deleted_habits.sql` — (opcional, P2.6) tombstones para borrados.

Verificación post-migración: revisar policies en Dashboard → Database → Policies y probar que un `insert` con la anon key de otro usuario falla por RLS.

## Cron de notificaciones push (sin secretos en el SQL)

**Nunca pegar `SERVICE_ROLE_KEY` ni `CRON_SECRET` en un archivo `.sql`.** Procedimiento:

1. En el Dashboard de Supabase: **Database → Cron → Create job**.
2. Nombre: `push-notifications-minuto`, schedule: `* * * * *`.
3. Tipo HTTP POST a `https://<PROJECT_REF>.supabase.co/functions/v1/push-notifications`, con headers `x-cron-secret: <valor del Vault>` y `Authorization: Bearer <service_role del Vault>`.
4. Los secretos viven en el **Vault** del proyecto (o como secrets de la Edge Function), nunca en git.
5. Verificar: invocar la función sin la cabecera debe responder `401`; con el secreto correcto, `200`.

La función exige `CRON_SECRET` configurado (fail-closed): si falta, responde 401.

## Plan maestro de corrección

La auditoría end-to-end y el plan de fixes por fases (P0 → P3) con guardarraíles y arneses de verificación están en [`docs/plan-maestro-fix.md`](docs/plan-maestro-fix.md).

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
- [ ] **Progreso accionable:** explicar el total completado frente al total previsto, diferenciar descansos y hábitos programados para hoy, mostrar qué falta para completar el día.
- [ ] **Contexto por hábito/momento:** presentar horario, subtareas pendientes/completadas y racha sin ambigüedades; ofrecer recordatorios opcionales sin bloquear el registro.
- [ ] **Resumen al cierre del día:** al completar todo, mostrar un resumen de logros y puntos con lenguaje claro, sin ocultar la lista ni las opciones de deshacer.

### Criterios de aceptación
- Cada métrica tiene nombre, unidad, periodo y ayuda/contexto suficiente para interpretarla sin documentación externa.
- Calendario identificable por fecha y actividad aun sin distinguir colores; leyenda y tooltips coinciden con el cálculo real.
- Las comparaciones usan ventanas equivalentes y declaran el cambio absoluto/relativo; si no hay referencia, se indica «sin datos previos».
- Hoy explica numerador/denominador del progreso y mantiene controles de registro/subtareas accesibles en móvil y teclado.
- Verificar los estados con datos, sin datos y actividad parcial, además de lint, typecheck y build.
