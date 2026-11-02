-- ============================================================================
-- SIN APLICAR — WhatsApp: reclamo atómico por clave estable, topes y reintentos
-- ============================================================================
-- Contexto (auditoría oct-2026, ver docs/auditoria-2026-10/whatsapp_causa_raiz.md):
--   · 07/10: la lectura de dedup de rondas falló y su error se ignoraba; cada
--     corrida del cron (cada 10') reenvió las alertas ya avisadas hasta morir por
--     maxDuration (60 s) y nunca llegó al insert de auditoría del final.
--   · c67fa6d (07/10) agregó claim-first sobre notificaciones_enviadas; el
--     cambio 20261115120000 agregó la auditoría ANTES de enviar. Quedaban:
--       - un fallo del proveedor después del claim no se reintentaba nunca
--         (escalamiento) o se reintentaba cada 5' sin límite (vigilador);
--       - el tope diario se leía y se comparaba en la app (dos corridas
--         simultáneas podían pasarse);
--       - no había tope por evento ni control, al momento de enviar, de que la
--         alerta siguiera sin intervenir.
--
-- Qué agrega (sin tocar datos existentes):
--   1) escalamiento_whatsapp_envios: clave_envio, intento, reintentable,
--      completado_at. NULL en el historial.
--   2) Índice ÚNICO (clave_envio, intento): dos corridas no pueden reclamar el
--      mismo intento del mismo envío. La clave es estable:
--        wa|<etapa>|<evento>|<destinatario>
--      (canal, etapa = nivel, evento = ronda_alerta:<id> / turno:<id>).
--   3) reclamar_envio_whatsapp(...): bajo advisory lock por destinatario y por
--      clave, decide si se puede enviar y, si sí, inserta la fila 'reclamado'
--      (ON CONFLICT DO NOTHING) ANTES de llamar a Meta. Devuelve jsonb
--      {ok, id, intento} o {ok:false, motivo}. Motivos:
--        sin_clave · sin_destinatario · intervenida · cerrada · ya_enviado ·
--        en_curso_o_incierto (fila 'reclamado' sin resultado: la corrida murió
--        y el mensaje PUDO haber salido → no se reintenta) · fallo_definitivo ·
--        agotado · esperando_reintento · tope_destinatario · tope_evento ·
--        ya_reclamada (perdió la carrera del índice único).
--   4) completar_envio_whatsapp(...): sólo completa filas 'reclamado'
--      (idempotente), con resultado enviado / fallido y si es reintentable.
--   Reintento: backoff exponencial p_backoff_min · 2^(fallidos-1), máximo
--   p_max_intentos intentos por clave.
--
-- NO cambia: notificaciones_enviadas (se sigue escribiendo como marca de
-- compatibilidad), ni el nivel CHECK, ni ningún dato de fichajes/turnos/horas.
-- Permisos: sólo service_role (las rutas del cron). anon/authenticated no.
--
-- Orden de despliegue: MIGRACIÓN ANTES QUE EL CÓDIGO. Si el código llega
-- primero, la RPC no existe → reclamarEnvio devuelve error_rpc → NO se envía
-- ningún WhatsApp (fail-closed). Nunca hay envíos de más.
-- Rollback: supabase/rollback/20261121120000_whatsapp_envios_reclamo_reintentos_rollback.sql
-- Pruebas:  supabase/pruebas/whatsapp-envios/run.mjs (PGlite)
-- ============================================================================

alter table public.escalamiento_whatsapp_envios
  add column if not exists clave_envio text,
  add column if not exists intento smallint,
  add column if not exists reintentable boolean,
  add column if not exists completado_at timestamptz;

create unique index if not exists escalamiento_envios_clave_intento_key
  on public.escalamiento_whatsapp_envios (clave_envio, intento)
  where clave_envio is not null;

create index if not exists escalamiento_envios_destinatario_fecha_idx
  on public.escalamiento_whatsapp_envios (destinatario_id, created_at desc)
  where destinatario_id is not null;

