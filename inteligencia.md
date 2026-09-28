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
