# Plan Maestro de Corrección — Hábitos

**Base:** auditoría end-to-end del 2026-09-26 sobre el commit `ab912dd` ("Hábitos Core Fase 0").
**Objetivo:** llevar la app a un estado donde la Fase 0 cumpla lo que promete (persistencia real en Supabase) y el push funcione de punta a punta, sin regresiones.
**Regla de oro:** ningún fix se da por terminado sin pasar su arnés de verificación (§8). No se avanza de fase sin cerrar la anterior.

---

## 1. Guardarraíles globales (invariantes que ningún cambio puede romper)

1. **Un evento, un id.** El `eventId` de un completion se genera **una sola vez**, en un único lugar (`lib/event-id.ts`), y viaja idéntico a estado local, Supabase y cola offline. Nunca se derivan dos ids distintos para el mismo evento.
2. **Todo write remoto inspecciona su resultado.** Ningún `.then(() => {})` que ignore el valor resuelto. Todo error no-red se *surfacea* (indicador "sin sincronizar" en UI); todo error de red entra a la cola.
3. **Ningún efecto depende de una función memoizada sobre el estado que ese mismo efecto muta.** Los efectos de sync dependen de primitivos (`userId`, flags) o usan refs estables.
4. **La cola offline siempre va namespaced por usuario** y se vacía al cerrar sesión.
5. **Secretos nunca en migraciones ni en git.** Solo vía Dashboard/Vault o variables de entorno.
6. **Fail-closed en autenticación del scheduler.** Si `CRON_SECRET` no está configurado, la función responde 401.
7. **El cliente nunca escribe JSON arbitrario sin validación** en columnas `jsonb` que consuma la Edge Function.

---

## 2. Fase P0 — Críticos (orden estricto, uno por uno)

### P0.1 Loop infinito de rehidratación
- **Archivo:** `lib/store-context.tsx` (efecto ~líneas 300-306; `rehidratar` useMemo líneas 118-180)
- **Causa:** el efecto depende de `rehidratar`, cuyo `useMemo` depende de `[userId, state.habits, state.completions]`. Cada ejecución termina en `setState` con arrays siempre nuevos → nueva identidad de `rehidratar` → el efecto se re-dispara cada ~50 ms. Descargas, re-renders y escrituras a localStorage sin fin.
- **Cambio:**
  1. Declarar `reenviarPendientes` **antes** que `rehidratar` (también elimina el error de lint de uso-antes-de-declarar).
  2. El efecto dispara solo con `[userId, estadoCargado]` y llama a una ref estable (`rehidratarRef.current()`), no a la función memoizada.
  3. Dentro de `rehidratar`: comparar contenido antes de `setState` (sets de `id`/`eventId`); si el merge no produjo diferencias, no actualizar.
  4. (Opcional pero recomendado) El merge se calcula **dentro** del updater funcional `setState(s => merge(s, remotos))` en vez de capturar `state` del closure — esto también cierra la condición de carrera P1.4.
- **Aceptación:** con sesión abierta y la pestaña Network abierta, tras el login hay exactamente 1 hidratación (2 SELECTs) y luego silencio de red hasta la próxima acción del usuario.

### P0.2 `eventId` único para hábitos de cantidad
- **Archivos:** `lib/store.ts` (líneas 40-52: genera `habitId|Date.now()-random` por tap) y `lib/store-context.tsx` (líneas 262-263: sube `habitId|cantidad|fecha`, idéntico para todos los taps del día). Hoy: la nube colapsa N taps a 1 fila, el rehydrate añade completions fantasma y `deshacer` nunca borra la fila remota.
- **Cambio:**
  1. Crear `lib/event-id.ts` con `construirEventId(habitId, momentId, fecha)` como única fuente.
  2. `registrar()` en el contexto genera el id **una vez** y se lo pasa a `registrarCumplimiento` (nuevo parámetro opcional `eventId?`); el upsert a `completions` usa ese mismo id. La columna `moment_id` ya es nullable en la migración 0004, así que el id único no rompe nada.
  3. De paso: usar un solo `Date.now()`/`random` para `id` y `eventId` (hoy se generan con dos llamadas distintas).
- **Aceptación:** 5 taps en un hábito de cantidad → 5 filas en `completions` (Supabase) con `event_id` distintos; rehydrate no añade fantasmas; `deshacer` elimina la fila remota correspondiente.

