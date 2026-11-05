-- ============================================================================
-- Seguridad — montos de liquidación expuestos por RPC (auditoría 05/11/2026)
-- ============================================================================
-- Cuatro funciones SECURITY DEFINER devolvían montos de sueldos SIN ningún
-- control de permisos, y `authenticated` las puede ejecutar. Cualquier usuario
-- con sesión (supervisores de todo tipo y también vigiladores) podía pedir por
-- /rest/v1/rpc/... el sueldo o las extras de cualquier empleado:
--
--   sueldo_mensual_vigente(usuario, mes)            sueldo mensual fijo
--   extra_mensual_vigente(usuario, mes)             extra mensual fija
--   liquidacion_final_extras_pagadas(empleado, mes) extras pagadas por banco
--   liquidacion_final_ya_liquidado(cuil, mes)       conceptos e importes enviados a Visual
--
-- Las tablas que leen (liquidacion_sueldo_mensual, liquidacion_extra_mensual,
-- liquidacion_pago_registrado, liquidacion_enviado_visual) ya exigen
-- puede_liquidar_actual() por RLS; las funciones la salteaban por ser
-- SECURITY DEFINER.
--
-- CORRECCIÓN: las cuatro exigen el mismo permiso que esas tablas
-- (puede_liquidar_actual = Gerencia o puesto Administración) mediante
-- liquidacion_montos_gate(). Sin usuario de la app (auth.uid() nulo:
-- service_role, postgres, pg_cron) siguen respondiendo como antes.
--
-- QUÉ NO CAMBIA
--   * Firma, tipo de retorno, volatilidad (STABLE), SECURITY DEFINER y
--     search_path. El resultado para Administración y Gerencia es el mismo.
--   * Las llamadas internas desde liquidacion_final_exportar y
--     pagos_banco_por_usuario: ya exigen ese permiso, así que pasan igual.
--   * Pantalla: lib/liquidacion-final-datos.ts (Administración/Gerencia) llama a
--     liquidacion_final_ya_liquidado y liquidacion_final_extras_pagadas: sigue
--     funcionando para esos perfiles.
--   * El lenguaje pasa de sql a plpgsql para poder cortar con un error
--     explícito (42501) antes de leer.
--
-- PRECONDICIÓN: la migración aborta si la definición viva de alguna de las
-- cuatro cambió desde la auditoría (md5 de prosrc).
--
-- Rollback: supabase/rollback/20261206100000_seguridad_montos_liquidacion_gate_rollback.sql
-- Verificación: supabase/pruebas/seguridad-montos/verificacion-seguridad-montos.sql
-- ============================================================================

begin;

do $pre$
declare
  v_esperado constant jsonb := jsonb_build_object(
    'sueldo_mensual_vigente(uuid,text)',           '5b58db0f469964991d5a446560b69419',
    'extra_mensual_vigente(uuid,text)',            '72b66f4b5f47d256188ffb29437c30a9',
    'liquidacion_final_extras_pagadas(uuid,text)', 'd2cefe6bda4f64d0a8853ae3fdc29d96',
    'liquidacion_final_ya_liquidado(text,text)',   '0a54da87cab88633096f9b02e8ffd9a0');
  v_firma text;
  v_md5   text;
begin
  if to_regprocedure('public.puede_liquidar_actual()') is null then
    raise exception 'falta puede_liquidar_actual(): no se aplica';
  end if;
  for v_firma in select jsonb_object_keys(v_esperado) loop
    v_md5 := (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || v_firma));
    if v_md5 is distinct from v_esperado->>v_firma then
      raise exception 'seguridad montos: % cambió desde la auditoría (md5 %, esperado %); revisar antes de aplicar',
        v_firma, coalesce(v_md5, 'inexistente'), v_esperado->>v_firma;
    end if;
  end loop;
end $pre$;

-- ── Gate común ──────────────────────────────────────────────────────────────
create or replace function public.liquidacion_montos_gate()
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  -- Sin usuario de la app (service_role, postgres, pg_cron): sin cambios.
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia o Administración' using errcode = '42501';
  end if;
