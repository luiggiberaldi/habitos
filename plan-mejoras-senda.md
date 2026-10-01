# Plan de mejoras Senda — Finanzas/Control (2026-10-01)

Pedido de luigi: resumen de su economía desde los logs + qué mejorar de Senda.
Se acordaron 7 mejoras. Este archivo es el plan; la bitácora lleva el detalle de lo ejecutado.

## Hallazgos de la auditoría (reutilizar, no reinventar)

- `0024_control.sql` YA trae: `fin_recordatorios` (+ upsert/listar/pagar/toggle),
  `fin_presupuestos` (+ upsert/listar/copiar), `fin_deudas` (tipos `por_cobrar`/`por_pagar`,
  + upsert/listar/abonar donde abonar por_cobrar genera el ingreso), `fin_metas`.
- `whatsapp-control.mjs` solo expone: pagar recordatorio, estado, deudas (lectura),
  presupuestos (lectura). **Falta el alta por WhatsApp** de todo lo anterior.
- `whatsapp-finanzas.mjs`: `detectarCategoria` solo matchea la palabra literal
  ("mercado", "comida"...); la regla de comisión pago móvil 0,33% se aplicó a mano,
  no existe en código. El registro es directo, sin resumen/confirmación.
- Migraciones se aplican vía Management API (`mgmt.py`).

## Mejoras

### 1. Categorías sugeridas por palabra clave (WhatsApp Finanzas)
Mapa nota → categoría: mercado (queso, huevo, verduras, mayonesa, atún, pasta,
aceite, arroz, harina, pan, leche, café, azúcar, carne, pollo, mantequilla, toddy,
botellón, bodega…), servicios (comisión, mantenimiento, banca móvil, internet,
luz, agua, teléfono, condominio), transporte (ridery, taxi, pasaje, gasolina),
salud (farmacia, médico), vivienda (alquiler). La mención explícita mantiene
prioridad; el mapa es fallback. Criterio de aceptación: "gasté 2400 en queso"
→ categoría mercado sin decirla.

### 2. Cuentas por cobrar nativas (Control)
Intents nuevos en `whatsapp-control.mjs`:
- `control me debe Ezequiel 4300` / `control le presté 4300 a Ezequiel` → `rpc_fin_deuda_upsert` (por_cobrar, VES).
- `control me pagó Ezequiel 1000` → busca por_cobrar de la contraparte → `rpc_fin_deuda_abonar` (genera el ingreso).
- `control deudas` muestra por_cobrar y por_pagar etiquetadas.
Dato: migrar el préstamo real de Bs 4.300 a Ezequiel (28/09) como por_cobrar con
fecha límite 2026-10-04 (requiere sí de luigi: es escritura sobre datos reales).

### 3. Conciliación bancaria por WhatsApp (Finanzas)
- `finanzas conciliar bdv` → muestra saldo en libros y pide el del banco.
- `finanzas conciliar bdv 764.86` → calcula diferencia; si ~0 dice "conciliado",
  si no propone el ajuste exacto.
- `finanzas conciliar bdv 764.86 ajustar` → registra el ajuste (ingreso/egreso
  "ajuste conciliación"). La palabra `ajustar` es la confirmación explícita.
Sin estado entre mensajes: el monto viaja en el propio texto.

### 4. Alerta de saldo bajo
Migración `0039`: `fin_cuentas.umbral_bajo numeric(18,2)` + `rpc_fin_cuenta_umbral`
+ `rpc_fin_alertas_saldo`. WhatsApp: `finanzas alerta bdv 2000` / `finanzas alerta bdv off`.
`finanzas saldo` y `control estado` marcan ⚠️ las cuentas bajo el umbral.
Dato: umbral inicial de BDV a definir con luigi.

### 5. Recordatorio recurrente de internet (día 27)
Intent en Control: `control recuerda internet 30 cada 27` → `rpc_fin_recordatorio_upsert`
(egreso, USD, día 27, aviso 3 días). `control no recordar internet` lo desactiva.
Dato: crear el recordatorio real requiere el monto que paga luigi (preguntar).

### 6. Comisiones bancarias automáticas
En el flujo de registro de `whatsapp-finanzas.mjs`:
- Si el texto menciona pago móvil y es egreso: tras registrar, calcula
  `round(monto × 0,0033, 2)` y registra el egreso "comisión pago móvil (0,33%)"
  en la misma cuenta, categoría servicios. El mensaje de confirmación muestra ambos.
- "comisión…" en la nota → categoría servicios (vía mapa de la mejora 1).

### 7. Presupuesto de mercado con aviso
- `control presupuesto mercado 200` → `rpc_fin_presupuesto_upsert` (USD por defecto,
  acepta "bs"). `control presupuestos` y `control estado` ya muestran % usado.
- Al registrar un egreso con categoría bajo presupuesto: si el % usado ≥ 80,
  la confirmación añade "⚠️ Presupuesto mercado: 85% usado ($X de $Y)".
Dato: monto del presupuesto semanal/mensual a definir con luigi.

## Orden de implementación
Migración 0039 → scripts (finanzas: 1, 3, 6, 7-aviso, 4; control: 2, 5, 7-alta)
→ verificación con mocks + RPC reales de lectura → bitácora → commit → push →
deploy → respaldo Drive.

## Datos que necesitan el "sí" de luigi (no se tocan sin confirmación)
- [x] Migrar préstamo Ezequiel Bs 4.300 a por_cobrar (vence 04/10) → **migrado 2026-10-01** (id 51be759e…, fecha límite 2026-10-04, cuenta BDV).
- [x] Monto del internet para el recordatorio del día 27 → **$15 a tasa BCV = Bs 12.902,70** (BCV 860,18 del 01/10). Recordatorio creado: día 27, cuenta BDV, categoría servicios. OJO: al pagarlo se registra el monto del recordatorio; si la BCV se movió, la diferencia se absorbe en la conciliación.
- [ ] Monto del presupuesto de mercado → **se deduce con el tiempo**. Línea base 2026-10-01: $10,65 (3 egresos desde el 27/09; solo cuentan los etiquetados 'mercado' — la categorización automática es nueva de hoy).
- [x] Umbral de alerta para BDV → **luigi lo cambió: umbral en Binance, 10 USDT** (fijado 2026-10-01).
