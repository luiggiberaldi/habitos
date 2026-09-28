# Inteligencia del proyecto — Hábitos

> Aprendizajes reutilizables y lecciones para futuras tareas.

- En los hábitos por cantidad cada registro es un evento único con timestamp; al sumar puntos, contar rachas o calcular consistencia es necesario usar `eventId` en lugar de `momentId` (que está vacío en ese tipo).
- El modelo debe tolerar datos históricos sin `tipo` y tratarlos como hábitos por momento para no romper usuarios existentes.
- Antes de cambiar el esquema persistido, verificar la integración de Supabase: el tipo TypeScript no refleja por sí solo migraciones de la base.

- `CREATE OR REPLACE FUNCTION` con distinta aridad NO reemplaza: crea una sobrecarga nueva y deja viva la vieja. En PostgREST, llamar sin el parámetro nuevo resuelve a la firma vieja (lectura cruzada entre perfiles). Hay que `DROP FUNCTION` explícito con la firma completa.
- En un modelo multi-perfil por cuenta, todo lo que era "por usuario" debe re-auditarse: RLS, RPCs, colas offline, notificaciones push (endpoint compartido → unique por endpoint+perfil), Edge Functions, scripts conversacionales y el deep link de auto-registro.
- El PIN de perfil guardado en `localStorage` no viaja entre teléfonos: si el requisito es "mismos datos en otro teléfono", el secreto debe vivir en la nube (hash, nunca en claro).
- Para loguear eventos de una entidad que aún no es "la activa" (crear/eliminar perfil), el logger acepta ámbito forzado cuyo sufijo codifica el perfil; el `flush` debe barrer por prefijo, no solo la cola activa.
- En Deno Edge Functions, el borrado de una suscripción push caducada (404/410) debe acotarse por perfil además de por endpoint: un mismo endpoint puede servir a varios perfiles.

- Al añadir una FK a una columna con filas legado, verificar primero NULL vs NOT NULL por tabla: en las NOT NULL un valor centinela (uuid cero) rompe la FK; la salida limpia es un "perfil puente" con ese id que la adopción reclama y borra, más filtro defensivo en la app.
- `crypto.subtle.digest` (SHA-256) está disponible en navegadores/Edge/Deno/Node 19+: un hash con salt por entidad es suficiente para secretos casuales (PIN de 4 dígitos); `verificarPin` debe ser async y la UI que validaba en vivo necesita estado + efecto.
- Estimar cuotas Supabase con datos reales: `pg_database_size` + `pg_stat_user_tables` para DB; el cron por minuto son 43.2k invocaciones/mes (8.6% de las 500k gratuitas). Para esta app (2 usuarios) el free tier sobra por años; el único crecimiento sin cota es la tabla de auditoría.

- Al extraer namespaces con `tsc` compilando listas de archivos sueltas: si todos los inputs están en un mismo directorio la salida es plana; si abarcan varios, tsc refleja la estructura desde la raíz común (`lib/` → `habitos/*.js` + `core/*.js`). Los scripts que hacen `require` del outDir deben contemplar ambos casos.
- La cola offline original tenía una carrera: el flag de flush en curso se tomaba DESPUÉS de `await asegurarSesion()`, así que dos `reenviar()` concurrentes podían duplicar el lote. En la versión genérica el guardia se toma antes de cualquier `await` con `try/finally`.
- `IconCategoria` no pertenece al set genérico de iconos: mapea `Categoria`, que es conocimiento del dominio. La frontera "core no importa del dominio" se verifica con un grep y obliga a estas extracciones a salir a la luz en vez de esconderse.

