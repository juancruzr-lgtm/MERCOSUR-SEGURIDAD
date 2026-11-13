-- Rollback de 20261205140000_documentacion_alertas_listas.
-- Vuelve a las definiciones de 20261009170000 (= las vivas en producción al
-- 04/11/2026). Si el cron de alertas estaba programado, conviene apagar el
-- interruptor antes (Documentación → Vencimientos) o quitar la tarea:
--   select cron.unschedule('documentacion-alertas');
-- Las alertas ya registradas no se borran (no se puede); pierden sólo la
-- columna credencial_id.

begin;

drop policy if exists "Alertas doc: alertas" on public.documentacion_alertas;
create policy "Alertas doc: alertas" on public.documentacion_alertas for select to authenticated
  using (public.documentacion_puede_gestionar()
         or (empleado_id = public.rondas_usuario_actual_id()
             and exists (select 1 from public.documentacion_tipos t where t.codigo = tipo and t.sensibilidad <> 'reservado_gerencia')));

-- ============================================================================
-- 4. REPORTE DE VENCIMIENTOS (Administración y Gerencia; no avisa a nadie)
-- ============================================================================

create or replace function public.documentacion_vencimientos(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoy', current_date,
    'dias', v_dias,
    'config', (select to_jsonb(c) - 'actualizado_por' from public.documentacion_alertas_config c where c.id = 1),
    'puede_configurar', public.documentacion_es_gerencia(),
    'documentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'documento_id', d.id, 'empleado_id', d.empleado_id, 'nombre', u.nombre, 'apellido', u.apellido,
          'legajo', u.legajo, 'tipo', d.tipo, 'tipo_nombre', t.nombre, 'detalle', d.detalle, 'vence_el', d.vence_el,
          'dias', d.vence_el - current_date,
          'reemplazo_en_curso', exists (select 1 from public.documentacion_documentos n
                                        where n.empleado_id = d.empleado_id and n.tipo = d.tipo
                                          and n.estado in ('pendiente_revision','pendiente_aceptacion'))
        ) order by d.vence_el, u.apellido), '[]'::jsonb)
      from public.documentacion_documentos d
      join public.usuarios u on u.id = d.empleado_id
      join public.documentacion_tipos t on t.codigo = d.tipo
      where d.estado in ('aprobado','aceptado')
        and d.vence_el is not null
        and d.vence_el <= current_date + v_dias
        and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
        and public.documentacion_puede_ver(d.empleado_id, d.sensibilidad, d.estado)
    )
  );
end;
$fn$;

revoke all on function public.documentacion_vencimientos(integer) from public, anon;
grant execute on function public.documentacion_vencimientos(integer) to authenticated;

-- ============================================================================
-- 5. GENERAR ALERTAS (sólo service_role, desde el cron). Apagado = no hace nada.
-- ============================================================================

create or replace function public.documentacion_alertas_generar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c       public.documentacion_alertas_config%rowtype;
  v_mes     text := to_char(current_date, 'YYYY-MM');
  v_venc    integer := 0;
  v_falt    integer := 0;
  v_sol     integer := 0;
  v_n       integer;
