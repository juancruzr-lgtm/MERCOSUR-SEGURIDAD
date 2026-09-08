-- ============================================================================
-- LIQ2B — Ajustes de liquidación desde el Excel de trabajo reimportado
-- ============================================================================
-- Juan descarga el Excel de trabajo (LIQ2A), lo edita y lo vuelve a subir. El
-- cliente compara contra el baseline de MERCOSUR y arma un PREVIEW de
-- diferencias por (empleado, variable). Al confirmar, esta RPC persiste los
-- AJUSTES guardando SIEMPRE dos valores: el DATO OPERATIVO ORIGINAL
-- (valor_operativo, lo que calculó MERCOSUR) y el VALOR DE LIQUIDACIÓN
-- (valor_liquidacion, lo que dejó Juan). NUNCA toca turnos/fichajes/novedades.
-- Todo económico: RLS y RPC sólo Gerencia. Dedupe por hash de archivo.
--
-- ROLLBACK: supabase/rollback/20260908190000_liq2b_ajustes_rollback.sql
-- ============================================================================

create table if not exists public.liquidacion_ajuste (
  id                uuid primary key default gen_random_uuid(),
  periodo_id        uuid not null references public.liquidacion_periodo(id) on delete cascade,
  empleado_id       uuid not null references public.usuarios(id),
  tipo              text not null default 'variable' check (tipo in ('variable','concepto')),
  clave             text not null,   -- nombre de variable ('jornadas','horas_liquidables'…) o código de concepto
  etiqueta          text,
  concepto_id       uuid references public.liquidacion_concepto_catalogo(id),
  valor_operativo   numeric,         -- DATO OPERATIVO ORIGINAL (MERCOSUR) — no se pisa
  valor_liquidacion numeric,         -- VALOR DE LIQUIDACIÓN (ajustado por Juan)
  origen            text not null default 'excel_reimport',
  motivo            text,
  lote_id           uuid references public.liquidacion_importacion(id) on delete set null,
  created_by        uuid references public.usuarios(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (periodo_id, empleado_id, clave)  -- un ajuste por variable/empleado/período (reemplaza)
);
create index if not exists ix_liq_ajuste_periodo on public.liquidacion_ajuste (periodo_id);

alter table public.liquidacion_ajuste enable row level security;
revoke all on public.liquidacion_ajuste from anon;
drop policy if exists liquidacion_ajuste_gerencia on public.liquidacion_ajuste;
create policy liquidacion_ajuste_gerencia on public.liquidacion_ajuste
  for all to authenticated
  using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());

-- ── RPC de aplicación atómica de ajustes ─────────────────────────────────────
create or replace function public.aplicar_ajustes_liquidacion(
  p_periodo_id uuid,
  p_archivo    text,
  p_hash       text,
  p_motivo     text,
  p_ajustes    jsonb   -- [{empleado_id, tipo, clave, etiqueta, concepto_id, valor_operativo, valor_liquidacion, motivo}]
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_lote uuid;
  v_estado text;
  aj jsonb;
  v_emp uuid;
  v_ant numeric;
  v_total int := 0; v_altas int := 0; v_cambios int := 0; v_errores int := 0;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede aplicar ajustes de liquidación';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('cerrado','exportado') then raise exception 'El período está % : no admite ajustes', v_estado; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_importacion where periodo_id=p_periodo_id and hash=p_hash) then
    raise exception 'Este archivo ya fue reimportado en este período (dedupe por hash)';
  end if;

  insert into public.liquidacion_importacion(periodo_id, archivo, hash, usuario_id)
    values (p_periodo_id, p_archivo, p_hash, v_actor) returning id into v_lote;

  for aj in select * from jsonb_array_elements(p_ajustes) loop
    v_total := v_total + 1;
    v_emp := nullif(aj->>'empleado_id','')::uuid;
    if v_emp is null or nullif(aj->>'clave','') is null then v_errores := v_errores + 1; continue; end if;

    select valor_liquidacion into v_ant from public.liquidacion_ajuste
      where periodo_id=p_periodo_id and empleado_id=v_emp and clave=(aj->>'clave');

    insert into public.liquidacion_ajuste(periodo_id, empleado_id, tipo, clave, etiqueta, concepto_id,
                                          valor_operativo, valor_liquidacion, origen, motivo, lote_id, created_by)
      values (p_periodo_id, v_emp, coalesce(nullif(aj->>'tipo',''),'variable'), aj->>'clave', nullif(aj->>'etiqueta',''),
              nullif(aj->>'concepto_id','')::uuid,
              nullif(aj->>'valor_operativo','')::numeric, nullif(aj->>'valor_liquidacion','')::numeric,
              'excel_reimport', coalesce(nullif(aj->>'motivo',''), p_motivo), v_lote, v_actor)
      on conflict (periodo_id, empleado_id, clave) do update
        set valor_operativo = excluded.valor_operativo,
            valor_liquidacion = excluded.valor_liquidacion,
            etiqueta = excluded.etiqueta,
            motivo = excluded.motivo,
            lote_id = excluded.lote_id,
            created_by = excluded.created_by,
            updated_at = now();

    if v_ant is null then v_altas := v_altas + 1; else v_cambios := v_cambios + 1; end if;

    insert into public.liquidacion_auditoria(periodo_id, empleado_id, concepto_id, codigo, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, nullif(aj->>'concepto_id','')::uuid, aj->>'clave',
              v_ant, nullif(aj->>'valor_liquidacion','')::numeric, 'ajuste_excel', v_lote, v_actor,
              coalesce(nullif(aj->>'motivo',''), p_motivo));
  end loop;

  update public.liquidacion_importacion set filas_total=v_total, filas_aplicadas=(v_altas+v_cambios), filas_error=v_errores where id=v_lote;
  return jsonb_build_object('lote', v_lote, 'total', v_total, 'altas', v_altas, 'cambios', v_cambios, 'errores', v_errores);
end;
$fn$;
revoke all on function public.aplicar_ajustes_liquidacion(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.aplicar_ajustes_liquidacion(uuid,text,text,text,jsonb) to authenticated;
