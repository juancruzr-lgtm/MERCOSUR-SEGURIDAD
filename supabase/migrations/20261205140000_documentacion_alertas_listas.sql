-- Alertas de vencimiento de la documentación del legajo: dejarlas listas para
-- prender. Parte de las definiciones VIVAS de producción (04/11/2026, iguales
-- a 20261009170000) y corrige lo que se encontró al revisarlas:
--
--   1. HORA DE ARGENTINA. Todo usaba current_date, que en Supabase es UTC:
--      entre las 21:00 y las 24:00 de Argentina el reporte decía "vence hoy"
--      a lo que vence mañana y el mes de los faltantes cambiaba tres horas
--      antes. Ahora "hoy" sale de documentacion_hoy() (America/Argentina/
--      Buenos_Aires).
--
--   2. LAS ALERTAS NO SE RESOLVÍAN. Una alerta registrada seguía apareciendo
--      en la app de la persona aunque ya hubiera subido el documento nuevo,
--      Administración lo hubiera reemplazado o el "por vencer" ya fuera
--      "vencido". Las alertas siguen siendo inmutables (sólo se registra
--      cuándo se vieron); lo que cambia es que se MUESTRAN sólo mientras
--      siguen vigentes: documentacion_alerta_vigente() lo decide en un solo
--      lugar.
--
--   3. CREDENCIALES DE HABILITACIÓN. La credencial vale por
--      habilitacion_credenciales (la "única" fuente de si tiene credencial),
--      no por el documento: hay credenciales informadas por Administración
--      sin foto (no tenían alerta) y fotos viejas aprobadas cuya credencial ya
--      se renovó (habrían dado un "vencido" falso). Para el tipo 'credencial'
--      ahora manda la última credencial no anulada de cada persona; el
--      documento sólo cuenta si la persona no tiene ninguna credencial
--      registrada.
--
--   4. PERMISOS. La persona veía sus alertas por la tabla aunque Gerencia no
--      hubiera prendido "avisar a la persona"; y Administración veía por la
--      tabla alertas de tipos reservados a Gerencia. Se ajusta la política de
--      lectura.
--
-- NO prende nada: documentacion_alertas_config queda como está (activo =
-- false). NO programa el cron (supabase/cron/20261009170000_...).
--
-- Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261205140000_documentacion_alertas_listas_rollback.sql.

begin;

-- ============================================================================
-- 1. "HOY" EN ARGENTINA
-- ============================================================================

create or replace function public.documentacion_hoy()
returns date
language sql
stable
set search_path = public, pg_catalog
as $fn$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$fn$;

revoke all on function public.documentacion_hoy() from public, anon;
grant execute on function public.documentacion_hoy() to authenticated, service_role;

-- ============================================================================
-- 2. LA ALERTA DE UNA CREDENCIAL GUARDA CUÁL ES
-- ============================================================================

alter table public.documentacion_alertas
  add column if not exists credencial_id uuid references public.habilitacion_credenciales(id) on delete restrict;

-- ============================================================================
-- 3. ¿SIGUE VIGENTE ESTA ALERTA? (un solo lugar)
-- ============================================================================

