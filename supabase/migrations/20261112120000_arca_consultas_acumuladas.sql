-- ============================================================================
-- Diferencias con ARCA: las consultas son MOVIMIENTOS, no la nómina (JC 21/10/2026)
-- ============================================================================
-- Cada «Consulta de Relaciones Laborales» que se carga trae los movimientos de un
-- período (altas, bajas, cambios), no todas las relaciones vigentes. Comparar
-- sólo contra la última marcaba como «no figura en ARCA» a todos los que siguen
-- trabajando (66 falsos con la consulta del 21/10).
--
-- Ahora se toma el estado MÁS RECIENTE de cada relación (CUIL + inicio) entre
-- TODAS las consultas cargadas:
--   · «Activo en la app» se avisa sólo si ARCA informó la BAJA de su relación y
--     no tiene otra vigente (no por no aparecer en la última consulta).
--   · Contratos con fecha de fin y «relación vigente sin usuario activo» usan el
--     mismo estado acumulado (vigente = sin baja y sin fin vencido).
--   · Las claves ya no dependen de la fecha de la última consulta (una revisión
--     no se reabre por cargar otra consulta).
-- legajo_diferencias_resumen agrega 'vigentes' (relaciones vigentes acumuladas).
-- Sólo funciones de lectura; no cambia datos.
--
-- Rollback: supabase/rollback/20261112120000_arca_consultas_acumuladas_rollback.sql
-- ============================================================================

begin;

create or replace function public.legajo_diferencias(p_empleado uuid default null)
returns table (clave text, tipo text, gravedad text, empleado_id uuid, persona text, cuil text, detalle jsonb,
               revisada boolean, nota text, revisado_at timestamptz, revisado_por text)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
