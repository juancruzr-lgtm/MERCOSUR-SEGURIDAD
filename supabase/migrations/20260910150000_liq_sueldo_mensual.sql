-- ============================================================================
-- LIQ · SUELDO MENSUAL individual por persona (mensualizados fijos, bloque 3)
-- ============================================================================
-- Feature (JC 10/09): los mensualizados FIJOS (grupo administrativos: dirección
-- operativa / administración / gerencia, con o sin usuario en la app) tienen un
-- SUELDO MENSUAL propio por persona, que:
--   - se usa en el mes actual;
--   - se ARRASTRA a los meses siguientes hasta que se cambie;
--   - guarda VIGENCIA (cambiarlo NO altera los meses anteriores);
--   - se exporta a Visual por el concepto real 001 ("horas trabajadas").
-- NO aplica a vigiladores ni a supervisores operativos (Sergio/Sabino/Walter):
-- ésos siguen por 25 días + horas + adicionales, y sus horas NO entran a REC/Extras.
--
-- Se guarda por PERSONA (liquidacion_persona.id) para cubrir también a los
-- mensualizados fijos SIN usuario en la app. Sólo el SUELDO MENSUAL se arrastra;
-- ninguna otra variable mensual (horas/nocturnidad/feriados/adelantos/etc.).
--
-- ADITIVA/REVERSIBLE. No toca cálculos existentes, ni otras tablas ni RPCs.
--
-- ROLLBACK:     supabase/rollback/20260910150000_liq_sueldo_mensual_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910150000_liq_sueldo_mensual_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.liquidacion_persona') is null then raise exception 'falta public.liquidacion_persona'; end if;
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta public.puede_liquidar_actual()'; end if;
end $$;

-- 1) Tabla versionada por vigencia. Una sola fila VIGENTE (hasta null) por persona.
create table if not exists public.liquidacion_sueldo_mensual (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.liquidacion_persona(id) on delete cascade,
  importe        numeric not null check (importe >= 0),
  vigencia_desde date not null,
  vigencia_hasta date,                       -- null = vigente
  created_at     timestamptz not null default now(),
  created_by     uuid references public.usuarios(id) on delete set null,
  constraint liq_sueldo_mensual_vigencia_coherente
    check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_liq_sueldo_mensual_persona
  on public.liquidacion_sueldo_mensual (persona_id, vigencia_desde desc);
-- Como mucho UNA fila abierta por persona (la vigente).
create unique index if not exists uq_liq_sueldo_mensual_vigente
  on public.liquidacion_sueldo_mensual (persona_id) where vigencia_hasta is null;

alter table public.liquidacion_sueldo_mensual enable row level security;
revoke all on public.liquidacion_sueldo_mensual from anon, authenticated;
grant select on public.liquidacion_sueldo_mensual to authenticated;
drop policy if exists liq_sueldo_mensual_lectura on public.liquidacion_sueldo_mensual;
create policy liq_sueldo_mensual_lectura on public.liquidacion_sueldo_mensual
  for select to authenticated using (public.puede_liquidar_actual());
-- Escritura sólo por la RPC SECURITY DEFINER (abajo).

-- 2) Valor VIGENTE para un mes 'YYYY-MM' (o null si la persona no tiene).
create or replace function public.sueldo_mensual_vigente(p_persona_id uuid, p_mes text)
returns numeric
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select sm.importe
  from public.liquidacion_sueldo_mensual sm
  where sm.persona_id = p_persona_id
    and sm.vigencia_desde <= (date_trunc('month',(p_mes||'-01')::date) + interval '1 month - 1 day')::date
    and (sm.vigencia_hasta is null or sm.vigencia_hasta >= (p_mes||'-01')::date)
  order by sm.vigencia_desde desc
  limit 1;
$fn$;

-- 3) Fijar el SUELDO MENSUAL desde un mes hacia adelante (preserva la historia).
--    - Si ya hay una fila que arranca EXACTAMENTE ese mes → actualiza su importe.
--    - Si no → cierra la fila vigente en el mes anterior e inserta una nueva
--      desde el 1º del mes. Los meses previos conservan su valor.
create or replace function public.set_sueldo_mensual(p_persona_id uuid, p_importe numeric, p_mes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_desde date := (p_mes||'-01')::date;
  v_prev  date := v_desde - 1;
  v_existe uuid;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede fijar el sueldo mensual';
  end if;
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  if p_importe is null or p_importe < 0 then raise exception 'Importe inválido'; end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';

  -- ¿ya hay una fila que arranca ese mismo mes?
  select id into v_existe from public.liquidacion_sueldo_mensual
   where persona_id = p_persona_id and vigencia_desde = v_desde limit 1;

  if v_existe is not null then
    update public.liquidacion_sueldo_mensual set importe = p_importe where id = v_existe;
    return jsonb_build_object('accion','actualizado','desde',v_desde);
  end if;

  -- cerrar la(s) vigente(s) que arrancan antes de este mes
  update public.liquidacion_sueldo_mensual
     set vigencia_hasta = v_prev
   where persona_id = p_persona_id and vigencia_hasta is null and vigencia_desde <= v_prev;

  insert into public.liquidacion_sueldo_mensual(persona_id, importe, vigencia_desde, created_by)
    values (p_persona_id, p_importe, v_desde, v_actor);
  return jsonb_build_object('accion','nuevo','desde',v_desde);
end;
$fn$;

revoke all on function public.sueldo_mensual_vigente(uuid,text) from public, anon;
revoke all on function public.set_sueldo_mensual(uuid,numeric,text) from public, anon;
grant execute on function public.sueldo_mensual_vigente(uuid,text) to authenticated;
grant execute on function public.set_sueldo_mensual(uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';

commit;
