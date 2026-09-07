-- ============================================================================
-- USUARIOS.ES_PRUEBA — cuentas de prueba fuera de reportes y liquidación
-- ============================================================================
-- POR QUÉ
--   Juan usa una cuenta de supervisor de prueba ("Prueba, Supervisor") para
--   testear la app. Con la REGLA DURA del Resumen Guardia (ningún activo
--   puede faltar) esa cuenta aparecía en el archivo de liquidación. Igual que
--   los objetivos tienen es_prueba, los usuarios necesitan el mismo marcador.
--
-- QUÉ TOCA
--   · Agrega la columna usuarios.es_prueba boolean not null default false.
--   · Marca es_prueba = true en UNA fila: la cuenta "Prueba, Supervisor"
--     (id e1276080-4b04-4586-af7a-b5547588531b).
--
-- NO TOCA, NI UNA FILA
--   · turnos / registros_asistencia / supervisiones / novedades_laborales.
--   · Ningún otro usuario: el default false deja a todos como están.
--
-- GUARDAS
--   · add column if not exists: re-aplicable sin error.
--   · El update va por id exacto y aborta si matcheara más de una fila.
--
-- ROLLBACK: supabase/rollback/20260907150000_usuarios_es_prueba_rollback.sql
-- ============================================================================

begin;

alter table public.usuarios
  add column if not exists es_prueba boolean not null default false;

comment on column public.usuarios.es_prueba is
  'Cuenta de prueba: no aparece en reportes ni en el archivo de liquidación, aunque esté activa. Mismo criterio que objetivos.es_prueba.';

-- La cuenta de prueba conocida de Juan. Guarda: id exacto, una sola fila.
do $$
declare
  n integer;
begin
  update public.usuarios
     set es_prueba = true
   where id = 'e1276080-4b04-4586-af7a-b5547588531b';
  get diagnostics n = row_count;
  if n > 1 then
    raise exception 'ABORTA: el update de es_prueba tocó % filas (esperaba 0 o 1)', n;
  end if;
end $$;

commit;