#variable_conflict use_column
declare v_consulta date;
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  v_consulta := (select max(a.consulta_fecha) from public.arca_relaciones_laborales a);
  return query
  with act as (
    select u.id, u.apellido, u.nombre, u.rol, nullif(regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g'), '') as cuil,
           nullif(regexp_replace(coalesce(u.dni, ''), '\D', '', 'g'), '') as dni, u.dni as dni_txt
      from public.usuarios u
     where u.estado = 'activo' and not coalesce(u.es_prueba, false) and (p_empleado is null or u.id = p_empleado)
  ),
  todos as (
    select u.id, u.estado, nullif(regexp_replace(coalesce(u.cuil, ''), '\D', '', 'g'), '') as cuil,
           nullif(regexp_replace(coalesce(u.dni, ''), '\D', '', 'g'), '') as dni
      from public.usuarios u where not coalesce(u.es_prueba, false)
  ),
  -- Estado más reciente de cada relación (CUIL + inicio) en TODAS las consultas
  -- cargadas: una consulta trae los movimientos de un período, no la nómina
  -- completa (JC 21/10). Que alguien no esté en la última no dice nada.
  arca as (
    select distinct on (a.cuil, a.fecha_inicio) a.*,
           (a.situacion_baja is null and (a.fecha_fin is null or a.fecha_fin >= current_date)) as vigente
      from public.arca_relaciones_laborales a
     order by a.cuil, a.fecha_inicio, a.consulta_fecha desc
  ),
  -- relación de ARCA de cada activo: por CUIL o, si no tiene, por el DNI contenido en el CUIL
  par as (
    select distinct on (x.id) x.*, a.cuil as a_cuil, a.apellido_nombre, a.modalidad, a.fecha_inicio, a.fecha_fin, a.situacion_baja,
           a.consulta_fecha as a_consulta, a.vigente as a_vigente,
           case when x.cuil = a.cuil then 'cuil' else 'dni' end as via
      from act x join arca a on a.cuil = x.cuil or (x.cuil is null and x.dni is not null and substr(a.cuil, 3, 8) = lpad(x.dni, 8, '0'))
     order by x.id, (x.cuil = a.cuil) desc, a.vigente desc, a.fecha_inicio desc
  ),
  sit as (
    select x.id,
           (select max(r.created_at) from public.registros_asistencia r where r.guardia_id = x.id) as ultimo_fichaje,
           (select count(*) from public.registros_asistencia r where r.guardia_id = x.id and r.created_at >= date_trunc('month', now())) as fichajes_mes,
           (select min(t.fecha) from public.turnos t where t.guardia_id = x.id and t.fecha >= current_date) as proximo_turno
      from act x
  ),
  d as (
    -- 1) contrato eventual (o cualquier relación) con fecha de fin
    select 'eventual:' || p.id || ':' || p.fecha_fin as clave, 'contrato_con_fin' as tipo,
           case when p.fecha_fin - current_date <= 7 then 'alta' else 'media' end as gravedad, p.id as empleado_id,
           p.apellido || ', ' || p.nombre as persona, p.a_cuil as cuil,
           jsonb_build_object('modalidad', p.modalidad, 'inicio', p.fecha_inicio, 'fin', p.fecha_fin, 'dias_restantes', p.fecha_fin - current_date,
                              'ultimo_fichaje', s.ultimo_fichaje, 'fichajes_mes', s.fichajes_mes, 'proximo_turno', s.proximo_turno, 'consulta', p.a_consulta) as detalle
      from par p join sit s on s.id = p.id where p.fecha_fin is not null
    union all
    -- 2) activo en la app con la baja informada por ARCA (y ninguna otra relación vigente)
    select 'sin_relacion:' || p.id || ':' || p.a_cuil || ':' || p.fecha_inicio, 'activo_sin_relacion', 'alta', p.id, p.apellido || ', ' || p.nombre, p.a_cuil,
           jsonb_build_object('consulta', p.a_consulta, 'rol', p.rol, 'tiene_cuil', p.cuil is not null, 'baja', p.situacion_baja,
             'inicio', p.fecha_inicio, 'fin', p.fecha_fin,
             'ultimo_fichaje', s.ultimo_fichaje, 'fichajes_mes', s.fichajes_mes, 'proximo_turno', s.proximo_turno)
      from par p join sit s on s.id = p.id
     where not p.a_vigente and p.situacion_baja is not null
    union all
    -- 3) relación vigente en ARCA sin usuario activo (sólo en la vista general)
    select 'sin_usuario:' || a.cuil || ':' || a.fecha_inicio, 'relacion_sin_usuario', 'alta', t.id, a.apellido_nombre, a.cuil,
           jsonb_build_object('consulta', a.consulta_fecha, 'inicio', a.fecha_inicio, 'modalidad', a.modalidad, 'usuario', t.estado,
             'ultimo_fichaje', (select max(r.created_at) from public.registros_asistencia r where r.guardia_id = t.id))
      from arca a left join lateral (select y.id, y.estado from todos y where y.cuil = a.cuil or (y.dni is not null and substr(a.cuil, 3, 8) = lpad(y.dni, 8, '0'))
                                     order by (y.estado = 'activo') desc limit 1) t on true
     where p_empleado is null and a.vigente
       and (t.id is null or t.estado <> 'activo')
    union all
    -- 4) activo sin CUIL (con el de ARCA si se encontró por DNI)
    select 'sin_cuil:' || x.id, 'sin_cuil', 'media', x.id, x.apellido || ', ' || x.nombre, null::text,
           jsonb_build_object('cuil_arca', p.a_cuil, 'nombre_arca', p.apellido_nombre,
                              'nombre_coincide', case when p.a_cuil is null then null else public.legajo_nombre_compatible(x.apellido || ' ' || x.nombre, p.apellido_nombre) end)
      from act x left join par p on p.id = x.id where x.cuil is null
    union all
    -- 5) identidad distinta de ARCA (nombre o DNI)
    select 'identidad:' || p.id || ':' || md5(coalesce(p.apellido, '') || '|' || coalesce(p.nombre, '') || '|' || coalesce(p.dni_txt, '') || '|' || p.apellido_nombre),
           'identidad_difiere', 'media', p.id, p.apellido || ', ' || p.nombre, p.a_cuil,
           jsonb_build_object('nombre_app', p.apellido || ' ' || p.nombre, 'nombre_arca', p.apellido_nombre, 'dni_app', p.dni_txt,
             'nombre_difiere', not public.legajo_nombre_compatible(p.apellido || ' ' || p.nombre, p.apellido_nombre),
             'dni_difiere', lpad(coalesce(p.dni, ''), 8, '0') <> substr(p.a_cuil, 3, 8),
             'dni_con_formato', p.dni_txt is distinct from p.dni)
      from par p
     where p.via = 'cuil' and (not public.legajo_nombre_compatible(p.apellido || ' ' || p.nombre, p.apellido_nombre)
            or lpad(coalesce(p.dni, ''), 8, '0') <> substr(p.a_cuil, 3, 8) or p.dni_txt is distinct from p.dni)
    union all
    -- 6) el mismo DNI en dos usuarios activos
    select 'dni_repetido:' || x.id || ':' || x.dni, 'dni_repetido', 'alta', x.id, x.apellido || ', ' || x.nombre, x.cuil,
           jsonb_build_object('dni', x.dni, 'otros', (select jsonb_agg(y.apellido || ', ' || y.nombre) from act y where y.dni = x.dni and y.id <> x.id))
      from act x where x.dni is not null and exists (select 1 from public.usuarios y where y.estado = 'activo' and not coalesce(y.es_prueba, false) and y.id <> x.id
                                                       and regexp_replace(coalesce(y.dni, ''), '\D', '', 'g') = x.dni)
    union all
    -- 7) fecha de ingreso del legajo distinta del inicio en ARCA, o faltante
    select 'ingreso:' || x.id || ':' || coalesce(l.fecha_ingreso::text, '-') || ':' || coalesce(p.fecha_inicio::text, '-'),
           case when l.fecha_ingreso is null then 'sin_fecha_ingreso' else 'ingreso_difiere' end, 'baja', x.id, x.apellido || ', ' || x.nombre, x.cuil,
           jsonb_build_object('legajo', l.fecha_ingreso, 'arca', p.fecha_inicio)
      from act x left join public.legajo_datos_personales l on l.empleado_id = x.id left join par p on p.id = x.id
     where l.fecha_ingreso is null or (p.fecha_inicio is not null and l.fecha_ingreso <> p.fecha_inicio)
  )
  select d.clave, d.tipo, d.gravedad, d.empleado_id, d.persona, d.cuil, d.detalle,
         r.clave is not null, r.nota, r.revisado_at, (select q.apellido || ', ' || q.nombre from public.usuarios q where q.id = r.revisado_por)
    from d left join public.legajo_diferencias_revision r on r.clave = d.clave
   order by (r.clave is not null), case d.gravedad when 'alta' then 0 when 'media' then 1 else 2 end, d.tipo, d.persona;
