-- DNI, CUIL y teléfono dejan de leerse directo de la tabla usuarios desde el navegador:
-- se obtienen con usuarios_datos_personales() (alcance por responsabilidad).
-- Se aplica DESPUÉS de desplegar el cliente que ya no selecciona esas columnas
-- (tests/usuarios-datos-personales.test.ts lo controla).
-- Las escrituras no cambian (la Administración sigue editando legajos por sus vías).
-- Rollback: grant select (dni, cuil, telefono) on public.usuarios to authenticated;
revoke select (dni, cuil, telefono) on public.usuarios from authenticated, anon;