create or replace function public.documentacion_alerta_vigente(a public.documentacion_alertas)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    -- Credencial: sigue siendo la última no anulada de la persona y con el
    -- mismo vencimiento. Un "por vencer" deja de mostrarse cuando ya venció
    -- (para eso está el "vencido").
    when a.credencial_id is not null then
      (a.motivo = 'vencido' or a.vence_el >= public.documentacion_hoy())
      and exists (
        select 1 from (
          select c.id, c.vence_el from public.habilitacion_credenciales c
          where c.empleado_id = a.empleado_id and c.anulada_at is null
          order by c.vence_el desc nulls last, c.registrada_at desc
          limit 1) u
        where u.id = a.credencial_id and u.vence_el is not distinct from a.vence_el)
    -- Documento: sigue aprobado/aceptado (no reemplazado ni anulado) con el
    -- mismo vencimiento; y si es una credencial, la persona no tiene
    -- credencial registrada (si la tiene, manda la credencial).
    when a.motivo in ('vencido','por_vencer') then
      (a.motivo = 'vencido' or a.vence_el >= public.documentacion_hoy())
      and exists (select 1 from public.documentacion_documentos d
                  where d.id = a.documento_id and d.estado in ('aprobado','aceptado')
                    and d.vence_el is not distinct from a.vence_el)
      and not (a.tipo = 'credencial'
               and exists (select 1 from public.habilitacion_credenciales c
                           where c.empleado_id = a.empleado_id and c.anulada_at is null))
    -- Faltante: sigue sin haber nada cargado y no se marcó "no corresponde".
    when a.motivo = 'faltante' then
      not exists (select 1 from public.documentacion_documentos d
                  where d.empleado_id = a.empleado_id and d.tipo = a.tipo
                    and d.estado in ('aprobado','aceptado','pendiente_revision','pendiente_aceptacion'))
      and coalesce((select x.situacion from public.documentacion_situaciones x
                    where x.empleado_id = a.empleado_id and x.tipo = a.tipo
                    order by x.id desc limit 1), '') <> 'no_corresponde'
    -- Solicitado: la última situación sigue siendo "solicitado" y no se subió.
    when a.motivo = 'solicitado' then
      coalesce((select x.situacion from public.documentacion_situaciones x
                where x.empleado_id = a.empleado_id and x.tipo = a.tipo
                order by x.id desc limit 1), '') = 'solicitado'
      and not exists (select 1 from public.documentacion_documentos d
                      where d.empleado_id = a.empleado_id and d.tipo = a.tipo
                        and d.estado not in ('subiendo','anulado','reemplazado','rechazado'))
    else false
  end
$fn$;

revoke all on function public.documentacion_alerta_vigente(public.documentacion_alertas) from public, anon, authenticated;
grant execute on function public.documentacion_alerta_vigente(public.documentacion_alertas) to service_role;

-- ¿Gerencia prendió el aviso a la persona? (la persona no puede leer la config)
create or replace function public.documentacion_alertas_aviso_persona()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce((select c.activo and c.avisar_persona from public.documentacion_alertas_config c where c.id = 1), false)
$fn$;

revoke all on function public.documentacion_alertas_aviso_persona() from public, anon;
grant execute on function public.documentacion_alertas_aviso_persona() to authenticated, service_role;

-- ============================================================================
-- 4. LECTURA DE LA TABLA (RLS)
-- ============================================================================
-- Gerencia: todo. Administración: todo salvo tipos reservados a Gerencia.
-- La persona: lo propio, sin reservados, y sólo con "avisar a la persona"
-- prendido. La restrictiva acceso_bloqueado_baja sigue igual.

drop policy if exists "Alertas doc: alertas" on public.documentacion_alertas;
create policy "Alertas doc: alertas" on public.documentacion_alertas for select to authenticated
  using (
    public.documentacion_es_gerencia()
    or (exists (select 1 from public.documentacion_tipos t where t.codigo = tipo and t.sensibilidad <> 'reservado_gerencia')
        and (public.documentacion_puede_gestionar()
             or (empleado_id = public.rondas_usuario_actual_id() and public.documentacion_alertas_aviso_persona())))
  );

-- ============================================================================
-- 5. GENERAR (sólo service_role, desde el cron). Apagado = no hace nada.
-- ============================================================================

create or replace function public.documentacion_alertas_generar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c       public.documentacion_alertas_config%rowtype;
  v_hoy     date := public.documentacion_hoy();
  v_mes     text := to_char(public.documentacion_hoy(), 'YYYY-MM');
  v_venc    integer := 0;
  v_cred    integer := 0;
  v_falt    integer := 0;
  v_sol     integer := 0;
  v_n       integer;