begin
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  if v_c.id is null or not v_c.activo then
    return jsonb_build_object('activo', false, 'nuevas', 0);
  end if;

  -- Vencidos y por vencer (sólo lo vigente, sólo personas activas).
  insert into public.documentacion_alertas (empleado_id, documento_id, tipo, motivo, vence_el, clave)
  select d.empleado_id, d.id, d.tipo,
         case when d.vence_el < current_date then 'vencido' else 'por_vencer' end,
         d.vence_el,
         'doc:' || d.id || ':' || case when d.vence_el < current_date then 'vencido' else 'por_vencer' end || ':' || d.vence_el
  from public.documentacion_documentos d
  join public.usuarios u on u.id = d.empleado_id
  where d.estado in ('aprobado','aceptado') and d.vence_el is not null
    and d.vence_el <= current_date + v_c.dias_aviso
    and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  on conflict (clave) do nothing;
  get diagnostics v_venc = row_count;

  -- Solicitados sin respuesta (una vez por mes).
  insert into public.documentacion_alertas (empleado_id, tipo, motivo, clave)
  select s.empleado_id, s.tipo, 'solicitado', 'sol:' || s.empleado_id || ':' || s.tipo || ':' || v_mes
  from (
    select distinct on (x.empleado_id, x.tipo) x.* from public.documentacion_situaciones x
    order by x.empleado_id, x.tipo, x.id desc
  ) s
  join public.usuarios u on u.id = s.empleado_id
  where s.situacion = 'solicitado' and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
    and not exists (select 1 from public.documentacion_documentos d
                    where d.empleado_id = s.empleado_id and d.tipo = s.tipo
                      and d.estado not in ('subiendo','anulado','reemplazado','rechazado'))
  on conflict (clave) do nothing;
  get diagnostics v_sol = row_count;

  -- Faltantes obligatorios (sólo si se pidió; una vez por mes; vigiladores).
  if v_c.incluir_faltantes then
    insert into public.documentacion_alertas (empleado_id, tipo, motivo, clave)
    select u.id, t.codigo, 'faltante', 'falta:' || u.id || ':' || t.codigo || ':' || v_mes
    from public.usuarios u
    cross join public.documentacion_tipos t
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
      and (u.puesto_organizacional = 'vigilador' or (u.puesto_organizacional is null and lower(coalesce(u.rol, '')) in ('guardia','vigilador')))
      and t.activo and t.requisito = 'obligatorio' and t.sensibilidad <> 'reservado_gerencia'
      and not exists (select 1 from public.documentacion_documentos d
                      where d.empleado_id = u.id and d.tipo = t.codigo
                        and d.estado in ('aprobado','aceptado','pendiente_revision','pendiente_aceptacion'))
      and not exists (select 1 from (
                        select distinct on (x.tipo) x.situacion from public.documentacion_situaciones x
                        where x.empleado_id = u.id and x.tipo = t.codigo order by x.tipo, x.id desc) s
                      where s.situacion = 'no_corresponde')
    on conflict (clave) do nothing;
    get diagnostics v_falt = row_count;
  end if;

  v_n := v_venc + v_sol + v_falt;
  return jsonb_build_object('activo', true, 'nuevas', v_n, 'vencimientos', v_venc,
                            'solicitados', v_sol, 'faltantes', v_falt, 'dias_aviso', v_c.dias_aviso);
end;
$fn$;

revoke all on function public.documentacion_alertas_generar() from public, anon, authenticated;
grant execute on function public.documentacion_alertas_generar() to service_role;

-- ============================================================================
-- 6. LA PERSONA: sus alertas (sólo si Gerencia prendió el aviso a la persona)
-- ============================================================================

create or replace function public.documentacion_mis_alertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_actor uuid := public.documentacion_usuario_actual();
  v_c     public.documentacion_alertas_config%rowtype;
begin
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  if v_actor is null or v_c.id is null or not v_c.activo or not v_c.avisar_persona then
    return jsonb_build_object('activo', false, 'alertas', '[]'::jsonb);
  end if;
  return jsonb_build_object('activo', true, 'alertas', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'tipo', a.tipo, 'tipo_nombre', t.nombre, 'motivo', a.motivo, 'vence_el', a.vence_el, 'creada_at', a.creada_at)
        order by a.creada_at desc), '[]'::jsonb)
    from public.documentacion_alertas a
    join public.documentacion_tipos t on t.codigo = a.tipo
    where a.empleado_id = v_actor and a.vista_at is null and t.sensibilidad <> 'reservado_gerencia'
      and a.creada_at > now() - interval '60 days'
  ));
end;
$fn$;

revoke all on function public.documentacion_mis_alertas() from public, anon;
grant execute on function public.documentacion_mis_alertas() to authenticated;

drop function if exists public.documentacion_alerta_vigente(public.documentacion_alertas);
drop function if exists public.documentacion_alertas_aviso_persona();
drop function if exists public.documentacion_hoy();

alter table public.documentacion_alertas drop column if exists credencial_id;

notify pgrst, 'reload schema';

commit;
