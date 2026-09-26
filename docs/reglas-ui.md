# Reglas de UI — Habitos

Reglas de diseño obligatorias. Todo cambio visual debe cumplirlas; el
incumplimiento es un bug.

## 1. Nada cuadrado: todo redondeado
- Ningún dropdown, campo, botón, tarjeta o menú puede tener esquinas
  cuadradas (`border-radius: 0` / `rounded-none` están prohibidos).
- Los `<select>` usan la clase `.input-field` (`border-radius: 0.75rem`).
- Los desplegables nativos del SO (lista de opciones, picker de hora) no se
  pueden estilizar; la regla aplica a lo que renderiza la app.

## 2. Iconos profesionales, nunca genéricos
- Toda la iconografía sale de `lib/icons.tsx` (set SVG propio, 29 iconos).
- Prohibidos emojis como iconos en la UI y en notificaciones push
  (el icono de la notificación lo aporta el PWA/manifest, no el texto).
- Nada de placeholders genéricos: cada icono debe representar su acción.

## 3. Mensajes profesionales, nunca del sistema
- Prohibidos `alert()`, `confirm()` y `prompt()` del navegador.
- Confirmaciones destructivas y avisos usan componentes propios
  (ej. confirmación inline de borrado en `app/habitos/page.tsx`).
- Los textos deben sonar humanos y en español, no mensajes de error crudos.

## Verificación
- `grep -rn "rounded-none" app lib` → vacío.
- `grep -rn "[^a-zA-Z]alert(\|confirm(\|prompt(" app lib --include="*.tsx" --include="*.ts"` → vacío
  (excluyendo `role="alert"` de accesibilidad).
- Sin emojis en `app/`, `lib/` ni títulos de push.
