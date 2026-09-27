# Reglas de Senda — checklist canónico

> Fuente única de verdad para las reglas del proyecto. `agent.md`, la memoria del
> asistente y demás docs las referencian; si hay conflicto, **este archivo manda**.
> Incumplir una regla es un bug, no un estilo.

## 1. Documentación (obligatoria)

- **Ningún commit sin entrada en `bitacora.md`.** Cada entrada lleva, en 1–3 líneas:
  1. **qué** cambió, 2. **por qué**, 3. **cómo se verificó**.
- Lo no verificado se marca como no verificado. Nada de "listo" sin haberlo ejecutado.
- Aprendizajes reutilizables van a `inteligencia.md` (etiquetar por módulo cuando aplique).
- Decisiones de dominio de cada módulo viven en su `modules/<modulo>/README.md`;
  la bitácora cuenta *qué pasó*, el README cuenta *por qué el dominio es así*.
- Prefijos de commit por módulo: `senda:` `nucleo:` `finanzas:` `mercado:` `habitos:`.

## 2. UI (obligatorias — ver `docs/reglas-ui.md`)

1. **Todo redondeado.** `rounded-none` / `border-radius: 0` prohibidos.
2. **Solo iconos SVG propios** (`lib/icons.tsx`). Cero emojis como iconos, ni en pushes.
3. **Nada de `alert()` / `confirm()` / `prompt()`** del navegador. Componentes propios, en español.

Verificación:
```bash
grep -rn "rounded-none" app lib modules  # → vacío
grep -rnE "[^a-zA-Z](alert|confirm|prompt)\(" app lib modules --include="*.tsx" --include="*.ts"  # → vacío
```

## 3. WhatsApp / control del agente

- **Nunca confirmar sin ejecutar.** Todo registro se ejecuta primero con el script
  correspondiente (`scripts/whatsapp-*.mjs`); la respuesta sale del JSON resultante.
  Estados: `ok` → confirmar con datos · `ambiguo` → preguntar · `sin-match` → decirlo.
- **Factura: resumen → confirmación → ejecución.** Al recibir una factura, presentar
  SIEMPRE el resumen (artículos, cantidades, precios, match con productos, cuenta del
  egreso) y esperar el "sí" de luigi. Nunca registrar directo.
- **Un solo esquema de creación de productos**, lo use el agente o la app manual.
  Obligatorios: nombre, unidad (kg/g/L/ml/und), categoría, cantidad.
  Opcional: precio de referencia. Lo no inferible se marca en el resumen.
- "Cuánto comprar" es **sugerencia**, nunca orden.

## 4. Datos

- Todo registro compartido lleva `creado_por` (el hogar tiene 2 personas).
- **Saldos y stock se calculan** (inicial + movimientos), no se almacenan. Descuadres
  se corrigen con ajustes de conciliación, nunca editando el saldo a mano.
- Conversiones de moneda usan la **tasa histórica de la fecha** del movimiento, no la actual.
- Transferir entre cuentas no es gastar: existe el tipo `transferencia`.
- El dinero es compartido; el **XP/juego es personal**.

## 5. Deploys y riesgo

- Sin push ni deploy de trabajo riesgoso o entrelazado sin revisión explícita de luigi.
- Verificación antes de anunciar: `npx tsc --noEmit` + lint/build limpios; smokes del
  módulo si existen. Lo que toque su teléfono (PWA, pushes) queda como
  "pendiente verificación en teléfono" hasta que él lo confirme.

## 6. Alcance

- La Bodega de Cheo sigue **pausada** por orden de luigi: no reabrir por iniciativa propia.
- Lo aparcado (no descartado): vencimientos de productos, inversiones/bolsa,
  sincronización bancaria automática, múltiples hogares por usuario.
