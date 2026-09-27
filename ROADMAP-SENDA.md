# Senda — Roadmap

**Suite personal y del hogar.** Una sola PWA, varios módulos, un agente con control total, todo usable manualmente.
Estado: brainstorm cerrado el 2026-09-27. Nada de esto está construido todavía.

Marca: `public/senda/logo.png` (wordmark) y `public/senda/icono.png` (icono app).
Colores: petróleo `#0C3544` (primario), menta `#4CBF9A` (acento).

---

## 1. Decisiones tomadas (2026-09-27)

- La suite se llama **Senda**. El repo actual (`habitos`) se renombra en Fase 0.
- **Una sola PWA**, módulos adentro (Hábitos, Finanzas, Mercado…). Nada de apps separadas.
- **Finanzas compartidas**: entidad `hogar`; luigi crea el hogar e invita a su novia. Los hábitos siguen por usuario.
- **Gamificación SOLO en Hábitos** (decisión 2026-09-27, por ahora). Finanzas y Mercado
  sin juego: tono serio, sin XP por acciones financieras. El dinero es compartido.
- **Tasas**: BCV + paralelo + USDT. Fuente: DolarAPI vía proxy servidor (patrón PreciosAlDía) + Binance P2P para USDT. Historial con tasa de la fecha, refresco al abrir + job horario, fallback a última guardada → manual.
- **Factura por WhatsApp**: SIEMPRE resumen antes de ejecutar; luigi confirma. Nunca registro directo.
- **Productos**: un solo esquema de creación (factura o manual). Obligatorios: nombre, unidad (kg/g/L/ml/und), categoría, cantidad. Opcional: precio de referencia.
- **Precios**: historial por producto en Bs y $ (conversión con tasa histórica). Con consumo real se calcula cantidad sugerida de compra y presupuesto mensual de mercado. Primeros 30–60 días = calibración.
- **"Cuánto comprar" es sugerencia**, nunca orden.
- Todo lo aprobado en el brainstorm se construye ("añade todo").

## 2. Arquitectura

```
senda/
  app/(suite)/            → hub + rutas por módulo
    habitos/              → módulo actual (se modulariza, no se reescribe)
    finanzas/
    mercado/
  modules/
    habitos/ finanzas/ mercado/   → lógica de dominio por módulo
  lib/core/               → identidad, sync (LWW+tombstones+cola offline),
                            recordatorios, tasas, juego, UI kit, logger
  supabase/functions/     → push-notifications (genérica), crear-usuario…
  scripts/                → <modulo>-*.mjs para control del agente vía WhatsApp/CLI
```

- Mismo proyecto Supabase. Tablas por módulo con prefijo (`fin_*`, `mer_*`).
- Cada módulo: **UI manual completa + CLI/RPC para el agente** (el contrato que ya funciona con hábitos).
- Reglas permanentes: bitácora por cambio (`bitacora.md`), aprendizajes a `inteligencia.md`, 3 reglas de UI (todo redondeado, iconos SVG propios, sin alert/confirm/prompt).

## 3. Fases

### Fase 0 — Fundación Senda
Objetivo: el núcleo compartido sobre el que se montan los módulos.
- Renombrar repo `habitos` → `senda` (con cuidado: hay rutas absolutas en scripts, crons y memoria que apuntan a `~/workspace/habitos`).
- Extraer `lib/core/` desde lo que ya existe (sync, AuthGate sin modos, UI kit, logger, juego).
- `hogares` + `hogar_miembros` + flujo de invitación (el admin crea el hogar, invita por correo).
- **Motor de recordatorios genérico**: generalizar la Edge Function a una tabla `recordatorios` (hoy hardcodea hábitos).
- **Servicio de tasas**: `fin_tasas` (fecha, bcv, paralelo, usdt, fuente), proxy servidor, job horario, fallback en cadena.
- Router de intents de WhatsApp por módulo (`finanzas …`, `mercado …`).
- Branding Senda (tokens `#0C3544`/`#4CBF9A`, PWA icons desde `public/senda/`).
- Salida: app abre como Senda, hogar creado, tasas visibles, recordatorio genérico enviando push.
  Verificación: `tsc`+build limpios; push de prueba recibido en el teléfono de luigi;
  tasa del día visible y con fecha/fuente; `docs/REGLAS.md` como checklist canónico.

