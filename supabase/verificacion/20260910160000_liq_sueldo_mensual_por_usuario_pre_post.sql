-- VERIFICACIÓN · SUELDO MENSUAL por usuario_id (20260910160000)
select 'columna_usuario_id' as chequeo,
       exists(select 1 from information_schema.columns where table_name='liquidacion_sueldo_mensual' and column_name='usuario_id')::text as valor, 'POST=true' as esperado
union all
select 'no_columna_persona_id',
       (not exists(select 1 from information_schema.columns where table_name='liquidacion_sueldo_mensual' and column_name='persona_id'))::text, 'POST=true'
union all
select 'fn_set_por_usuario',
       (to_regprocedure('public.set_sueldo_mensual(uuid,numeric,text)') is not null)::text, 'POST=true';

-- CICLO (POST, transaccional, rollback):
-- begin;
-- do $$ declare uid uuid; begin
--   select id into uid from public.usuarios where estado='activo' limit 1;
--   perform public.set_sueldo_mensual(uid, 100000, '2026-08');
--   if public.sueldo_mensual_vigente(uid,'2026-09') <> 100000 then raise exception 'sep no heredó'; end if;
--   perform public.set_sueldo_mensual(uid, 130000, '2026-10');
--   if public.sueldo_mensual_vigente(uid,'2026-08') <> 100000 then raise exception 'ago cambió'; end if;
--   if public.sueldo_mensual_vigente(uid,'2026-10') <> 130000 then raise exception 'oct<>130000'; end if;
-- end $$;
-- select 'VIGENCIA_OK'; rollback;
