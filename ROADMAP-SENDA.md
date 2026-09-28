# Senda — Roadmap

**Suite personal y del hogar.** Una sola PWA, varios módulos, un agente con control total, todo usable manualmente.
Estado: brainstorm cerrado el 2026-09-27 · reformulado el 2026-09-27 con decisiones de método. Nada construido todavía.

Marca: `public/senda/logo.png` (wordmark) y `public/senda/icono.png` (icono app).
Colores: petróleo `#0C3544` (primario), menta `#4CBF9A` (acento).

---

## 1. Decisiones tomadas (2026-09-27)

- La suite se llama **Senda**. Repo de GitHub se renombra a `senda` en Fase 0; el directorio
  local `~/workspace/habitos` **no** se mueve (rutas absolutas en crons, scripts, skills y memoria).
- **Una sola PWA**, módulos adentro. Nada de apps separadas.
- **Método: evolución, no rewrite.** El repo ya tiene el 70% del núcleo probado en producción;
  se construye alrededor. Orden: shell+rebrand primero (riesgo bajo), extracción del núcleo
  después (mecánica y verificable).
- **Hábitos queda intacto**: cero cambios visibles — mismas pantallas, mismos flujos.
  La suite lo envuelve (hub + tabs); si algo se ve distinto, es un bug.
- **Finanzas compartidas**: entidad `hogar`; luigi crea el hogar e invita a su novia. Los hábitos siguen por usuario.
- **Gamificación SOLO en Hábitos** (por ahora). Finanzas y Mercado sin juego: tono serio,
  sin XP por acciones financieras. El dinero es compartido.
- **Tasas**: BCV + paralelo + USDT. Fuente: DolarAPI vía proxy servidor (patrón PreciosAlDía) + Binance P2P para USDT. Historial con tasa de la fecha, refresco al abrir + job horario, fallback a última guardada → manual.
- **Factura por WhatsApp**: SIEMPRE resumen antes de ejecutar; luigi confirma. Nunca registro directo.
- **Productos**: un solo esquema de creación (factura o manual). Obligatorios: nombre, unidad (kg/g/L/ml/und), categoría, cantidad. Opcional: precio de referencia.
- **Precios**: historial por producto en Bs y $ (conversión con tasa histórica). Con consumo real se calcula cantidad sugerida de compra y presupuesto mensual de mercado. Primeros 30–60 días = calibración.
- **"Cuánto comprar" es sugerencia**, nunca orden.
- Deploy: se sigue usando el mismo proyecto de Vercel durante la construcción; la URL pública final se decide al lanzar.
- Todo lo aprobado en el brainstorm se construye ("añade todo").

## 2. Arquitectura

```
senda/  (repo; directorio local conserva el nombre habitos por ahora)
  app/
    page.tsx              → hub "Hoy en Senda" (Inicio)
    habitos/              → módulo actual, TAL CUAL (cero cambios visibles)
    finanzas/             → Fase 1
    mercado/              → Fase 2
  modules/
    habitos/ finanzas/ mercado/   → lógica de dominio por módulo
  lib/core/               → identidad, sync (LWW+tombstones+cola offline),
                            recordatorios, tasas, juego, UI kit, logger
  supabase/functions/     → push-notifications (genérica), crear-usuario…
  scripts/                → <modulo>-*.mjs para control del agente vía WhatsApp/CLI
```

- Mismo proyecto Supabase. Tablas por módulo con prefijo (`fin_*`, `mer_*`).
- Cada módulo: **UI manual completa + CLI/RPC para el agente** (el contrato que ya funciona con hábitos).
- Navegación: hub como Inicio + barra inferior (Inicio · Hábitos · Finanzas · Mercado).
  Tocar una tarjeta del hub entra al módulo en pantalla completa; atrás vuelve al hub.
- Reglas permanentes: `docs/REGLAS.md` (canónico), bitácora por cambio, aprendizajes a `inteligencia.md`,
  3 reglas de UI (todo redondeado, iconos SVG propios, sin alert/confirm/prompt).

## 3. Fases

### Fase 0 — Fundación Senda
Objetivo: el núcleo compartido sobre el que se montan los módulos. Hábitos no cambia visualmente.

1. **Rebrand + shell** (riesgo bajo): nombre Senda, iconos PWA desde `public/senda/`,
   tokens `#0C3544`/`#4CBF9A`, hub "Hoy en Senda" + barra inferior. Rename del repo en GitHub.