begin
  v_c := (select c from public.documentacion_alertas_config c where c.id = 1);
  if v_c.id is null or not v_c.activo then
    return jsonb_build_object('activo', false, 'nuevas', 0);
  end if;

  -- Documentos vencidos y por vencer (sólo lo vigente, sólo personas activas).
  -- La credencial va aparte (punto siguiente) salvo que la persona no tenga
  -- ninguna credencial registrada.
  insert into public.documentacion_alertas (empleado_id, documento_id, tipo, motivo, vence_el, clave)
  select d.empleado_id, d.id, d.tipo,
         case when d.vence_el < v_hoy then 'vencido' else 'por_vencer' end,
         d.vence_el,
         'doc:' || d.id || ':' || case when d.vence_el < v_hoy then 'vencido' else 'por_vencer' end || ':' || d.vence_el
  from public.documentacion_documentos d
  join public.usuarios u on u.id = d.empleado_id
  where d.estado in ('aprobado','aceptado') and d.vence_el is not null
    and d.vence_el <= v_hoy + v_c.dias_aviso
    and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
    and not (d.tipo = 'credencial'
             and exists (select 1 from public.habilitacion_credenciales c
                         where c.empleado_id = d.empleado_id and c.anulada_at is null))
  on conflict (clave) do nothing;
  get diagnostics v_venc = row_count;

  -- Credenciales de habilitación: la última no anulada de cada persona activa.
  insert into public.documentacion_alertas (empleado_id, documento_id, credencial_id, tipo, motivo, vence_el, clave)
  select c.empleado_id, c.documento_id, c.id, 'credencial',
         case when c.vence_el < v_hoy then 'vencido' else 'por_vencer' end,
         c.vence_el,
         'cred:' || c.id || ':' || case when c.vence_el < v_hoy then 'vencido' else 'por_vencer' end || ':' || c.vence_el
  from (
    select distinct on (x.empleado_id) x.* from public.habilitacion_credenciales x
    where x.anulada_at is null
    order by x.empleado_id, x.vence_el desc nulls last, x.registrada_at desc
  ) c
  join public.usuarios u on u.id = c.empleado_id
  where c.vence_el is not null and c.vence_el <= v_hoy + v_c.dias_aviso
    and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  on conflict (clave) do nothing;
  get diagnostics v_cred = row_count;

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

  v_n := v_venc + v_cred + v_sol + v_falt;
  return jsonb_build_object('activo', true, 'hoy', v_hoy, 'nuevas', v_n, 'vencimientos', v_venc,
                            'credenciales', v_cred, 'solicitados', v_sol, 'faltantes', v_falt,
                            'dias_aviso', v_c.dias_aviso);
end;
$fn$;

revoke all on function public.documentacion_alertas_generar() from public, anon, authenticated;
grant execute on function public.documentacion_alertas_generar() to service_role;

-- ============================================================================
-- 6. LA PERSONA: sus alertas vigentes (sólo con "avisar a la persona")
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
      and public.documentacion_alerta_vigente(a)
  ));
end;
$fn$;

revoke all on function public.documentacion_mis_alertas() from public, anon;
grant execute on function public.documentacion_mis_alertas() to authenticated;

-- ============================================================================
-- 7. REPORTE DE VENCIMIENTOS (Administración y Gerencia; no avisa a nadie)
-- ============================================================================
-- Igual que antes, con hora de Argentina, la credencial tomada de
-- habilitacion_credenciales y un resumen de las alertas registradas que
-- siguen vigentes (para comprobar el proceso diario).