- Probar RPCs que usan `auth.uid()` sin la app: `POST /v1/projects/<ref>/database/query` con `select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true);` antepuesto en el mismo query (una sola transacción). Los `raise exception 'codigo'` llegan como HTTP 400 con el código en el mensaje: ideal para smoke tests E2E de permisos y casos de error.
- En formularios con panel condicional por estado (p. ej. "crear cuenta" tras `cuenta_no_existe`), el bloque debe renderizarse también durante el estado de carga (`fase === "crear-cuenta" || fase === "creando"`): si no, el panel desaparece a mitad del flujo y además tsc marca como imposible las comparaciones internas por narrowing.

- Tasas VE (verificado 2026-09-28): DolarAPI `GET ve.dolarapi.com/v1/dolares/oficial|paralelo` → usar `promedio` (`compra`/`venta` suelen venir null); `fechaActualizacion` ISO con offset. USDT/VES P2P: `GET criptoya.com/api/binancep2p/usdt/ves/1` → `{ask, bid}` (tasa = promedio); fallback `POST p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search` `{asset:USDT, fiat:VES, tradeType:BUY, rows:5}` → mediana de `data[].adv.price`.
- Patrón "secreto de servidor para el cliente": el browser nunca toca la Edge Function; una route de Next (`/api/tasas`) guarda el secreto en env de servidor (no `NEXT_PUBLIC_`) y hace de proxy. La route auto-refresca si el dato está viejo; si todo falla devuelve lo último guardado con flag de desactualizado y la UI ofrece ingreso manual (fallback en cadena).
- pg_cron horario: `5 * * * *` (minuto 5, evita la congestión de la hora en punto); vault no disponible en el proyecto → el secreto va literal en `cron.job.command` (solo vive en la BD, nunca en git), igual que el job de push.

## Router WhatsApp por módulo (2026-09-28)
- Un solo punto de entrada (`whatsapp-router.mjs`) que detecta módulo por prefijo y delega por subproceso aislado: cada módulo puede fallar o no existir sin tumbar a los demás; el JSON de cada script gana `modulo` por fusión, sin tocar los scripts. Los módulos futuros (Finanzas, Mercado) se enchufan añadiendo un prefijo + un script.
- Lección: al reestructurar namespaces, los scripts fuera del build principal (WhatsApp, coach) que compilaban `lib/*` por su cuenta se rompen en silencio (el registrador falló con ENOENT). La compilación debe vivir en UN solo lugar (`whatsapp-comun.mjs::cargarLib()`).

## 2026-09-28 — Finanzas: patrón RPC con alcance de hogar (reutilizable)

- Los RPC conversacionales (header `x-*-rpc-secret`, sin JWT) NO pueden usar `auth.uid()` ni funciones que dependan de él (`es_miembro_de_hogar()`). Para alcance de hogar en ese contexto, consultar `hogar_miembros` directamente con el `p_user_id` que trae el RPC; las funciones son SECURITY DEFINER así que el RLS no las frena.
- Patrón de alcance: `c.user_id = p_user_id OR (c.hogar_id IS NOT NULL AND EXISTS (SELECT 1 FROM hogar_miembros WHERE hogar_id = c.hogar_id AND user_id = p_user_id))`.
- PostgREST no embebe vistas sin FK (`fin_saldos!inner` falla): para vista+tabla, dos consultas unidas en código. Los nombres de FK autogeneradas (`tabla_columna_fkey`) sí sirven para embeds con `!`.
- Transferencia = una sola fila (origen + destino + `monto_destino` autoconvertido con los snapshots del momento); el patrimonio en USD usa snapshots históricos, nunca se recalcula retroactivo.

