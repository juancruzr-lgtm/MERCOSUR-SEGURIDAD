-- ============================================================================
-- FIX #211 · SUELDO MENSUAL por USUARIO_ID (no persona_id)
-- ============================================================================
-- Auditoría: los mensualizados fijos (Joel, Laura, Narvarte, Facundo, Juan Cruz,
-- Rodolfo) están en `usuarios` (puesto administración/gerencia/dir_operativa) y de
-- ahí salen al bloque 3 del Excel (identidad BD = usuario_id). Su entrada en
-- `liquidacion_persona` NO está linkeada (usuario_id null, sin CUIL en el usuario),
-- así que keyear el SUELDO MENSUAL por persona_id no llegaba a esas filas.
--
-- Se re-key por `usuario_id` (todos los mensualizados fijos tienen usuario). La
-- tabla estaba VACÍA, así que se recrea sin pérdida de datos. Vigencia idéntica.
--
-- ROLLBACK:     supabase/rollback/20260910160000_liq_sueldo_mensual_por_usuario_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910160000_liq_sueldo_mensual_por_usuario_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.usuarios') is null then raise exception 'falta public.usuarios'; end if;
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta public.puede_liquidar_actual()'; end if;
  if (select count(*) from public.liquidacion_sueldo_mensual) <> 0 then
    raise exception 'liquidacion_sueldo_mensual NO está vacía: abortar re-key para no perder datos';
  end if;
end $$;

drop function if exists public.set_sueldo_mensual(uuid, numeric, text);
drop function if exists public.sueldo_mensual_vigente(uuid, text);
drop table if exists public.liquidacion_sueldo_mensual;

create table public.liquidacion_sueldo_mensual (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references public.usuarios(id) on delete cascade,
  importe        numeric not null check (importe >= 0),
  vigencia_desde date not null,
  vigencia_hasta date,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id) on delete set null,
  constraint liq_sueldo_mensual_vigencia_coherente
    check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index ix_liq_sueldo_mensual_usuario
  on public.liquidacion_sueldo_mensual (usuario_id, vigencia_desde desc);
create unique index uq_liq_sueldo_mensual_vigente
  on public.liquidacion_sueldo_mensual (usuario_id) where vigencia_hasta is null;

alter table public.liquidacion_sueldo_mensual enable row level security;
revoke all on public.liquidacion_sueldo_mensual from anon, authenticated;
grant select on public.liquidacion_sueldo_mensual to authenticated;
drop policy if exists liq_sueldo_mensual_lectura on public.liquidacion_sueldo_mensual;
create policy liq_sueldo_mensual_lectura on public.liquidacion_sueldo_mensual
  for select to authenticated using (public.puede_liquidar_actual());

create or replace function public.sueldo_mensual_vigente(p_usuario_id uuid, p_mes text)
returns numeric
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select sm.importe
  from public.liquidacion_sueldo_mensual sm
  where sm.usuario_id = p_usuario_id
    and sm.vigencia_desde <= (date_trunc('month',(p_mes||'-01')::date) + interval '1 month - 1 day')::date
    and (sm.vigencia_hasta is null or sm.vigencia_hasta >= (p_mes||'-01')::date)
  order by sm.vigencia_desde desc
  limit 1;
$fn$;

create or replace function public.set_sueldo_mensual(p_usuario_id uuid, p_importe numeric, p_mes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_desde date := (p_mes||'-01')::date;
  v_prev  date := (p_mes||'-01')::date - 1;
  v_existe uuid;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede fijar el sueldo mensual';
  end if;
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  if p_importe is null or p_importe < 0 then raise exception 'Importe inválido'; end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';

  select id into v_existe from public.liquidacion_sueldo_mensual
   where usuario_id = p_usuario_id and vigencia_desde = v_desde limit 1;

  if v_existe is not null then
    update public.liquidacion_sueldo_mensual set importe = p_importe where id = v_existe;
    return jsonb_build_object('accion','actualizado','desde',v_desde);
  end if;

  update public.liquidacion_sueldo_mensual
     set vigencia_hasta = v_prev
   where usuario_id = p_usuario_id and vigencia_hasta is null and vigencia_desde <= v_prev;

  insert into public.liquidacion_sueldo_mensual(usuario_id, importe, vigencia_desde, created_by)
    values (p_usuario_id, p_importe, v_desde, v_actor);
  return jsonb_build_object('accion','nuevo','desde',v_desde);
end;
$fn$;

revoke all on function public.sueldo_mensual_vigente(uuid,text) from public, anon;
revoke all on function public.set_sueldo_mensual(uuid,numeric,text) from public, anon;
grant execute on function public.sueldo_mensual_vigente(uuid,text) to authenticated;
grant execute on function public.set_sueldo_mensual(uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';

commit;