2. **Extracción de `lib/core/`** (mecánica): sync, AuthGate, UI kit, logger, juego → núcleo
   compartido. Sin cambios de comportamiento; se verifica con smokes y en el teléfono de luigi.
   ✅ Completada 2026-09-28 (commit `c9a4b86`, desplegado a producción).
3. **Hogar**: `hogares` + `hogar_miembros` + invitación por correo (el admin invita; si la cuenta existe, entra directo).
   ✅ Completada 2026-09-28: migración `0016_hogar.sql` (tablas + 6 RPC SECURITY DEFINER +
   RLS anti-recursión patrón 0011), `lib/core/hogar.ts`, sección "Hogar" en Ajustes
   (`components/GestionHogar.tsx`): crear hogar, renombrar, invitar por correo (si no hay
   cuenta la crea vía crear-usuario y reintenta), expulsar/salir con confirmación en dos
   toques. Smoke E2E: 15 checks OK contra la nube.
4. **Servicio de tasas**: `fin_tasas` (fecha, bcv, paralelo, usdt, fuente), proxy servidor (`GET/POST /api/tasas` + Edge Function `actualizar-tasas`), job horario pg_cron (`actualizar-tasas-horario`, `5 * * * *`), fallback en cadena (fresca → última guardada desactualizada → manual). Tarjeta "Tasas del día" en el hub con fecha y fuente.
5. **Motor de recordatorios genérico**: tabla `recordatorios` (modulo, titulo, cuerpo, programado_para, regla_recurrencia, datos_json, estado); la Edge Function push-notifications v11 lee los vencidos cada minuto (la lógica de hábitos quedó intacta como adaptador); reprograma diaria/semanal/mensual; UI en Ajustes para crear/cancelar. E2E: push de prueba llegó (enviado a los 37s).
6. **Router de WhatsApp por módulo**: `scripts/whatsapp-router.mjs` (prefijos `finanzas|fin`, `mercado|merca`; sin prefijo = hábitos con registrar/crear/estado/resumen/racha); stubs `whatsapp-finanzas.mjs` / `whatsapp-mercado.mjs` (`proximamente` hasta Fase 1/2). Fix: `whatsapp-registrar.mjs` roto desde la extracción (rutas `lib/*`) → ahora usa `cargarLib()` del módulo común.

- Salida: la app abre como Senda (hub + tabs), Hábitos se ve idéntico, hogar creado,
  tasa del día visible, recordatorio genérico de prueba llega como push.
- Verificación: `tsc`+build limpios; comparación visual de Hábitos antes/después en el
  teléfono de luigi; push de prueba recibido; tasa con fecha/fuente.

### Fase 1 — Finanzas: el libro
Objetivo: el registro contable del hogar, usable en el día a día. Sin gamificación, tono serio.
- **Cuentas**: Bs, $, crypto (USDT/BTC), efectivo, Zelle, Binance… Cada una con moneda y tipo. Saldo **calculado** (inicial + movimientos); ajustes por conciliación.
- **Movimientos**: ingreso / egreso / **transferencia** (cambiar de cuenta no es gastar) / ajuste. Categorías propias + fijas.
- Conversión automática a USD (moneda base) con tasa histórica según fecha del movimiento.
- **Dashboard del hogar**: patrimonio total en $, resultado del mes, gasto por categoría.
- WhatsApp: "gasté 20 en taxi" (nunca confirmar sin ejecutar), "cuánto llevo gastado este mes".
- Salida: dos personas registrando en cuentas reales durante 1 semana sin descuadres.
- Verificación: suma de movimientos por cuenta == saldo mostrado; egreso en Bs convertido
  con la tasa de su fecha; transferencia no aparece como gasto.

### Fase 2 — Mercado ✅ COMPLETADA 2026-09-28
Objetivo: saber qué hay, qué se acaba y cuándo comprar.
- **Productos**: nombre, unidad, categoría, cantidad (obligatorios); precio de referencia (opcional).
- **Lotes y consumos**: comprar (+cantidad, precio, comercio, cuenta opcional), gastar (−), se acabó (=0), se dañó (no contamina la tasa). Stock = compras − consumos.
- Tasa de consumo real → fecha estimada de agotamiento → **lista de compras colaborativa** precargada.
- **Historial de precios** por producto en Bs y $ (mín/máx/promedio, variación %).
- **Comparador por comercio** ("el arroz más barato en X").
- Cantidad sugerida de compra + **presupuesto mensual de mercado** (= Σ consumo_mensual × precio actual; alimenta el presupuesto de finanzas).
- **Factura por WhatsApp**: foto → resumen → confirmación de luigi → registro en inventario + egreso.
- Hardening 0023: conversión USD-por-unidad corregida en 3 RPCs, egreso convertido a moneda de cuenta, idempotencia por `clave_evento`, stock inicial atómico, historial Bs/$ con `tasa_ves`. Verificado E2E real 18/18.
- Salida: una compra semanal completa procesada por WhatsApp de punta a punta.
- Verificación: stock actualizado, egreso creado y linkeado; producto nuevo con los 4
  obligatorios; historial con variación Bs y $.

