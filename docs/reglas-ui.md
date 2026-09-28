# Reglas de UI — Senda

Reglas de diseño obligatorias. Todo cambio visual debe cumplirlas; el
incumplimiento es un bug.

## 1. Nada cuadrado: todo redondeado
- Ningún dropdown, campo, botón, tarjeta o menú puede tener esquinas
  cuadradas (`border-radius: 0` / `rounded-none` están prohibidos).

## 2. Sin dropdowns nativos
- Prohibido el `<select>` nativo: su lista abierta la dibuja el SO, sale
  cuadrada y no hay forma de estilizarla.
- Siempre el componente Select propio (`components/core/ui/Select.tsx`):
  botón + listbox redondeados dibujados por la app, con teclado y ARIA.

## 3. Inputs de una sola línea
- El foco de un campo se indica con UNA sola línea: el borde cambia de color
  (`focus:border-accent`) o el campo usa su propio anillo; nunca borde +
  outline/anillo superpuestos (la "doble línea").
- El anillo global `:focus-visible` no se aplica a `input`, `textarea` ni
  `select` (ver `app/globals.css`): esos campos ya indican el foco con su borde.
- La clase `.input-field` cumple esto: `outline: none` + un solo borde que
  cambia de color en `:focus`, sin box-shadow.

## 4. Iconos profesionales, nunca genéricos
- Toda la iconografía sale de `lib/core/ui/icons` (set SVG propio).
- Prohibidos emojis como iconos en la UI y en notificaciones push
  (el icono de la notificación lo aporta el PWA/manifest, no el texto).
- Nada de placeholders genéricos: cada icono debe representar su acción.

## 5. Mensajes profesionales, nunca del sistema
- Prohibidos `alert()`, `confirm()` y `prompt()` del navegador.
- Confirmaciones destructivas y avisos usan componentes propios en español
  (ej. modal propio de "¿Descartar los cambios?" en el wizard).
- Los textos deben sonar humanos y en español, no mensajes de error crudos.

## Verificación
- `grep -rn "rounded-none" app lib components` → vacío.
- `grep -rn "<select" app components --include="*.tsx"` → vacío (el propio vive en `components/core/ui/Select.tsx` y no usa ese tag).
- `grep -rn "[^a-zA-Z]alert(\|confirm(\|prompt(" app lib components --include="*.tsx" --include="*.ts"` → vacío
  (excluyendo `role="alert"` de accesibilidad).
- Sin emojis en `app/`, `lib/`, `components/` ni títulos de push.