create or replace function public.reclamar_envio_whatsapp(
  p_clave text,
  p_fila jsonb,
  p_max_intentos integer default 3,
  p_backoff_min integer default 10,
  p_tope_destinatario_dia integer default null,
  p_tope_evento integer default null,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $f$
declare
  v_dest uuid := nullif(p_fila->>'destinatario_id', '')::uuid;
  v_alerta uuid := nullif(p_fila->>'ronda_alerta_id', '')::uuid;
  v_nivel text := p_fila->>'nivel';
  v_alerta_row jsonb;
  v_n_fallidos integer;
  v_ultimo record;
  v_cuenta integer;
  v_inicio_dia timestamptz;
  v_id uuid;
  v_intento integer;
begin
  if p_clave is null or length(p_clave) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_clave');
  end if;
  if v_dest is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_destinatario');
  end if;

  -- Serializa a todas las corridas que quieren escribirle a este destinatario
  -- (topes) y a esta clave (intentos). Se libera al terminar la transacción.
  perform pg_advisory_xact_lock(hashtext('wa_dest:' || v_dest::text));
  perform pg_advisory_xact_lock(hashtext('wa_clave:' || p_clave));

  -- La alerta tiene que seguir pendiente y sin intervención AHORA (no cuando la
  -- corrida la leyó). to_jsonb evita depender de que 20261115120000 esté
  -- aplicada (resultado_intervencion puede no existir).
  if v_alerta is not null then
    select to_jsonb(a) into v_alerta_row from public.ronda_alertas a where a.id = v_alerta;
    if v_alerta_row is null or v_alerta_row->>'estado' <> 'pendiente' then
      return jsonb_build_object('ok', false, 'motivo', 'cerrada');
    end if;
    if v_alerta_row->>'accion' is not null or v_alerta_row->>'resultado_intervencion' is not null then
      return jsonb_build_object('ok', false, 'motivo', 'intervenida');
    end if;
  end if;

  if exists (select 1 from public.escalamiento_whatsapp_envios e
             where e.clave_envio = p_clave and e.resultado = 'enviado') then
    return jsonb_build_object('ok', false, 'motivo', 'ya_enviado');
  end if;
  if exists (select 1 from public.escalamiento_whatsapp_envios e
             where e.clave_envio = p_clave and e.resultado = 'reclamado') then
    return jsonb_build_object('ok', false, 'motivo', 'en_curso_o_incierto');
  end if;

  select count(*) into v_n_fallidos from public.escalamiento_whatsapp_envios e
   where e.clave_envio = p_clave and e.resultado = 'fallido';
  if v_n_fallidos > 0 then
    select e.reintentable, coalesce(e.completado_at, e.created_at) as t
      into v_ultimo
      from public.escalamiento_whatsapp_envios e
     where e.clave_envio = p_clave and e.resultado = 'fallido'
     order by e.intento desc nulls last, e.created_at desc limit 1;
    if v_ultimo.reintentable is not true then
      return jsonb_build_object('ok', false, 'motivo', 'fallo_definitivo');
    end if;
    if v_n_fallidos >= greatest(p_max_intentos, 1) then
      return jsonb_build_object('ok', false, 'motivo', 'agotado');
    end if;
    if p_ahora < v_ultimo.t + make_interval(mins => greatest(p_backoff_min, 0) * (2 ^ (v_n_fallidos - 1))::int) then
      return jsonb_build_object('ok', false, 'motivo', 'esperando_reintento',
        'desde', v_ultimo.t + make_interval(mins => greatest(p_backoff_min, 0) * (2 ^ (v_n_fallidos - 1))::int));
    end if;
  end if;

  -- Tope por destinatario y día (hora argentina), enviados o en curso.
  if p_tope_destinatario_dia is not null then
    v_inicio_dia := date_trunc('day', p_ahora at time zone 'America/Argentina/Buenos_Aires')
                    at time zone 'America/Argentina/Buenos_Aires';
    select count(*) into v_cuenta from public.escalamiento_whatsapp_envios e
     where e.destinatario_id = v_dest and e.created_at >= v_inicio_dia
       and e.resultado in ('enviado', 'reclamado')
       and (v_nivel is null or e.nivel = v_nivel);
    if v_cuenta >= p_tope_destinatario_dia then
      return jsonb_build_object('ok', false, 'motivo', 'tope_destinatario');
    end if;
  end if;

  -- Tope por evento (alerta / turno), sumando destinatarios.
  if p_tope_evento is not null then
    select count(*) into v_cuenta from public.escalamiento_whatsapp_envios e
     where e.resultado in ('enviado', 'reclamado') and e.nivel = v_nivel
       and ((v_alerta is not null and e.ronda_alerta_id = v_alerta)
         or (v_alerta is null and e.turno_id = nullif(p_fila->>'turno_id', '')::uuid));
    if v_cuenta >= p_tope_evento then
      return jsonb_build_object('ok', false, 'motivo', 'tope_evento');
    end if;
  end if;

  v_intento := v_n_fallidos + 1;
  insert into public.escalamiento_whatsapp_envios (
    turno_id, objetivo_id, puesto_id, guardia_id, nivel, destinatario_id, telefono, plantilla,
    minutos_descubierto, proveedor, ronda_alerta_id, resultado, clave_envio, intento, created_at)
  values (
    nullif(p_fila->>'turno_id', '')::uuid, nullif(p_fila->>'objetivo_id', '')::uuid,
    nullif(p_fila->>'puesto_id', '')::uuid, nullif(p_fila->>'guardia_id', '')::uuid,
    v_nivel, v_dest, p_fila->>'telefono', p_fila->>'plantilla',
    nullif(p_fila->>'minutos_descubierto', '')::integer, p_fila->>'proveedor', v_alerta,
    'reclamado', p_clave, v_intento, p_ahora)
  on conflict (clave_envio, intento) where clave_envio is not null do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'ya_reclamada');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'intento', v_intento);
end
$f$;

create or replace function public.completar_envio_whatsapp(
  p_id uuid,
  p_ok boolean,
  p_id_proveedor text default null,
  p_error text default null,
  p_reintentable boolean default false,
  p_ahora timestamptz default now()
) returns boolean
language sql
security invoker
set search_path = public, pg_catalog
as $f$
  with u as (
    update public.escalamiento_whatsapp_envios
       set resultado = case when p_ok then 'enviado' else 'fallido' end,
           id_proveedor = p_id_proveedor,
           error = p_error,
           reintentable = case when p_ok then null else coalesce(p_reintentable, false) end,
           completado_at = p_ahora
     where id = p_id and resultado = 'reclamado'
     returning 1)
  select exists (select 1 from u)
$f$;

revoke all on function public.reclamar_envio_whatsapp(text, jsonb, integer, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.completar_envio_whatsapp(uuid, boolean, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.reclamar_envio_whatsapp(text, jsonb, integer, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.completar_envio_whatsapp(uuid, boolean, text, text, boolean, timestamptz) to service_role;

-- Verificación (sólo lectura, después de aplicar):
--   select indexname from pg_indexes where indexname = 'escalamiento_envios_clave_intento_key';
--   select proname, prosecdef from pg_proc where proname in ('reclamar_envio_whatsapp','completar_envio_whatsapp');
--   select has_function_privilege('authenticated', 'public.reclamar_envio_whatsapp(text,jsonb,integer,integer,integer,integer,timestamptz)', 'execute'); -- false
