-- ============================================================================
-- LIQ · EXTRA fija mensual (vigencia) + guardar IDENTIDAD desde la reimportación
-- ============================================================================
-- (JC 10/09) El Excel de trabajo pasa a ser la pantalla de edición del legajo:
--   1) EXTRA fija por persona (concepto "extras" AP): editable, se guarda y se
--      arrastra al mes siguiente por defecto (misma mecánica que SUELDO MENSUAL).
--   2) Cambios de IDENTIDAD (CUIL / LEGAJO-COD_INTERNO / CUENTA) editados en el
--      Excel se PERSISTEN en el usuario al reimportar.
--
-- ADITIVA/REVERSIBLE. No toca cálculos de vigiladores ni supervisores operativos.
--
-- ROLLBACK:     supabase/rollback/20260910170000_liq_extra_mensual_e_identidad_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910170000_liq_extra_mensual_e_identidad_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.usuarios') is null then raise exception 'falta public.usuarios'; end if;
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta public.puede_liquidar_actual()'; end if;
end $$;

-- 1) EXTRA mensual por usuario, con vigencia (espejo de liquidacion_sueldo_mensual).
create table if not exists public.liquidacion_extra_mensual (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references public.usuarios(id) on delete cascade,
  importe        numeric not null check (importe >= 0),
  vigencia_desde date not null,
  vigencia_hasta date,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id) on delete set null,
  constraint liq_extra_mensual_vigencia_coherente
    check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_liq_extra_mensual_usuario
  on public.liquidacion_extra_mensual (usuario_id, vigencia_desde desc);
create unique index if not exists uq_liq_extra_mensual_vigente
  on public.liquidacion_extra_mensual (usuario_id) where vigencia_hasta is null;

alter table public.liquidacion_extra_mensual enable row level security;
revoke all on public.liquidacion_extra_mensual from anon, authenticated;
grant select on public.liquidacion_extra_mensual to authenticated;
drop policy if exists liq_extra_mensual_lectura on public.liquidacion_extra_mensual;
create policy liq_extra_mensual_lectura on public.liquidacion_extra_mensual
  for select to authenticated using (public.puede_liquidar_actual());

create or replace function public.extra_mensual_vigente(p_usuario_id uuid, p_mes text)
returns numeric
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select em.importe
  from public.liquidacion_extra_mensual em
  where em.usuario_id = p_usuario_id
    and em.vigencia_desde <= (date_trunc('month',(p_mes||'-01')::date) + interval '1 month - 1 day')::date
    and (em.vigencia_hasta is null or em.vigencia_hasta >= (p_mes||'-01')::date)
  order by em.vigencia_desde desc
  limit 1;
$fn$;

create or replace function public.set_extra_mensual(p_usuario_id uuid, p_importe numeric, p_mes text)
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
    raise exception 'Sólo Gerencia/Administración puede fijar la extra mensual';
  end if;
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  if p_importe is null or p_importe < 0 then raise exception 'Importe inválido'; end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';

  select id into v_existe from public.liquidacion_extra_mensual
   where usuario_id = p_usuario_id and vigencia_desde = v_desde limit 1;
  if v_existe is not null then
    update public.liquidacion_extra_mensual set importe = p_importe where id = v_existe;
    return jsonb_build_object('accion','actualizado','desde',v_desde);
  end if;

  update public.liquidacion_extra_mensual
     set vigencia_hasta = v_prev
   where usuario_id = p_usuario_id and vigencia_hasta is null and vigencia_desde <= v_prev;

  insert into public.liquidacion_extra_mensual(usuario_id, importe, vigencia_desde, created_by)
    values (p_usuario_id, p_importe, v_desde, v_actor);
  return jsonb_build_object('accion','nuevo','desde',v_desde);
end;
$fn$;

-- 2) Persistir identidad (CUIL / legajo_visual / cuenta_bancaria) editada en el Excel.
--    Sólo pisa los campos que vienen con valor (no borra lo existente con vacío).
create or replace function public.actualizar_identidad_usuario(
  p_usuario_id uuid, p_cuil text, p_legajo_visual text, p_cuenta text
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede editar la identidad del legajo';
  end if;
  update public.usuarios set
    cuil            = coalesce(nullif(btrim(p_cuil),''), cuil),
    legajo_visual   = coalesce(nullif(btrim(p_legajo_visual),''), legajo_visual),
    cuenta_bancaria = coalesce(nullif(btrim(p_cuenta),''), cuenta_bancaria)
  where id = p_usuario_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('actualizado', v_n);
end;
$fn$;

revoke all on function public.extra_mensual_vigente(uuid,text) from public, anon;
revoke all on function public.set_extra_mensual(uuid,numeric,text) from public, anon;
revoke all on function public.actualizar_identidad_usuario(uuid,text,text,text) from public, anon;
grant execute on function public.extra_mensual_vigente(uuid,text) to authenticated;
grant execute on function public.set_extra_mensual(uuid,numeric,text) to authenticated;
grant execute on function public.actualizar_identidad_usuario(uuid,text,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
