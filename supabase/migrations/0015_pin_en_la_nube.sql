-- 0015: PIN de perfil en la nube (aplicada 2026-09-27 con autorización de luigi)
--
-- El PIN deja de vivir solo en localStorage: se guarda como hash SHA-256 con
-- salt por perfil (pin_hash, pin_salt). Nunca se guarda el PIN en claro.
-- Es una cerradura casual tipo Netflix, no seguridad bancaria: un PIN de
-- 4 dígitos es fuerza bruta por definición; el hash solo evita exponerlo
-- en claro en la base y permite que funcione igual en otro teléfono.

alter table public.perfiles
  add column if not exists pin_hash text,
  add column if not exists pin_salt text;