### Fase 1 — Finanzas: el libro
Objetivo: el registro contable del hogar, usable en el día a día.
- **Cuentas**: Bs, $, crypto (USDT/BTC), efectivo, Zelle, Binance… Cada una con moneda y tipo. Saldo **calculado** (inicial + movimientos); ajustes por conciliación.
- **Movimientos**: ingreso / egreso / **transferencia** (cambiar de cuenta no es gastar) / ajuste. Categorías propias + fijas.
- Conversión automática a USD (moneda base) con tasa histórica según fecha del movimiento.
- **Dashboard del hogar**: patrimonio total en $, resultado del mes, gasto por categoría.
- WhatsApp: "gasté 20 en taxi", "cuánto llevo gastado este mes".
- Salida: dos personas registrando en cuentas reales durante 1 semana sin descuadres.
  Verificación: suma de movimientos por cuenta == saldo mostrado en cada cuenta;
  un egreso en Bs convertido con la tasa de su fecha (no la actual); transferencia
  entre cuentas no aparece como gasto en el reporte.

### Fase 2 — Mercado
Objetivo: saber qué hay, qué se acaba y cuándo comprar.
- **Productos**: nombre, unidad, categoría, cantidad (obligatorios); precio de referencia (opcional).
- **Lotes y consumos**: comprar (+cantidad, precio, comercio, cuenta opcional), gastar (−), se acabó (=0), se dañó (no contamina la tasa). Stock = compras − consumos.
- Tasa de consumo real → fecha estimada de agotamiento → **lista de compras colaborativa** precargada.
- **Historial de precios** por producto en Bs y $ (mín/máx/promedio, variación %).
- **Comparador por comercio** ("el arroz más barato en X").
- Cantidad sugerida de compra + **presupuesto mensual de mercado** (= Σ consumo_mensual × precio actual; alimenta el presupuesto de finanzas).
- **Factura por WhatsApp**: foto → resumen (artículos, cantidades, precios, match con productos, cuenta del egreso) → confirmación de luigi → registro en inventario + egreso.
- Salida: una compra semanal completa procesada por WhatsApp de punta a punta.
  Verificación: foto de factura real → resumen presentado → "sí" de luigi →
  stock actualizado, egreso creado y linkeado; un producto nuevo creado con los 4
  obligatorios; historial de precios del producto con variación Bs y $.

### Fase 3 — Control
Objetivo: que el dinero se maneje solo por defecto.
- **Recordatorios de pago recurrentes** ("internet todos los 27"): aviso N días antes + el día; al pagar genera el egreso y reprograma; insiste si vence (último día del mes si el día no existe).
- **Presupuestos por categoría** con alertas 80%/100% (el de mercado se prellena con el cálculo de Fase 2).
- **Movimientos recurrentes** (sueldo, alquiler).
- **Deudas por cobrar/pagar** con recordatorios; al saldar genera el movimiento.
- **Metas de ahorro compartidas** con progreso visible para los dos (sin XP: finanzas sin gamificación).
- **Cierre de mes**: resumen, comparativa, archivo, reinicio de presupuestos. Coach mensual automático.
- Salida: un mes cerrado con presupuestos, recordatorios y deudas sin intervención manual salvo confirmar.
  Verificación: recordatorio del 27 disparó push a tiempo; al marcar "pagado" se creó
  el egreso y se reprogramó al mes siguiente; alerta al llegar al 80% del presupuesto;
  deuda saldada generó su movimiento; `tsc`+build limpios.

### Fase 4 — Inteligencia cruzada
Objetivo: la suite como un solo sistema, no módulos pegados.
- Coach correlacionado ("subió tu gasto en delivery y cayó tu hábito de cocinar").
- Consultas WhatsApp globales ("¿cuánto debo en total?", "¿qué me falta comprar?").
- Alertas inteligentes (paralelo se movió X%, producto subió Y%).
- Salida: 3 correlaciones útiles generadas sin que luigi las pida.
  Verificación: cada correlación cita datos reales (montos, fechas); ninguna se envió
  sin que el contenido fuera verificable en la app.

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

Notas: `creado_por` siempre (dos personas). La gamificación vive solo en Hábitos;
en Finanzas y Mercado no hay XP ni logros. Saldos y stock se **calculan**, no se almacenan (anti-descuadre).

## 5. Lo que NO se hace (por ahora)

Inversiones/bolsa · sincronización bancaria automática (sin API en VE) · múltiples hogares por usuario ·
OCR total sin confirmación · vencimientos de productos (aparcado, no descartado).

## 6. Preguntas abiertas

- ¿El repo de GitHub se renombra a `senda`? (rompe URLs; decidir en Fase 0)
- Dominio/URL de producción para la suite (¿nuevo deploy o se mantiene habitos-amber?).
- ¿La novia entra desde Fase 0 (hogar) o cuando Finanzas esté usable?
