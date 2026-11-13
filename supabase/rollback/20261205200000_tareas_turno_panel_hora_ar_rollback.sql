-- Rollback de 20261205200000_tareas_turno_panel_hora_ar.sql
--
-- Vuelve tareas_turno_panel() a la definición viva del 04/11/2026 (la de
-- 20261024120000_tareas_turno.sql), que compara la hora del turno como UTC.
-- No toca datos.

begin;

create or replace function public.tareas_turno_panel(p_objetivo_id uuid, p_dias integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hoy  date;
  v_dias integer;
begin
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  v_hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_dias := least(greatest(coalesce(p_dias, 7), 1), 31);

  return jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'permisos', jsonb_build_object('activar', public.protocolo_puede_publicar()),
    'definiciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'momento', d.momento, 'texto', d.texto, 'evidencia', d.evidencia, 'activo', d.activo,
          'puesto_id', d.puesto_id, 'puesto_nombre', p.nombre, 'activado_at', d.activado_at,
          'desactivado_at', d.desactivado_at, 'motivo_desactivacion', d.motivo_desactivacion,
          'instruccion_id', d.instruccion_id
        ) order by d.activo desc, case d.momento when 'ingreso' then 1 when 'durante' then 2 else 3 end, d.orden), '[]'::jsonb)
      from public.tareas_turno_definiciones d
      left join public.puestos p on p.id = d.puesto_id
      where d.objetivo_id = p_objetivo_id),
    'para_activar', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'control_id', c.id, 'texto', c.texto_item, 'cuando', c.cuando, 'quien', c.quien,
          'version_estado', v.estado, 'version_numero', v.numero
        ) order by c.aprobado_at), '[]'::jsonb)
      from public.protocolo_controles_propuestos c
      join public.protocolo_versiones v on v.id = c.version_id
      where c.objetivo_id = p_objetivo_id and c.destino = 'tarea_turno' and c.estado = 'aprobado'),
    'turnos', (
      select coalesce(jsonb_agg(x.fila order by x.fecha desc, x.inicio desc), '[]'::jsonb)
      from (
        select t.fecha, t.hora_inicio as inicio, jsonb_build_object(
          'turno_id', t.id, 'fecha', t.fecha, 'hora_inicio', t.hora_inicio, 'hora_fin', t.hora_fin,
          'vigilador', nullif(btrim(coalesce(u.apellido, '') || ', ' || coalesce(u.nombre, '')), ','),
          'aplicables', count(d.id),
          'hechas', count(r.id) filter (where r.estado = 'hecha'),
          'no_aplica', count(r.id) filter (where r.estado = 'no_aplica'),
          'no_pude', count(r.id) filter (where r.estado = 'no_pude'),
          'pendientes', count(d.id) filter (where r.id is null),
          'motivos', coalesce(jsonb_agg(jsonb_build_object('tarea', r.texto_tarea, 'estado', r.estado, 'comentario', r.comentario))
                              filter (where r.estado <> 'hecha'), '[]'::jsonb)
        ) as fila
        from public.turnos t
        left join public.usuarios u on u.id = t.guardia_id
        join public.tareas_turno_definiciones d
          on d.objetivo_id = t.objetivo_id and (d.puesto_id is null or d.puesto_id = t.puesto_id)
         and d.activado_at < (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
         and (d.activo or d.desactivado_at > (t.fecha + t.hora_inicio))
        left join public.tareas_turno_registros r on r.definicion_id = d.id and r.turno_id = t.id
        where t.objetivo_id = p_objetivo_id
          and t.fecha between v_hoy - v_dias and v_hoy
          and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
        group by t.id, t.fecha, t.hora_inicio, t.hora_fin, u.apellido, u.nombre
      ) x)
  );
end;
$fn$;

revoke all on function public.tareas_turno_panel(uuid, integer) from public, anon;
grant execute on function public.tareas_turno_panel(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