create or replace function public.documentacion_vencimientos(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
  v_hoy  date := public.documentacion_hoy();
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoy', v_hoy,
    'dias', v_dias,
    'config', (select to_jsonb(c) - 'actualizado_por' from public.documentacion_alertas_config c where c.id = 1),
    'puede_configurar', public.documentacion_es_gerencia(),
    'alertas', (
      select jsonb_build_object(
        'ultima', max(a.creada_at),
        'vigentes', count(*) filter (where public.documentacion_alerta_vigente(a)),
        'vencido', count(*) filter (where a.motivo = 'vencido' and public.documentacion_alerta_vigente(a)),
        'por_vencer', count(*) filter (where a.motivo = 'por_vencer' and public.documentacion_alerta_vigente(a)),
        'solicitado', count(*) filter (where a.motivo = 'solicitado' and public.documentacion_alerta_vigente(a)),
        'faltante', count(*) filter (where a.motivo = 'faltante' and public.documentacion_alerta_vigente(a)))
      from public.documentacion_alertas a
      join public.documentacion_tipos t on t.codigo = a.tipo
      where public.documentacion_es_gerencia() or t.sensibilidad <> 'reservado_gerencia'
    ),
    'documentos', (
      select coalesce(jsonb_agg(x.j order by x.vence_el, x.apellido), '[]'::jsonb) from (
        select jsonb_build_object(
            'clave', 'doc:' || d.id, 'origen', 'documento',
            'documento_id', d.id, 'empleado_id', d.empleado_id, 'nombre', u.nombre, 'apellido', u.apellido,
            'legajo', u.legajo, 'tipo', d.tipo, 'tipo_nombre', t.nombre, 'detalle', d.detalle, 'vence_el', d.vence_el,
            'dias', d.vence_el - v_hoy, 'verificada', true,
            'reemplazo_en_curso', exists (select 1 from public.documentacion_documentos n
                                          where n.empleado_id = d.empleado_id and n.tipo = d.tipo
                                            and n.estado in ('pendiente_revision','pendiente_aceptacion'))
          ) j, d.vence_el, u.apellido
        from public.documentacion_documentos d
        join public.usuarios u on u.id = d.empleado_id
        join public.documentacion_tipos t on t.codigo = d.tipo
        where d.estado in ('aprobado','aceptado')
          and d.vence_el is not null
          and d.vence_el <= v_hoy + v_dias
          and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
          and public.documentacion_puede_ver(d.empleado_id, d.sensibilidad, d.estado)
          and not (d.tipo = 'credencial'
                   and exists (select 1 from public.habilitacion_credenciales c
                               where c.empleado_id = d.empleado_id and c.anulada_at is null))
        union all
        select jsonb_build_object(
            'clave', 'cred:' || c.id, 'origen', 'credencial',
            'documento_id', c.documento_id, 'empleado_id', c.empleado_id, 'nombre', u.nombre, 'apellido', u.apellido,
            'legajo', u.legajo, 'tipo', 'credencial', 'tipo_nombre', t.nombre,
            'detalle', case when c.numero is not null then 'N° ' || c.numero end, 'vence_el', c.vence_el,
            'dias', c.vence_el - v_hoy, 'verificada', c.verificada,
            'reemplazo_en_curso',
              exists (select 1 from public.habilitacion_tramites r
                      where r.empleado_id = c.empleado_id and r.estado in ('en_curso','presentado'))
              or exists (select 1 from public.documentacion_documentos n
                         where n.empleado_id = c.empleado_id and n.tipo = 'credencial'
                           and n.estado in ('pendiente_revision','pendiente_aceptacion'))
          ) j, c.vence_el, u.apellido
        from (
          select distinct on (x.empleado_id) x.* from public.habilitacion_credenciales x
          where x.anulada_at is null
          order by x.empleado_id, x.vence_el desc nulls last, x.registrada_at desc
        ) c
        join public.usuarios u on u.id = c.empleado_id
        join public.documentacion_tipos t on t.codigo = 'credencial'
        where c.vence_el is not null
          and c.vence_el <= v_hoy + v_dias
          and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
      ) x
    )
  );
end;
$fn$;

revoke all on function public.documentacion_vencimientos(integer) from public, anon;
grant execute on function public.documentacion_vencimientos(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