### P0.3 Los writes remotos deben inspeccionar `result.error`
- **Archivo:** `lib/store-context.tsx` (líneas 228-295: `guardarHabit`, `eliminarHabit`, `registrar`, `deshacer`, `guardarSettings` usan `.then(() => {}, rejectionHandler)` que ignora el valor resuelto; en supabase-js los errores de RLS/constraints **resuelven** `{ error }`, no rechazan).
- **Cambio:** centralizar en un helper `ejecutarOp(tipo, payload, fn)` que hace `await`, inspecciona `{ error }`: si es error de red → encola en la cola offline; si es otro error → lo registra, lo *surfacea* (p. ej. estado `syncError` en el contexto + indicador en UI) y **no** lo encola. Migrar los 6 handlers a este helper.
- **Aceptación:** simular un fallo de RLS (policy temporalmente restrictiva o `user_id` ajeno) → la UI muestra "sin sincronizar" en vez de avanzar en silencio; al recuperar la red tras un corte, la cola reenvía y el indicador se limpia.

### P0.4 `push_log.habit_id`: `uuid` → `text`
- **Archivo:** nueva migración `supabase/migrations/0005_push_log_habit_id_text.sql`
- **Causa:** `0002_push_log.sql:19` declara `habit_id uuid not null`, pero `habits.id` es `text` (`0004`). Cada insert de dedupe falla (`invalid input syntax for type uuid`) → el dedupe nunca registra → el cron reenvía el mismo push cada minuto.
- **Cambio:** `alter table public.push_log alter column habit_id type text;` (no hay FK que lo impida).
- **Aceptación:** invocar la Edge Function dos veces en el mismo minuto para el mismo hábito pendiente → solo 1 push enviado (segundo intento dedupado por `push_log`).

---

## 3. Fase P1 — Altos

### P1.1 `CRON_SECRET` fail-closed
- **Archivo:** `supabase/functions/push-notifications/index.ts:206-207` (`if (CRON_SECRET && auth !== CRON_SECRET)` → abierto si la var no existe).
- **Cambio:** `if (!CRON_SECRET || auth !== CRON_SECRET) return 401`; validar las env vars requeridas al arranque (en vez de non-null assertions que tumban la función en frío); aceptar **solo** `x-cron-secret` (quitar la alternativa `authorization` ambigua).
- **Aceptación:** sin `CRON_SECRET` seteado → 401; con secreto incorrecto → 401; con el correcto → 200.

### P1.2 Migración 0003 sin secretos en texto plano + `pg_net`
- **Archivo:** `supabase/migrations/0003_push_schedule.sql` (placeholders `<PROJECT_REF>`, `<SERVICE_ROLE_KEY>`, `<CRON_SECRET>` con instrucción de pegarlos; falta `create extension if not exists pg_net;` sin la cual `net.http_post` no existe).
- **Cambio:** reescribir la migración sin placeholders: crear el job desde Dashboard → Database → Cron usando secretos del Vault, o documentar el procedimiento con `supabase secrets`. Añadir `create extension if not exists pg_net;`.
- **Aceptación:** la migración aplica limpiamente en un proyecto fresco sin edición manual; ningún secreto aparece en el historial de git.

### P1.3 Last-write-wins real en el merge de hábitos
- **Archivo:** `lib/store-context.tsx:139-146` (`localById.get(r.id) ?? r` descarta la versión remota sin comparar `updated_at`, que sí se selecciona).
- **Cambio:** añadir `actualizadoEn: string` al tipo `Habit`, setearlo en `guardarHabit`/`crearHabit`, persistirlo en `data`, y en el merge elegir la versión con timestamp mayor (servidor `row.updated_at` vs local `actualizadoEn`).
- **Aceptación:** editar un hábito en el dispositivo B → al rehidratar en A, el cambio aparece (hoy se pierde).

### P1.4 Merge dentro del updater funcional (cierra la carrera con P0.1)
- Incluido en el punto 4 de P0.1: `setState(s => merge(s, remotos))`. Si P0.1 ya lo hizo, solo verificar con prueba: disparar `registrar()` mientras un `rehidratar` está en vuelo → el tap sobrevive en el estado.

### P1.5 Cola offline namespaced por usuario + limpieza en logout
- **Archivo:** `lib/store-context.tsx:46` (`PENDING_KEY` global).
- **Cambio:** `PENDING_KEY = \`habitos-pending-sync-v1:${userId}\``; al cerrar sesión, vaciar la cola en memoria y no reenviar ops cuyo `user_id` no coincida con la sesión actual.
- **Aceptación:** login como usuario B con ops pendientes de A → no se reintentan con la sesión de B; logout limpia.