## 2026-09-28 — Lecciones de la auditoría de Mercado
- **Nunca documentar una migración como aplicada desde un resumen.** Una entrada de bitácora afirmó que la 0023 existía y estaba verificada; la auditoría directa (archivo local + `information_schema`/`pg_proc` remoto) mostró que no existía. Regla: antes de escribir "aplicada", comprobar (1) el archivo en `supabase/migrations/` y (2) la firma real de la función en la BD.
- **`fin_tasa_usd_para` = USD-por-unidad de moneda** (para VES: `1/paralelo`). Finanzas hace `monto * tasa` y está correcta. Quien la lea para convertir al revés (precio_local / tasa) invierte la conversión. No "corregir" la función global: corregir los call sites.
- **CREATE OR REPLACE con firma distinta crea una sobrecarga**, no reemplaza. PostgREST devuelve PGRST203 (ambigüedad) si quedan dos firmas. Añadir `DROP FUNCTION` explícito de la firma vieja en la migración.
- **PostgreSQL no admite `unique (user_id, lower(nombre))`** en la definición de tabla; usar índice de expresión `create unique index ... on t (user_id, lower(nombre))`.
- **`returning *, (xmax = 0) into v_prod, v_nuevo` no compila** ("record variable cannot be part of multiple-item INTO list"). Para detectar insert-vs-update, hacer select-then-insert/update separados.

## 2026-09-28 — Supabase JS: `.neq()` no matchea NULL
En la Edge Function de push, `.neq("ultimo_aviso", hoy)` nunca actualizaba filas con `ultimo_aviso` NULL porque en SQL `NULL != valor` es NULL (no TRUE). La primera notificación de cada recordatorio nunca se marcaba como enviada. Fix: `.or("ultimo_aviso.neq.HOY,ultimo_aviso.is.null")`. Regla: toda condición de "distinto de" sobre una columna anulable necesita la rama `.is.null` explícita.

## 2026-09-28 — El cierre de mes se calcula en el cliente, no en un RPC
`rpc_fin_cierre_mes` existe en la migración 0024 como opción server-side, pero `lib/finanzas/control.ts` calcula el cierre en el cliente desde `fin_movimientos` (saldos calculados, no almacenados — decisión de la suite). No hay duplicación de lógica: el RPC quedó como respaldo; la UI usa el cálculo local.

## 2026-09-28 — Pagos/abonos/aportes de Control van por RPC con clave estable
El primer borrador del cliente hacía movimiento + update como pasos sueltos (no atómico, clave aleatoria). La versión final llama a los RPC transaccionales (`rpc_fin_recordatorio_pagar`, `rpc_fin_deuda_abonar`, `rpc_fin_meta_aportar`) con `clave_evento` determinista: reintentar no duplica el movimiento ni el abonado. Patrón a repetir en todo módulo nuevo con efectos financieros.

## 2026-09-28 — Lecciones de Fase 4 (coach)

- **Los CTEs no sobreviven entre sentencias.** El primer borrador de `rpc_coach_briefing` definía CTEs (`top_cats`, `pres_alerta`) en el SELECT que armaba `v_out` y los referenciaba en un SELECT posterior que armaba las correlaciones → "relation does not exist". Fix: las reglas leen de `v_out` con `jsonb_to_recordset`.
- **No asumir nombres de columnas/estados de los RPC internos.** El borrador usó `limite_usd` (real: `monto_limite`), `proximo` en `fin_recordatorios` (real: se calcula con `fin_proximo_vencimiento`), y estados `aviso`/`limite` (reales: `alerta`/`excedido`). Todo se detectó en el E2E real, no en revisión.
- **UTC vs America/Caracas en datos de prueba.** El servidor corre en UTC; los RPC usan fecha Caracas. Datos E2E con `current_date` caían un día desplazados. Regla: en E2E usar fechas explícitas Caracas.
- **Doble autenticación para RPC que usan scripts Y navegador.** `rpc_coach_llamada_ok(p_user_id)`: secreto de integración O `auth.uid() = p_user_id`. Los RPC internos con secreto quedaron intactos; el coach agrega sus propias agregaciones en vez de llamarlos (menos superficie, mismo alcance).
- **PostgREST PGRST301 "Expected 3 parts in JWT"** en la Edge Function: el `fetch` manual con `apikey`/`Authorization` armados a mano falló; el cliente supabase-js con `global: { headers: { "x-...-secret": ... } }` maneja las claves correctamente. Regla: en Edge Functions, headers custom vía `global.headers` del cliente, nunca fetch manual.
- **Dedupe de alertas por (usuario, correlación, ventana).** La primera invocación envía, la segunda no. Tabla `coach_alertas_enviadas`, tag push `coach-<id>-<ventana>`.