end;
$function$;

comment on function public.liquidacion_montos_gate() is
  'Corta con 42501 si hay un usuario de la app sin puede_liquidar_actual(). Lo usan las funciones que devuelven montos de liquidación.';

revoke all on function public.liquidacion_montos_gate() from public, anon, authenticated;
grant execute on function public.liquidacion_montos_gate() to service_role;

-- ── sueldo_mensual_vigente ──────────────────────────────────────────────────
create or replace function public.sueldo_mensual_vigente(p_usuario_id uuid, p_mes text)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.liquidacion_montos_gate();
  return (
    select sm.importe
      from public.liquidacion_sueldo_mensual sm
     where sm.usuario_id = p_usuario_id
       and sm.vigencia_desde <= (date_trunc('month', (p_mes || '-01')::date) + interval '1 month - 1 day')::date
       and (sm.vigencia_hasta is null or sm.vigencia_hasta >= (p_mes || '-01')::date)
     order by sm.vigencia_desde desc
     limit 1);
end;
$function$;

-- ── extra_mensual_vigente ───────────────────────────────────────────────────
create or replace function public.extra_mensual_vigente(p_usuario_id uuid, p_mes text)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.liquidacion_montos_gate();
  return (
    select em.importe
      from public.liquidacion_extra_mensual em
     where em.usuario_id = p_usuario_id
       and em.vigencia_desde <= (date_trunc('month', (p_mes || '-01')::date) + interval '1 month - 1 day')::date
       and (em.vigencia_hasta is null or em.vigencia_hasta >= (p_mes || '-01')::date)
     order by em.vigencia_desde desc
     limit 1);
end;
$function$;

-- ── liquidacion_final_extras_pagadas ────────────────────────────────────────
create or replace function public.liquidacion_final_extras_pagadas(p_empleado_id uuid, p_mes text)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.liquidacion_montos_gate();
  return (
    select round(coalesce(sum(r.importe), 0), 2)
      from public.liquidacion_pago_registrado r
      join public.liquidacion_pago_lote l on l.id = r.lote_id and l.anulado_at is null
      join public.liquidacion_periodo p on p.id = r.periodo_id
     where r.tipo = 'extras' and r.usuario_id = p_empleado_id and p.mes = p_mes);
end;
$function$;

-- ── liquidacion_final_ya_liquidado ──────────────────────────────────────────
create or replace function public.liquidacion_final_ya_liquidado(p_cuil text, p_mes text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.liquidacion_montos_gate();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'cantidad', x.cantidad, 'importe', x.importe) order by x.codigo), '[]'::jsonb)
      from (select e.codigo, sum(coalesce(e.cantidad, 0)) as cantidad, round(sum(coalesce(e.importe, 0)), 2) as importe
              from public.liquidacion_enviado_visual e
              join public.liquidacion_periodo p on p.id = e.periodo_id
             where p.mes = p_mes and p.estado in ('exportada', 'liquidada')
               and regexp_replace(coalesce(e.cuil, ''), '\D', '', 'g') = p_cuil
             group by e.codigo) x);
end;
$function$;

-- ── Permisos explícitos (iguales a los vivos, sin PUBLIC ni anon) ───────────
revoke all on function public.sueldo_mensual_vigente(uuid, text) from public, anon;
revoke all on function public.extra_mensual_vigente(uuid, text) from public, anon;
revoke all on function public.liquidacion_final_extras_pagadas(uuid, text) from public, anon;
revoke all on function public.liquidacion_final_ya_liquidado(text, text) from public, anon;
grant execute on function public.sueldo_mensual_vigente(uuid, text) to authenticated, service_role;
grant execute on function public.extra_mensual_vigente(uuid, text) to authenticated, service_role;
grant execute on function public.liquidacion_final_extras_pagadas(uuid, text) to authenticated, service_role;
grant execute on function public.liquidacion_final_ya_liquidado(text, text) to authenticated, service_role;

commit;
