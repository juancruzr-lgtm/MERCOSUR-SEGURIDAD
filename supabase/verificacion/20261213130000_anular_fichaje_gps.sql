-- Verificación post-migración 20261213130000_anular_fichaje_gps
-- Sólo lectura. Cada fila de control debe dar ok = true.

-- 1. La función existe con la firma esperada.
select 'funcion existe' as control,
       to_regprocedure('public.anular_fichaje_gps(uuid, text)') is not null as ok;

-- 2. Permisos: authenticated sí, anon no.
select 'permisos' as control,
       has_function_privilege('authenticated', 'public.anular_fichaje_gps(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.anular_fichaje_gps(uuid, text)', 'execute') as ok;

-- 3. Valida rol, tipo de registro, alcance, estado del turno y motivo en el servidor.
select 'validaciones en servidor' as control,
       d like '%v_rol is distinct from ''admin''%'
       and d like '%<> ''fichaje_gps''%'
       and d like '%alcanza_turno_actual%'
       and d like '%''reemplazado'', ''anulado'', ''cancelado''%'
       and d like '%length(v_motivo) < 10%'
       and d like '%America/Argentina/Buenos_Aires%' as ok
from (select pg_get_functiondef('public.anular_fichaje_gps(uuid, text)'::regprocedure) d) f;

-- 4. Todo fichaje GPS anulado tiene horas en 0 y su auditoría con un usuario válido.
select 'fichajes GPS anulados auditados' as control,
       not exists (
         select 1 from public.registros_asistencia r
         where r.tipo_registro = 'fichaje_gps'
           and r.registro_anulado_at is not null
           and (coalesce(r.horas_liquidables, 0) <> 0
                or not exists (select 1 from public.registros_asistencia_auditoria a
                               join public.usuarios u on u.id = a.modificado_por
                               where a.registro_id = r.id and a.campo = 'registro_anulado'))
       ) as ok;

-- 5. Últimos fichajes GPS anulados, para revisar después de usar la función.
select r.id, o.nombre, t.fecha, t.estado, r.hora_entrada_real, r.hora_salida_real,
       r.horas_liquidables, r.registro_anulado_at, r.registro_anulado_motivo
from public.registros_asistencia r
join public.turnos t on t.id = r.turno_id
join public.objetivos o on o.id = t.objetivo_id
where r.tipo_registro = 'fichaje_gps' and r.registro_anulado_at is not null
order by r.registro_anulado_at desc
limit 20;