### P1.6 Paginación / sync incremental en la hidratación
- **Archivo:** `lib/store-context.tsx:130-133,152-155` (SELECTs sin `.range()`; PostgREST trunca en 1000 filas en silencio).
- **Cambio (mínimo viable):** bucle con `.range()` hasta agotar. **(Recomendado):** sync incremental: guardar `lastSync` en localStorage, filtrar `created_at > lastSync`, con índice ya existente en `created_at`.
- **Aceptación:** con >1000 completions en la tabla, el rehydrate fusiona todas (verificar conteo local == conteo remoto).

### P1.7 `NotificationManager`: SW absoluto y deps estrechas
- **Archivo:** `components/NotificationManager.tsx:20,31-33` (`register("./sw.js")` → 404 desde rutas anidadas; deps `[state]` re-registran el SW en cada cambio de estado).
- **Cambio:** `/sw.js` absoluto; deps `[state.settings.notificaciones, state.settings.horasDescanso]` (o refs), registrando una sola vez.
- **Aceptación:** navegar a `/ajustes` no produce 404 de `sw.js`; el intervalo de 15 s no se reinicia al marcar hábitos.

### P1.8 Timezone real del cliente para el scheduler
- **Archivo:** `supabase/functions/push-notifications/index.ts` (la zona "por usuario" se lee de `row.data.settings.timezone`, pero `settings` vive en localStorage y nunca se sincroniza → siempre cae a `DEFAULT_TIMEZONE = "America/Mexico_City"`; para Venezuela los recordatorios llegan 2 h tarde).
- **Cambio:** nueva migración `0006_push_subscriptions_timezone.sql` (columna `timezone text`); el cliente escribe `Intl.DateTimeFormat().resolvedOptions().timeZone` al suscribirse; la función lee de ahí; default `America/Caracas`. Además: la `fecha` del `push_log` debe calcularse con la zona del usuario, no con la default (dedupe inconsistente cerca de medianoche).
- **Aceptación:** usuario en `America/Caracas` recibe el recordatorio en su HH:mm local, no 2 h tarde.

---

## 4. Fase P2 — Medios

### P2.1 `guardarHabit` muta el estado previo
- **Archivo:** `lib/store.ts:73-80` (`ultimo.hasta = hoy` muta el objeto del historial, que pertenece al estado actual; solo el array se copia).
- **Cambio:** `historial.map((h, i) => i === historial.length - 1 ? { ...h, hasta: hoy } : h)`.

### P2.2 `subtareasCompletadas` se pierde en local
- **Archivos:** `lib/store.ts:38-39` (parámetro `subtareas` sin usar — el lint ya lo marca), `lib/store-context.tsx:259` (ni siquiera lo pasa).
- **Cambio:** añadir `subtareasCompletadas?: string[]` a `CompletionEvent`, persistirlo en el evento local y en el upsert a Supabase.

### P2.3 `rachaActual` unificada con historial de objetivos
- **Archivos:** `app/page.tsx:15-31` y `app/estadisticas/page.tsx:31-51` (dos implementaciones; comparan contra `habit.objetivo` actual en vez de `objetivoEnFecha`; el loop empieza hoy → racha 0 a las 8 am con 30 días seguidos).
- **Cambio:** una sola función en `lib/gamificacion.ts` que use `objetivoEnFecha(habit, key)` y empiece el conteo desde ayer si hoy está incompleto pero sin momentos vencidos. Indexar completions en un `Map` con `useMemo` en vez de O(365 × completions) por render.

### P2.4 Timestamp vacío en eventos hidratados
- **Archivos:** `lib/store-context.tsx:155` (`timestamp: ""`), `app/page.tsx:500` (`formatHoraA12("".slice(11,16))` → "12:NaN a. m.").
- **Cambio:** seleccionar `created_at` del servidor y usarlo como `timestamp`.

### P2.5 Validación al cambiar de tipo
- **Archivo:** `app/habitos/page.tsx:248-253` (pasar de "cantidad" a "momento" conserva `momentos: []` → hábito imposible de completar, 0% eterno).
- **Cambio:** al volver a "momento" con 0 momentos, crear uno por defecto; validar `objetivo <= momentos.length` al guardar.

### P2.6 Tombstones para borrados
- **Causa:** si se borra un hábito en el dispositivo B, el rehydrate de A lo re-agrega desde local (y `rehidratar` nunca escribe de vuelta). Los deletes solo viajan por la cola del dispositivo que los originó.
- **Cambio:** tabla `deleted_habits (user_id, habit_id, deleted_at)` consultada en `rehidratar`; el merge excluye hábitos borrados y los purga del estado local.

