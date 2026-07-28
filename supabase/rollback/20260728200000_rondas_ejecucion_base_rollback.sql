/*
================================================================================
ROLLBACK — Etapa 3.1, Backend: base transaccional de ejecución de rondas
================================================================================

Revierte: supabase/migrations/20260728200000_rondas_ejecucion_base.sql

ADVERTENCIA: `drop table ronda_ejecuciones` elimina TODAS las ejecuciones
registradas y, por cascada, sus puntos. Si ya hubo rondas ejecutadas en
producción, ese historial se pierde y no hay forma de reconstruirlo.

Antes de ejecutar, verificar cuánto se estaría destruyendo:

    select count(*) as ejecuciones,
           count(*) filter (where estado = 'en_curso') as en_curso,
           min(iniciada_at) as primera,
           max(iniciada_at) as ultima
      from public.ronda_ejecuciones;

Si devuelve 0, el rollback es inocuo. Si no, exportar antes.

QUÉ NO TOCA
  * `rondas_base` y `ronda_puntos`: la configuración queda intacta.
  * `obtener_rondas_guardia_actual()`: esta migración no la modificó.
  * `turnos`, `puestos`, `usuarios`: sin cambios.
  * `puede_administrar_rondas_objetivo()` y `set_updated_at()`: son
    preexistentes y las usan otros módulos. No se eliminan.

ORDEN
  Primero las funciones que dependen de las tablas, después las tablas. El
  `drop table` de ronda_ejecuciones arrastra ronda_ejecucion_puntos por CASCADE
  en la FK, pero se elimina explícitamente para no depender de ese efecto.
================================================================================
*/

begin;

do $$
declare
  v_ejecuciones integer := 0;
begin
  if to_regclass('public.ronda_ejecuciones') is not null then
    execute 'select count(*) from public.ronda_ejecuciones' into v_ejecuciones;
    if v_ejecuciones > 0 then
      raise warning 'ROLLBACK DESTRUCTIVO: se eliminan % ejecucion(es) de ronda y sus puntos.', v_ejecuciones;
    end if;
  end if;
end;
$$;

drop function if exists public.obtener_ejecucion_actual();
drop function if exists public.iniciar_ronda(uuid);
drop function if exists public.rondas_ejecucion_json(uuid);
drop function if exists public.rondas_turno_vigente();

drop table if exists public.ronda_ejecucion_puntos;
drop table if exists public.ronda_ejecuciones;

notify pgrst, 'reload schema';

commit;


/*
================================================================================
Verificación posterior al rollback
================================================================================
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecuciones')       as tabla_ejecuciones,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecucion_puntos')  as tabla_puntos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('iniciar_ronda','obtener_ejecucion_actual',
                        'rondas_turno_vigente','rondas_ejecucion_json'))  as funciones_etapa_3_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='obtener_rondas_guardia_actual') as rpc_lectura_rondas_intacta,
  (select count(*) from public.rondas_base)                               as rondas_configuradas;

-- Esperado: 0 · 0 · 0 · 1 · sin cambios respecto de antes del rollback
================================================================================
*/
