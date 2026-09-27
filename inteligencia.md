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