### P2.7 Service Worker: alcance, offline y LRU
- **Archivo:** `public/sw.js:73-91` (sin cambios: `cache.put` en todo GET — incluye respuestas autenticadas de Supabase, riesgo en dispositivos compartidos — sin cota ni TTL; fallback `caches.match("./")` sirve el HTML de `/` al abrir `/habitos` sin conexión).
- **Cambio:** `if (new URL(request.url).origin !== location.origin) return;` (o allowlist `/_next/static` + navegaciones), página `/offline` dedicada como fallback, purga LRU con tope de entradas.

### P2.8 Manifest instalable
- **Archivo:** `public/manifest.json:10-16` (solo `/icon.svg`; Chrome exige PNG 192 y 512; falta `purpose: "maskable"` y `icons.apple`).
- **Cambio:** generar `icon-192.png`, `icon-512.png`, `maskable-512.png` desde el SVG; declarar en el manifest; añadir `icons: { apple: "/apple-touch-icon.png" }` en `app/layout.tsx`.

### P2.9 Contraste WCAG AA (medido sobre el fondo real `#f4f5f9`)
- **Archivo:** `app/globals.css:6-19`. `--accent #328b78` → 3.78:1, `--danger #ef4444` → 3.45:1, `--muted #6b7280` → 4.44:1 (los tres FAIL para texto normal, mínimo 4.5:1).
- **Cambio:** accent claro → `#276e5f` (ya existe como `--accent-strong`, ~5.2:1); danger claro → `#dc2626`; muted claro → `#5b6472`.

