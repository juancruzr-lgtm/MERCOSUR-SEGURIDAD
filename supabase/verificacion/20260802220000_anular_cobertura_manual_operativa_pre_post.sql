-- Ejecutar antes (se esperan false/0) y después (se esperan true/1) de la migración.

select
  to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)') is not null as existe_rpc,
  count(*) filter (where column_name = 'cobertura_anulada_at') = 1 as existe_anulada_at,
  count(*) filter (where column_name = 'cobertura_anulada_por') = 1 as existe_anulada_por,
  count(*) filter (where column_name = 'cobertura_anulada_motivo') = 1 as existe_motivo,
  count(*) filter (where column_name = 'horas_liquidables_antes_anulacion') = 1 as existe_resguardo_horas
from information_schema.columns
where table_schema = 'public' and table_name = 'registros_asistencia';

select
  has_function_privilege('authenticated', to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)'), 'execute') as authenticated_ejecuta,
  not has_function_privilege('anon', to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)'), 'execute') as anon_denegado,
  has_function_privilege('service_role', to_regprocedure('public.anular_cobertura_manual_operativa(uuid,uuid,text)'), 'execute') as service_role_ejecuta;

select
  count(*) filter (where conname = 'registros_asistencia_cobertura_anulada_horas_cero') = 1 as protege_horas_cero,
  count(*) filter (where conname = 'registros_asistencia_cobertura_anulacion_intervencion_fk' and condeferrable) = 1 as fk_trazabilidad_diferible
from pg_constraint
where conrelid = 'public.registros_asistencia'::regclass;

do $$
declare
  v_incompletas bigint;
  v_con_horas bigint;
  v_eventos_sin_trazabilidad bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'registros_asistencia'
      and column_name = 'cobertura_anulada_at'
  ) then
    execute $sql$
      select
        count(*) filter (where cobertura_anulada_por is null or nullif(btrim(cobertura_anulada_motivo), '') is null),
        count(*) filter (where coalesce(horas_liquidables, 0) <> 0)
      from public.registros_asistencia
      where cobertura_anulada_at is not null
    $sql$ into v_incompletas, v_con_horas;
    if v_incompletas <> 0 or v_con_horas <> 0 then
      raise exception 'Anulaciones inconsistentes: incompletas %, con horas %', v_incompletas, v_con_horas;
    end if;

    execute $sql$
      select count(*)
      from public.supervisor_intervenciones
      where accion = 'anulacion_cobertura'
        and (cobertura_origen_intervencion_id is null or operacion_id is null)
    $sql$ into v_eventos_sin_trazabilidad;
    if v_eventos_sin_trazabilidad <> 0 then
      raise exception 'Eventos de anulación sin trazabilidad: %', v_eventos_sin_trazabilidad;
    end if;
  else
    raise notice 'PRE: la migración de anulación todavía no está aplicada';
  end if;
end;
$$;
