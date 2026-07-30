-- ============================================================================
-- ROLLBACK de 20260801130000_rondas_ventanas_programadas
-- ============================================================================
--
-- ORDEN OBLIGATORIO. Esta función es consumida por `evaluar_ronda_alertas()` y
-- por `listar_rondas_programadas_objetivo()`. Antes de correr este archivo hay
-- que revertir a sus consumidores, o el evaluador queda roto:
--
--   1. 20260801170000_listar_ronda_alertas_alcance_rollback.sql
--   2. 20260801160000_listar_rondas_programadas_objetivo_rollback.sql
--   3. 20260801150000_resolver_ronda_alerta_correctivo_rollback.sql
--   4. 20260801140000_evaluar_ronda_alertas_correctivo_rollback.sql
--   5. este archivo
--
-- El bloque de guarda de abajo aborta si todavía queda algún consumidor vivo.

begin;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('evaluar_ronda_alertas', 'listar_rondas_programadas_objetivo')
      and pg_get_functiondef(p.oid) like '%rondas_ventanas_programadas%'
  ) then
    raise exception
      'Hay consumidores vivos de rondas_ventanas_programadas(). Revertí primero las migraciones 20260801140000 y 20260801160000.';
  end if;
end;
$$;

drop function if exists public.rondas_ventanas_programadas(uuid, date, date);

notify pgrst, 'reload schema';

commit;
