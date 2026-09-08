-- ============================================================================
-- LIQ2C — Consolidación del período (versión concreta y auditable)
-- ============================================================================
-- Una vez revisada la liquidación, se CONSOLIDA: se congela un snapshot
-- inmutable por (empleado, código de Visual) con el importe final (baseline +
-- ajustes). Es lo que después consume el export a Visual (LIQ2D). No recalcula
-- fórmulas legales de Visual: usa los conceptos/códigos que ya trae la plantilla
-- de trabajo (los puso Juan). Gerencia-only.
--
-- Estados del período (reconciliados con el flujo de JC):
--   borrador → revision → consolidada → exportada → liquidada
-- (Los viejos 'cerrado'/'exportado' no se usaban en datos; se reemplazan.)
--
-- ROLLBACK: supabase/rollback/20260908200000_liq2c_consolidacion_rollback.sql
-- ============================================================================

-- 1) Estados nuevos. Ningún dato usa 'cerrado'/'exportado' hoy (verificado).
alter table public.liquidacion_periodo drop constraint if exists liquidacion_periodo_estado_check;
alter table public.liquidacion_periodo
  add constraint liquidacion_periodo_estado_check
  check (estado = any (array['borrador','revision','consolidada','exportada','liquidada']));

alter table public.liquidacion_periodo add column if not exists consolidado_at  timestamptz;
alter table public.liquidacion_periodo add column if not exists consolidado_por uuid references public.usuarios(id);

-- 2) Snapshot consolidado, inmutable por consolidación (se reemplaza al re-consolidar).
create table if not exists public.liquidacion_consolidada (
  id            uuid primary key default gen_random_uuid(),
  periodo_id    uuid not null references public.liquidacion_periodo(id) on delete cascade,
  empleado_id   uuid not null references public.usuarios(id),
  legajo_visual text,
  cuil          text,
  nombre        text,
  codigo        text not null,
  cantidad      numeric not null default 1,
  importe       numeric,
  created_at    timestamptz not null default now(),
  unique (periodo_id, empleado_id, codigo)
);
create index if not exists ix_liq_consolidada_periodo on public.liquidacion_consolidada (periodo_id);

alter table public.liquidacion_consolidada enable row level security;
revoke all on public.liquidacion_consolidada from anon;
drop policy if exists liquidacion_consolidada_gerencia on public.liquidacion_consolidada;
create policy liquidacion_consolidada_gerencia on public.liquidacion_consolidada
  for all to authenticated
  using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());

-- 3) RPC de consolidación: congela el snapshot provisto por el cliente (que lo
-- calculó con baseline + ajustes) y pasa el período a 'consolidada'. El cálculo
-- vive en el cliente (una sola fuente: lib/excel-trabajo-liquidacion); acá se
-- persiste de forma atómica y auditable.
create or replace function public.consolidar_periodo(
  p_periodo_id uuid,
  p_filas      jsonb   -- [{empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe}]
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_estado text;
  f jsonb;
  v_n int := 0;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede consolidar liquidaciones';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('exportada','liquidada') then raise exception 'El período está % : no se puede re-consolidar', v_estado; end if;

  -- Re-consolidar reemplaza el snapshot anterior (nace de cero, coherente con
  -- "cada período nace limpio").
  delete from public.liquidacion_consolidada where periodo_id = p_periodo_id;

  for f in select * from jsonb_array_elements(p_filas) loop
    if nullif(f->>'empleado_id','') is null or nullif(f->>'codigo','') is null then continue; end if;
    insert into public.liquidacion_consolidada(periodo_id, empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe)
      values (p_periodo_id, (f->>'empleado_id')::uuid, nullif(f->>'legajo_visual',''), nullif(f->>'cuil',''),
              nullif(f->>'nombre',''), f->>'codigo', coalesce(nullif(f->>'cantidad','')::numeric, 1), nullif(f->>'importe','')::numeric)
      on conflict (periodo_id, empleado_id, codigo) do update
        set cantidad = excluded.cantidad, importe = excluded.importe,
            legajo_visual = excluded.legajo_visual, cuil = excluded.cuil, nombre = excluded.nombre;
    v_n := v_n + 1;
  end loop;

  update public.liquidacion_periodo
     set estado='consolidada', consolidado_at=now(), consolidado_por=v_actor, updated_at=now()
   where id = p_periodo_id;

  return jsonb_build_object('filas', v_n, 'estado', 'consolidada');
end;
$fn$;
revoke all on function public.consolidar_periodo(uuid,jsonb) from public, anon;
grant execute on function public.consolidar_periodo(uuid,jsonb) to authenticated;
