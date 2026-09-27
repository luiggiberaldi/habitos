# Instrucciones de agente — Hábitos

> Guía de trabajo para agentes que aportan al proyecto. Leer antes de modificar.

- Consultar `memoria.md` para el contexto del proyecto y, si es pertinente, `bitacora.md` e `inteligencia.md`.
- Seguir las reglas específicas de Next.js de `AGENTS.md` y consultar la documentación incluida en `node_modules/next/dist/docs/` antes de cambiar APIs o convenios.
- Respetar el modelo distinguido por tiempo y cantidad: no colapsar registros ni romper la idempotencia.
- Actualizar `bitacora.md` e `inteligencia.md` cuando un cambio o aprendizaje sea relevante; mantener la entrada breve y verificable.
- Regla obligatoria: todo lo que se programe debe quedar documentado en el repo. Ningún commit sin su entrada en `bitacora.md` (qué cambió y por qué, en 1–3 líneas). Los aprendizajes reutilizables van a `inteligencia.md`.
- Ejecutar typecheck (`npx tsc --noEmit`) y lint/build antes de finalizar cambios que no sean triviales.
