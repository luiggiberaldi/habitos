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