end;
$fn$;

create or replace function public.legajo_diferencias_resumen()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return jsonb_build_object(
    'consulta', (select max(a.consulta_fecha) from public.arca_relaciones_laborales a),
    'relaciones', (select count(*) from public.arca_relaciones_laborales a where a.consulta_fecha = (select max(b.consulta_fecha) from public.arca_relaciones_laborales b)),
    'vigentes', (select count(*) from (select distinct on (a.cuil, a.fecha_inicio) a.situacion_baja, a.fecha_fin
                                         from public.arca_relaciones_laborales a order by a.cuil, a.fecha_inicio, a.consulta_fecha desc) u
                  where u.situacion_baja is null and (u.fecha_fin is null or u.fecha_fin >= current_date)),
    'consultas', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.f, 'relaciones', c.n, 'cargada_at', c.at) order by c.f desc)
                             from (select a.consulta_fecha f, count(*) n, max(a.cargado_at) at from public.arca_relaciones_laborales a group by 1) c), '[]'::jsonb),
    'correcciones', coalesce((select jsonb_agg(jsonb_build_object('persona', u.apellido || ', ' || u.nombre, 'empleado_id', c.empleado_id, 'campo', c.campo,
                                'anterior', c.valor_anterior, 'nuevo', c.valor_nuevo, 'fuente', c.fuente, 'at', c.realizado_at) order by c.realizado_at desc)
                               from (select * from public.legajo_identidad_cambios order by realizado_at desc limit 50) c join public.usuarios u on u.id = c.empleado_id), '[]'::jsonb));
end;
$fn$;

revoke all on function public.legajo_diferencias(uuid) from public, anon;
revoke all on function public.legajo_diferencias_resumen() from public, anon;
grant execute on function public.legajo_diferencias(uuid) to authenticated;
grant execute on function public.legajo_diferencias_resumen() to authenticated;

commit;

notify pgrst, 'reload schema';