### Fase 3 — Control
Objetivo: que el dinero se maneje solo por defecto.
- **Recordatorios de pago recurrentes** ("internet todos los 27"): aviso N días antes + el día; al pagar genera el egreso y reprograma; insiste si vence (último día del mes si el día no existe).
- **Presupuestos por categoría** con alertas 80%/100% (el de mercado se prellena con el cálculo de Fase 2).
- **Movimientos recurrentes** (sueldo, alquiler).
- **Deudas por cobrar/pagar** con recordatorios; al saldar genera el movimiento.
- **Metas de ahorro compartidas** con progreso visible para los dos (sin XP).
- **Cierre de mes**: resumen, comparativa, archivo, reinicio de presupuestos. Coach mensual automático.
- Salida: un mes cerrado con presupuestos, recordatorios y deudas sin intervención manual salvo confirmar.
- Verificación: recordatorio del 27 disparó push a tiempo; "pagado" creó el egreso y
  reprogramó; alerta al 80% del presupuesto; deuda saldada generó su movimiento.

### Fase 4 — Inteligencia cruzada
Objetivo: la suite como un solo sistema, no módulos pegados.
- Coach correlacionado ("subió tu gasto en delivery y cayó tu hábito de cocinar").
- Consultas WhatsApp globales ("¿cuánto debo en total?", "¿qué me falta comprar?").
- Alertas inteligentes (paralelo se movió X%, producto subió Y%).
- Salida: 3 correlaciones útiles generadas sin que luigi las pida.
- Verificación: cada correlación cita datos reales; nada enviado sin ser verificable en la app.

## 4. Modelo de datos (resumen)

```
hogares(id, nombre, creado_por) · hogar_miembros(hogar_id, user_id, rol)

fin_cuentas(id, hogar_id, nombre, tipo, moneda, saldo_inicial, archivada, creado_por)
fin_movimientos(id, hogar_id, cuenta_id, tipo[ingreso|egreso|transferencia|ajuste],
                monto, categoria_id, fecha, nota, cuenta_destino_id, tasa_aplicada, creado_por)
fin_categorias(id, hogar_id, nombre, tipo)
fin_tasas(fecha, bcv, paralelo, usdt, fuente)
fin_recordatorios(id, hogar_id, concepto, monto_est, moneda, regla[dia_mes], cuenta_id,
                  avisar_dias_antes, proximo_vencimiento, activo, creado_por)
fin_deudas(id, hogar_id, contraparte, tipo[cobrar|pagar], monto, moneda, vence, saldada, creado_por)
fin_metas(id, hogar_id, nombre, objetivo, moneda, creada_por)
fin_presupuestos(id, hogar_id, categoria_id, mes, monto, moneda)

mer_productos(id, hogar_id, nombre, unidad, categoria, precio_ref, creado_por)
mer_lotes(id, producto_id, cantidad, unidad, fecha_compra, precio_total, moneda,
          comercio, cuenta_id?, movimiento_id?, estado, creado_por)
mer_consumos(id, producto_id, lote_id?, cantidad, fecha, motivo[consumo|descarte], creado_por)

recordatorios(id, hogar_id, modulo, titulo, cuerpo, programado_para, regla_recurrencia?,
              datos_json, estado, creado_por)   ← motor genérico (Fase 0)
```

Notas: `creado_por` siempre (dos personas). Gamificación solo en Hábitos.
Saldos y stock se **calculan**, no se almacenan (anti-descuadre).

## 5. Lo que NO se hace (por ahora)

Inversiones/bolsa · sincronización bancaria automática (sin API en VE) · múltiples hogares por usuario ·
OCR/factura sin confirmación · vencimientos de productos (aparcado, no descartado).

## 6. Preguntas abiertas

- URL pública final de la suite (se decide al lanzar; durante la construcción se usa el proyecto actual).
- ¿La novia entra desde Fase 0 (hogar) o cuando Finanzas esté usable?