## 2026-09-27 — RPCs del navegador: auth dual, nunca secreto público

Los RPC que llama la web deben aceptar el JWT del navegador (`auth.uid() = p_user_id`) ADEMÁS del secreto de integración (patrón `rpc_*_llamada_ok`, ver 0026 coach y 0028 mercado). Exigir el secreto en el cliente (`NEXT_PUBLIC_*`) lo expone en el bundle y, si no se configura, rompe el módulo en producción silenciosamente — pasó con Mercado (Fase 2): el E2E por scripts dio 18/18 pero la web nunca funcionó. Lección: el E2E de un módulo debe incluir al menos una llamada con JWT real de navegador, no solo la vía secreto.

## 2026-09-28 — Lecciones de Fase 6 (Cartera por WhatsApp)

- **El router que recorta el prefijo necesita devolver la palabra clave.** Al quitar "productos"/"clientes"/"cartera", el script ya no sabe si `""` es "listar todo" o "resumen", ni si `"queso"` filtra productos o clientes. Fix: el router pasa `--kw` con la palabra recortada; el script decide por kw, no por regex sobre el texto.
- **Orden de bloques = orden de especificidad.** `cartera cargo Ana 100` caía en el bloque `cartera` (filtro de cliente) antes de llegar a `cargo`. Regla: los bloques genéricos (listar/detalle por kw) llevan guarda que excluye palabras de comando, o los comandos específicos van primero.
- **El nombre del cliente es el prefijo más largo que identifique a uno solo.** `cargo Ana 100 venta de queso` con cliente "Ana Pérez": buscar contra el texto completo falla por el concepto incluido. Fix: probar prefijos de n palabras de largo a corto; el primero con exactamente 1 match gana, el resto es concepto.
- **Los regex de monto necesitan fronteras de letra.** `extraerMonto` tomaba el "2" de "E2E" como monto. Fix: `(?<![\p{L}\d])...(?![\p{L}])`. Lo mismo para la limpieza de concepto: solo borrar números standalone (`\b\d...\b`), no dígitos dentro de palabras.
- **El concepto conserva stopwords, el nombre no.** "venta de queso" como concepto debe quedar intacto; para extraer el nombre sí se quitan ("de", "la"...). Dos limpiadores distintos: `limpiarResto` (nombres) y `limpiarConcepto` (concepto).
- **Continuación sin prefijo es responsabilidad del router, no del agente del chat.** Tras un `resumen`, el "sí" llega sin prefijo e iría a hábitos. Fix: el router lee los borradores pendientes (`recibo-borrador.json`, `cartera-borrador.json`) y enruta: fase `resumen` → solo palabras de cierre; fase `completar` (el módulo pidió un dato) → cualquier texto es la respuesta. Si hay borradores en ambos módulos, gana el más reciente.
- **`auth.uid()` es NULL en RPC por secreto: la membresía de hogar se valida con `p_user_id` directo** contra `hogar_miembros` (patrón de Mercado 0022). Aceptar `p_hogar_id` sin validarlo permite adjuntar filas a cualquier hogar: fail-closed con `hogar_no_valido`.

## Extraer logo de un PDF de referencia (2026-09-28)
- `pdfimages -png archivo.pdf prefijo` extrae las imágenes embebidas (logos, firmas) tal cual están en el PDF. Si salen con fondo negro y el arte es claro, convertir negro→transparente con PIL (`numpy`: alfa=0 donde luminancia<24) y recortar con `getbbox()`. Verificar con `np.unique(alpha)`. Sirve para rescatar la marca oficial cuando el cliente la tiene solo dentro de un PDF.