### P2.10 Accesibilidad
- Skip-link + `aria-current="page"` en `components/Nav.tsx`.
- Calendario (`app/estadisticas/page.tsx:168-176`): botones sin `onClick` → convertir a `<div>` no enfocables o darles acción real (decenas de tab-stops muertos).
- Selects de tipo/ventana (`app/habitos/page.tsx:368,388`) e `<input type="time">` sin `<label>` → `aria-label` o `sr-only`.
- Botones de tema (`app/ajustes/page.tsx:68-72`) sin `aria-pressed`; error de login (`components/AuthGate.tsx`) sin `role="alert"`.
- Regla global en `globals.css`: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` (`.input-field` hoy usa `outline: none`).

### P2.11 Rendimiento del contexto
- **Archivos:** `lib/store-context.tsx:222-294` (deps del `useMemo` incluyen `rehidratar` y `pendientesVersion` → toda la app re-renderiza en cada acción); líneas 103-110 (`JSON.stringify(state)` completo en cada cambio, sin debounce; con el loop P0.1 esto escribía a localStorage varias veces por segundo).
- **Cambio:** dividir en dos contextos (estado vs acciones) con acciones estables vía `useCallback` + `setState` funcional; debounce ~500 ms (o `requestIdleCallback`) antes de persistir a localStorage.

---

## 5. Fase P3 — DX y arneses permanentes

### P3.1 Scripts y CI
- `package.json`: añadir `"typecheck": "tsc --noEmit"`, `"lint:strict": "next lint"` (o eslint directo), `"test": "vitest run"`.
- `.github/workflows/ci.yml`: en cada push/PR → `npm ci` → `typecheck` → `lint` → `build`. Ningún PR se mergea en rojo.

### P3.2 Diagnóstico del TS2306
- `npx tsc --noEmit` reporta "not a module" en `next/index.d.ts`, `next/font/google`, `next/link`, `next/navigation`. No asumir que es un quirk: verificar `tsconfig.json` (`moduleResolution`, `paths`), versión instalada de `next` vs tipos, y si `next dev` regeneró `AGENTS.md`/tipos. Cerrar con causa raíz documentada.

### P3.3 Tests de humo
- Tests unitarios para: `construirEventId` (unicidad y formato), merge de `rehidratar` (last-write-wins, dedupe por eventId, tombstones), `normalizarEstado` (ids inválidos, backfill de historial), `objetivoEnFecha`/`rachaActual` con cambios de objetivo.
- Test de integración del helper `ejecutarOp` con un mock de supabase-js que **resuelva** `{ error }` (el caso que hoy se ignora).

### P3.4 README
- Documentar: arquitectura de sync (quién genera ids, estrategia de conflictos, cola offline), cómo aplicar migraciones en orden, variables de entorno (incl. VAPID y `CRON_SECRET`), y el procedimiento del cron sin secretos en git.

---

## 6. Orden de migraciones en Supabase

Aplicar en este orden (solo con autorización explícita; la auditoría no aplicó ninguna):

1. `0004_habitos_core.sql` — si aún no está aplicada (verificar en Dashboard → Database → Migrations).
2. `0005_push_log_habit_id_text.sql` — **nueva** (P0.4).
3. `0006_push_timezone.sql` — **nueva** (P1.8): `timezone text` en `push_subscriptions` + policy `push_subscriptions_update_own` (el upsert del cliente necesita UPDATE).
4. `0003_push_schedule.sql` — **reescrita** (P1.2): crear el job desde el Dashboard con secretos del Vault; no pegar keys en el SQL.
5. `0007_deleted_habits.sql` — **nueva** (P2.6): tabla de tombstones con RLS propia.

Verificación post-migración: `select * from pg_policies where tablename in ('habits','completions','activity_log','push_log');` y un `insert` de prueba con la anon key de otro usuario (debe fallar por RLS).

---

## 7. Arneses de verificación

### 7.1 Comandos (siempre con código de salida real — sin pipes que lo enmascaren)
```bash
cd ~/workspace/habitos
npx tsc --noEmit; echo "TSC_EXIT:$?"
npx next lint; echo "LINT_EXIT:$?"        # o npm run lint:strict cuando exista
npm run build; echo "BUILD_EXIT:$?"
git status --short                        # debe estar limpio salvo los archivos del fix en curso
```
Criterio: `tsc` y `lint` en 0 errores antes de cerrar cada fase (los 5 warnings actuales se corrigen o se justifican por escrito).

### 7.2 Arnés por fix (qué mirar, dónde)
| Fix | Cómo verificar |
|---|---|
| P0.1 loop | Network tab: 1 hidratación tras login, luego silencio; `localStorage` no se reescribe solo |
| P0.2 eventId | 5 taps → 5 filas en `completions` con `event_id` distintos; rehydrate sin fantasmas; `deshacer` borra la fila |
| P0.3 result.error | Forzar error no-red (policy restrictiva temporal) → UI muestra "sin sincronizar"; corte de red → cola reenvía al volver |
| P0.4 push_log | Doble invocación misma minuto → 1 solo push (revisar tabla `push_log`) |
| P1.1 cron auth | `curl` sin secreto → 401; con secreto → 200; sin env var → 401 |
| P1.3 LWW | Editar en dispositivo B → aparece en A tras rehydrate |
| P1.5 cola | Login B con cola de A → no reintenta; logout → cola vacía |
| P1.6 paginación | >1000 completions → conteo local == remoto |
| P1.7 SW | `/ajustes` sin 404 de `sw.js`; marcar hábitos no reinicia el intervalo |
| P1.8 timezone | Recordatorio llega en HH:mm local de `America/Caracas` |

### 7.3 QA manual end-to-end (al cerrar P1)
1. Login → marcar 3 hábitos (momento + cantidad 5 taps) → verificar en Supabase: filas correctas, ids únicos.
2. Cerrar la app, cambiar nombre de un hábito en otro dispositivo → reabrir → el cambio aparece (P1.3).
3. Modo avión 2 min marcando hábitos → volver online → todo se sincroniza, sin duplicados (P0.3 + P1.5).
4. Programar recordatorio para dentro de 3 min → llega 1 sola vez, no cada minuto (P0.4 + P1.1).
5. Borrar un hábito en B → no resucita en A (P2.6, si se implementó).

---

## 8. Criterio de "listo"

- [ ] P0 completo con sus 4 arneses en verde.
- [ ] `tsc --noEmit` y `lint` en 0 errores; `npm run build` exitoso.
- [ ] P1 completo con QA end-to-end (§7.3) superado.
- [ ] Migraciones aplicadas en orden (§6) y verificadas con RLS.
- [ ] CI en verde en `main`.
- [ ] Este documento actualizado con lo que se desvió del plan y por qué.

*Nota de entorno: la copia de trabajo vive en `~/workspace/habitos` (se movió desde `/tmp` porque el tmpfs estaba al 100%). `.env.local` está configurado localmente (gitignored, no commitear). No aplicar migraciones ni pushear sin autorización explícita.*

*Nota 2026-09-26 (Fase P0): `npm run build` NO corre en esta VM — el binario nativo de SWC (`@next/swc-linux-x64-gnu`) muere con SIGBUS ("Bus error") al cargarse, incluso recién reinstalado. Es un problema del entorno, no del código. Validación sustituta: `tsc --noEmit` (0 errores propios; persisten los 5 TS2306 preexistentes de `node_modules/next/*.d.ts`, ver P3.2), `eslint` (0 errores, 0 warnings) y smoke tests de runtime de `lib/event-id.ts` + `lib/store.ts` (8/8 asserts OK).*`
