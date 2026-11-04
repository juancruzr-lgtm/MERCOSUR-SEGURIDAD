-- Facturación: seguro de períodos y operaciones en curso.
--  1) Se factura el MES VENCIDO. El mes en curso y los futuros se pueden consultar, pero la base
--     no acepta horas, ni genera, recalcula, aprueba o emite prefacturas de esos meses. La regla
--     vive en triggers sobre fact_horas_aprobaciones y fact_prefacturas: vale para la pantalla, la
--     API y cualquier llamada directa a las funciones (no se puede saltear cambiando el mes).
--     Se permite siempre descartar una prefactura y anular una aprobación.
--  2) Excepción gerencial: sólo Gerencia, con motivo obligatorio y vencimiento (1 a 24 h), queda en
--     fact_historial y se puede revocar.
--  3) Operaciones en curso (recálculos): no se puede lanzar otra equivalente sobre el mismo período
--     mientras una está en curso; si una no termina en 10 minutos queda "sin confirmar" (resultado
--     desconocido) y hay que revisar antes de relanzar.
-- El mes se calcula en hora de Argentina. No modifica datos existentes.
-- Rollback: supabase/rollback/20261204120000_facturacion_seguro_periodo_rollback.sql

-- ── Mes actual (Argentina) y regla ───────────────────────────────────────────
create or replace function public.fact_mes_actual()
returns text language sql stable set search_path = public, pg_catalog as $fn$
  select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')
$fn$;

create table if not exists public.fact_periodo_excepciones (
  id            uuid primary key default gen_random_uuid(),
  mes           text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  motivo        text not null check (length(trim(motivo)) >= 15),
  otorgada_por  uuid not null references public.usuarios(id),
  otorgada_at   timestamptz not null default now(),
  vence_at      timestamptz not null,
  revocada_por  uuid references public.usuarios(id),
  revocada_at   timestamptz,
  revocada_motivo text,
  check (vence_at > otorgada_at and vence_at <= otorgada_at + interval '24 hours')
);
create index if not exists ix_fact_periodo_excepciones_mes on public.fact_periodo_excepciones (mes, vence_at desc);

create or replace function public.fact_periodo_escritura_habilitada(p_mes text)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select p_mes < public.fact_mes_actual()
      or exists (select 1 from public.fact_periodo_excepciones e
                  where e.mes = p_mes and e.revocada_at is null and e.vence_at > now())
$fn$;

-- ── Triggers: la base no acepta escrituras de facturación en un mes no vencido ──
create or replace function public.fact_periodo_proteger()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_mes text;
begin
  if tg_table_name = 'fact_prefacturas' then
    -- Descartar siempre se puede (no factura nada).
    if tg_op = 'UPDATE' and new.estado = 'descartada' then return new; end if;
    v_mes := coalesce(new.periodo_mes, to_char(new.periodo_hasta_excl - 1, 'YYYY-MM'));
  else
    -- Anular una aprobación siempre se puede.
    if tg_op = 'UPDATE' and new.estado <> 'aprobada' then return new; end if;
    -- Mes de facturación = el del último día del período comercial (calendario o corte).
    v_mes := to_char(new.periodo_hasta_excl - 1, 'YYYY-MM');
  end if;
  if public.fact_periodo_escritura_habilitada(v_mes) then return new; end if;
  raise exception 'Período protegido: % no está vencido (mes actual %). Se puede consultar, pero no aceptar horas, generar, recalcular, aprobar ni emitir. Gerencia puede habilitarlo con una excepción con motivo.',
    v_mes, public.fact_mes_actual() using errcode = '42501';
end $fn$;

drop trigger if exists fact_periodo_proteger on public.fact_horas_aprobaciones;
create trigger fact_periodo_proteger before insert or update on public.fact_horas_aprobaciones
  for each row execute function public.fact_periodo_proteger();
