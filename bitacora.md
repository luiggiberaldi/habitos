# Bitácora del proyecto — Hábitos

> Cronología verificable de cambios relevantes. Añadir entradas al avanzar; respetar las que existan.

## 2026-09-27
- Perfiles locales tipo Netflix (máx 6, modo en el dispositivo): CRUD, selector con giro 3D, PIN opcional de 4 dígitos, avatares elegibles estilo videojuego (10), foto personalizada como avatar (recorte 256px), onboarding guiado de 3 pasos.
- Seguridad del PIN: pedirlo para entrar, eliminar, cambiarlo y quitarlo; ojito para mostrar/ocultar en todos los campos de clave; placeholders con etiqueta visible + ••••.
- Hábito Sueño: tarjeta con "Me acosté"/"Me levanté", hora actual sugerida, TimeField propio (reemplaza el input nativo), avance al siguiente ciclo cuando la noche completó, contadores excluidos igual que la lista.
- Reclamo de logros por tap: el XP se libera al pulsar (badge "Sin abrir", celebración con "Ir a reclamar").
- Rebalanceo de economía: pool de logros 5620→2225 XP, XP por registro escalado por nivel (10–18), cofre escalado (15–160), niveles irreversibles (`nivelMaximo`), reclamo sin XP semanal, anti-farmeo en deshacer.
- Auditoría día completo: el sueño participa con semántica de noche (acostar N + levantar N+1 atribuido al día del despertar); puntos mostrados con nivel efectivo; desafío semanal 25–65 XP según meta; cantidad idempotente por `eventId`; deshacer revierte días completos; backfill en dos pasadas.
- Wizard de 3 pasos para crear/editar hábitos; "Tu espacio" en Ajustes aclara dispositivo vs nube; foco de inputs con una sola línea ancha.
- Puente WhatsApp Nivel 2 + asistente conversacional (`estado`, `resumen`, `racha`, `crear`) y coach semanal; actualización instantánea de la PWA.
- Regla permanente: programando, todo lo que se haga debe documentarse en el repo — ningún commit sin su entrada en `bitacora.md`; quedó como regla obligatoria en `agent.md`.

## 2026-09-26
- Añadido soporte de hábitos por cantidad en la aplicación, con su contador diario, registro de eventos, deshacer y estadísticas.
- Ajustado el modelo, el estado y las vistas para distinguir hábitos por momento de hábitos por cantidad.
- Creado `memoria.md` y archivos de contexto Vibe System para documentar el proyecto.
