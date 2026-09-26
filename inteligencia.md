# Inteligencia del proyecto — Hábitos

> Aprendizajes reutilizables y lecciones para futuras tareas.

- En los hábitos por cantidad cada registro es un evento único con timestamp; al sumar puntos, contar rachas o calcular consistencia es necesario usar `eventId` en lugar de `momentId` (que está vacío en ese tipo).
- El modelo debe tolerar datos históricos sin `tipo` y tratarlos como hábitos por momento para no romper usuarios existentes.
- Antes de cambiar el esquema persistido, verificar la integración de Supabase: el tipo TypeScript no refleja por sí solo migraciones de la base.