drop trigger if exists fact_periodo_proteger on public.fact_prefacturas;
create trigger fact_periodo_proteger before insert or update on public.fact_prefacturas
  for each row execute function public.fact_periodo_proteger();

-- ── Excepción gerencial (motivo, vencimiento y auditoría) ───────────────────
create or replace function public.fact_periodo_excepcion_otorgar(p_mes text, p_motivo text, p_horas integer default 4)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_vence timestamptz;
begin
  if not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia puede habilitar un período en curso o futuro' using errcode = '42501'; end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  if p_mes < public.fact_mes_actual() then raise exception 'El período % ya está vencido: no necesita excepción', p_mes; end if;
  if length(trim(coalesce(p_motivo, ''))) < 15 then raise exception 'Indicá el motivo de la excepción (al menos 15 caracteres)'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 24 then raise exception 'La excepción dura entre 1 y 24 horas'; end if;
  v_vence := now() + make_interval(hours => p_horas);
  insert into public.fact_periodo_excepciones (mes, motivo, otorgada_por, vence_at) values (p_mes, trim(p_motivo), v_actor, v_vence) returning id into v_id;
  perform public.fact_registrar('periodo', v_id, 'excepcion_otorgada', jsonb_build_object('mes', p_mes, 'motivo', trim(p_motivo), 'vence_at', v_vence, 'mes_actual', public.fact_mes_actual()), v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_periodo_excepcion_revocar(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia puede revocar la excepción' using errcode = '42501'; end if;
  update public.fact_periodo_excepciones set revocada_por = v_actor, revocada_at = now(), revocada_motivo = nullif(trim(p_motivo), '')
   where id = p_id and revocada_at is null;
  if not found then raise exception 'La excepción no existe o ya estaba revocada'; end if;
  perform public.fact_registrar('periodo', p_id, 'excepcion_revocada', jsonb_build_object('motivo', p_motivo), v_actor);
end $fn$;

-- Estado del período para la pantalla (sólo lectura).
create or replace function public.fact_periodo_estado(p_mes text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_exc jsonb;
begin
  if not public.facturacion_puede_actual() then raise exception 'Sólo Gerencia o Administración' using errcode = '42501'; end if;
  v_exc := (select jsonb_build_object('id', e.id, 'mes', e.mes, 'motivo', e.motivo, 'vence_at', e.vence_at,
                   'otorgada_por_nombre', trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')))
              from public.fact_periodo_excepciones e left join public.usuarios u on u.id = e.otorgada_por
             where e.mes = p_mes and e.revocada_at is null and e.vence_at > now() order by e.vence_at desc limit 1);
  return jsonb_build_object('mes', p_mes, 'mes_actual', public.fact_mes_actual(),
    'estado', case when p_mes < public.fact_mes_actual() then 'vencido' when p_mes = public.fact_mes_actual() then 'en_curso' else 'futuro' end,
    'habilitado', public.fact_periodo_escritura_habilitada(p_mes), 'excepcion', v_exc, 'es_gerencia', public.puede_acceder_gerencia_actual());
end $fn$;

-- ── Operaciones en curso (recálculos) ───────────────────────────────────────
create table if not exists public.fact_operaciones (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('recalculo_mes', 'recalculo_contrato')),
  mes           text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  contrato_id   uuid references public.fact_contratos(id),
  estado        text not null default 'en_curso' check (estado in ('en_curso', 'terminada', 'fallida', 'sin_confirmar')),
  iniciada_por  uuid not null references public.usuarios(id),
  iniciada_at   timestamptz not null default now(),
  terminada_at  timestamptz,
  resultado     jsonb,
  check ((tipo = 'recalculo_contrato') = (contrato_id is not null))
);
create index if not exists ix_fact_operaciones_mes on public.fact_operaciones (mes, iniciada_at desc);
-- Dos recálculos del mes completo a la vez: imposible aun con carreras.
create unique index if not exists ux_fact_operaciones_mes_en_curso on public.fact_operaciones (mes) where estado = 'en_curso' and tipo = 'recalculo_mes';

create or replace function public.fact_operacion_iniciar(p_tipo text, p_mes text, p_contrato_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_otra record;
begin
  if p_tipo not in ('recalculo_mes', 'recalculo_contrato') then raise exception 'Operación desconocida'; end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  if not public.fact_periodo_escritura_habilitada(p_mes) then
    raise exception 'Período protegido: % no está vencido (mes actual %)', p_mes, public.fact_mes_actual() using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('fact_operacion:' || p_mes));
  -- Una operación que no terminó en 10 minutos se da por perdida: resultado desconocido.
  update public.fact_operaciones set estado = 'sin_confirmar', terminada_at = now()
   where estado = 'en_curso' and iniciada_at < now() - interval '10 minutes';
  select o.*, trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')) quien into v_otra
    from public.fact_operaciones o left join public.usuarios u on u.id = o.iniciada_por
   where o.estado = 'en_curso' and o.mes = p_mes
     and (p_tipo = 'recalculo_mes' or o.tipo = 'recalculo_mes' or o.contrato_id = p_contrato_id)
   order by o.iniciada_at limit 1;
  if found then
    raise exception 'Ya hay un recálculo de % en curso (lo inició % a las %). Esperá a que termine.', p_mes, nullif(v_otra.quien, ''),
      to_char(v_otra.iniciada_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') using errcode = '55P03';
  end if;
  insert into public.fact_operaciones (tipo, mes, contrato_id, iniciada_por) values (p_tipo, p_mes, p_contrato_id, v_actor) returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.fact_operacion_terminar(p_id uuid, p_estado text, p_resultado jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if p_estado not in ('terminada', 'fallida') then raise exception 'Estado final inválido'; end if;
  update public.fact_operaciones set estado = p_estado, terminada_at = now(), resultado = p_resultado
   where id = p_id and estado in ('en_curso', 'sin_confirmar');
  if not found then raise exception 'La operación no existe o ya terminó'; end if;
end $fn$;

-- ── Permisos: lectura con RLS, escritura sólo por funciones ──────────────────
do $do$
declare t text;
begin
  foreach t in array array['fact_periodo_excepciones', 'fact_operaciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.facturacion_puede_actual())', t || '_lectura', t);
    if to_regprocedure('public.acceso_habilitado_actual()') is not null then
      execute format('drop policy if exists acceso_bloqueado_baja on public.%I', t);
      execute format('create policy acceso_bloqueado_baja on public.%I as restrictive for all to authenticated using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()))', t);
    end if;
  end loop;
end
$do$;

revoke all on function public.fact_mes_actual() from public, anon;
grant execute on function public.fact_mes_actual() to authenticated;
-- Interna (la usan los triggers y fact_operacion_iniciar); la pantalla consulta fact_periodo_estado.
revoke all on function public.fact_periodo_escritura_habilitada(text) from public, anon, authenticated;
revoke all on function public.fact_periodo_proteger() from public, anon, authenticated;
revoke all on function public.fact_periodo_excepcion_otorgar(text, text, integer) from public, anon;
grant execute on function public.fact_periodo_excepcion_otorgar(text, text, integer) to authenticated;
revoke all on function public.fact_periodo_excepcion_revocar(uuid, text) from public, anon;
grant execute on function public.fact_periodo_excepcion_revocar(uuid, text) to authenticated;
revoke all on function public.fact_periodo_estado(text) from public, anon;
grant execute on function public.fact_periodo_estado(text) to authenticated;
revoke all on function public.fact_operacion_iniciar(text, text, uuid) from public, anon;
grant execute on function public.fact_operacion_iniciar(text, text, uuid) to authenticated;
revoke all on function public.fact_operacion_terminar(uuid, text, jsonb) from public, anon;
grant execute on function public.fact_operacion_terminar(uuid, text, jsonb) to authenticated;
