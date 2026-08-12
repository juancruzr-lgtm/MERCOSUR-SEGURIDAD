-- ============================================================================
-- VERIFICACIÓN FUNCIONAL · 20260813100000_ronda_puntos_auditoria
-- ============================================================================
-- Ejecuta los siete casos acordados sobre un punto REAL y revierte todo.
--
-- CÓMO SE LEE EL RESULTADO — el script SIEMPRE termina en error, a propósito:
--
--   "ROLLBACK INTENCIONAL — VERIFICACIÓN FUNCIONAL OK (10/10)"  → pasó todo.
--   "FALLO n: ..."                                              → falló ese caso.
--
-- Abortar con una excepción es lo que garantiza que nada quede guardado, sin
-- depender de cómo maneje la transacción el editor SQL.
--
-- Ejecutar entero, de una sola vez, en el editor SQL (rol postgres).
--
-- Dos notas de método:
--   * Sin auth.uid(), rondas_usuario_actual_id() devuelve null y modificado_por
--     queda en null. Es el comportamiento esperado, y por eso esa columna es
--     nullable.
--   * `created_at` usa now(), que es el reloj de la TRANSACCIÓN: todas las filas
--     escritas por este script comparten timestamp. Por eso cada caso se aísla
--     comparando IDs contra los ya vistos, no por orden temporal.
-- ============================================================================

begin;

do $$
declare
  v_punto    public.ronda_puntos;
  v_otro_id  uuid;
  v_vistos   uuid[];
  v_nuevos   integer;
  v_origen   text;
  v_firma    text;
  v_campo    text;
  v_campos   text[];
  v_lat0     double precision;
  v_lon0     double precision;
begin
  -- Punto de prueba: activo, con GPS completo.
  select rp.* into v_punto
  from public.ronda_puntos rp
  where rp.activo
    and rp.gps_requerido
    and rp.latitud is not null
    and rp.longitud is not null
    and rp.radio_metros is not null
  order by rp.updated_at desc
  limit 1;

  if not found then
    raise exception 'No hay ningún punto activo con GPS completo para probar';
  end if;

  v_lat0 := v_punto.latitud;
  v_lon0 := v_punto.longitud;
  raise notice 'Punto de prueba: % (%)', v_punto.nombre, v_punto.id;

  v_vistos := array(
    select id from public.ronda_puntos_auditoria where ronda_punto_id = v_punto.id
  );

  -- ── CASO 1 · Cambio manual → origen = 'manual', sin firma ────────────────
  update public.ronda_puntos
  set radio_metros = radio_metros + 7
  where id = v_punto.id;

  select count(*), min(campo), min(origen), min(firma)
  into v_nuevos, v_campo, v_origen, v_firma
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);

  if v_nuevos <> 1 then raise exception 'FALLO 1: se esperaba 1 fila, hubo %', v_nuevos; end if;
  if v_campo <> 'radio_metros' then raise exception 'FALLO 1: campo = %', v_campo; end if;
  if v_origen <> 'manual' then raise exception 'FALLO 1: origen = %', v_origen; end if;
  if v_firma is not null then raise exception 'FALLO 1: un cambio manual trajo firma'; end if;
  raise notice 'OK 1 · cambio manual auditado como manual, sin firma';

  -- ── CASO 3a · El contexto no persiste (caso sin contexto) ────────────────
  perform 1 from public.ronda_puntos
  where id = v_punto.id
    and (ctx_cambio_origen is not null or ctx_cambio_firma is not null);
  if found then raise exception 'FALLO 3a: quedó contexto persistido'; end if;

  v_vistos := array(
    select id from public.ronda_puntos_auditoria where ronda_punto_id = v_punto.id
  );

  -- ── CASO 2 · Cambio desde sugerencia → origen + firma ────────────────────
  update public.ronda_puntos
  set radio_metros      = radio_metros + 5,
      ctx_cambio_origen = 'diagnostico_gps',
      ctx_cambio_firma  = 'dg1:0123456789abcdef0123456789abcdef'
  where id = v_punto.id;

  select count(*), min(origen), min(firma)
  into v_nuevos, v_origen, v_firma
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);

  if v_nuevos <> 1 then raise exception 'FALLO 2: se esperaba 1 fila, hubo %', v_nuevos; end if;
  if v_origen <> 'diagnostico_gps' then raise exception 'FALLO 2: origen = %', v_origen; end if;
  if v_firma is distinct from 'dg1:0123456789abcdef0123456789abcdef' then
    raise exception 'FALLO 2: firma no registrada (%)', coalesce(v_firma, 'null');
  end if;
  raise notice 'OK 2 · sugerencia auditada con origen y firma';

  -- ── CASO 3b · El contexto se limpia también cuando SÍ se usó ─────────────
  perform 1 from public.ronda_puntos
  where id = v_punto.id
    and (ctx_cambio_origen is not null or ctx_cambio_firma is not null);
  if found then raise exception 'FALLO 3b: el contexto usado quedó persistido'; end if;
  raise notice 'OK 3 · ctx_cambio_* siempre en NULL, se use o no';

  v_vistos := array(
    select id from public.ronda_puntos_auditoria where ronda_punto_id = v_punto.id
  );

  -- ── CASO 5 · Campo no sensible → sin auditoría ───────────────────────────
  update public.ronda_puntos
  set nombre      = nombre || ' (prueba)',
      descripcion = 'prueba de auditoría'
  where id = v_punto.id;

  select count(*) into v_nuevos
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);
  if v_nuevos <> 0 then raise exception 'FALLO 5: un cambio no sensible generó % fila(s)', v_nuevos; end if;
  raise notice 'OK 5 · cambio no sensible no audita';

  -- ── CASO 6 · Varios campos sensibles → una fila por campo ────────────────
  update public.ronda_puntos
  set latitud       = v_lat0 + 0.01,
      longitud      = v_lon0 + 0.01,
      radio_metros  = radio_metros + 3,
      gps_requerido = false,
      nombre        = nombre || ' x'
  where id = v_punto.id;

  select count(*), array_agg(campo order by campo)
  into v_nuevos, v_campos
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);

  if v_nuevos <> 4 then
    raise exception 'FALLO 6: se esperaban 4 filas, hubo % (%)',
      v_nuevos, array_to_string(v_campos, ',');
  end if;
  if v_campos is distinct from array['gps_requerido','latitud','longitud','radio_metros'] then
    raise exception 'FALLO 6: campos auditados = %', array_to_string(v_campos, ',');
  end if;
  raise notice 'OK 6 · una fila por campo sensible modificado, ninguna por el resto';

  v_vistos := array(
    select id from public.ronda_puntos_auditoria where ronda_punto_id = v_punto.id
  );

  -- ── CASO 4 · UPDATE que falla no deja auditoría huérfana ─────────────────
  begin
    -- radio_metros <= 0 viola ronda_puntos_radio_valido, que se evalúa DESPUÉS
    -- de los BEFORE triggers: la auditoría ya se escribió y debe desaparecer.
    update public.ronda_puntos
    set radio_metros = -5,
        latitud      = v_lat0 + 0.02
    where id = v_punto.id;
    raise exception 'FALLO 4: el UPDATE inválido no falló';
  exception
    when check_violation then
      null;  -- esperado
  end;

  select count(*) into v_nuevos
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);
  if v_nuevos <> 0 then raise exception 'FALLO 4: quedaron % filas huérfanas', v_nuevos; end if;
  raise notice 'OK 4 · UPDATE fallido no deja auditoría';

  -- ── CASO 7a · Trigger de política de foto intacto ────────────────────────
  -- Se INVIERTE el valor actual en vez de fijar uno: si el punto ya venía con
  -- foto_requerida = false (o con politica_foto = 'solo_novedad'), fijar false
  -- no cambiaría nada y la prueba pasaría o fallaría por la razón equivocada.
  update public.ronda_puntos
  set foto_requerida = not foto_requerida
  where id = v_punto.id;

  select rp.* into v_punto from public.ronda_puntos rp where rp.id = v_punto.id;
  if v_punto.politica_foto is distinct from
     (case when v_punto.foto_requerida then 'obligatoria' else 'opcional' end) then
    raise exception 'FALLO 7a: política de foto no se sincronizó (foto_requerida=%, politica_foto=%)',
      v_punto.foto_requerida, v_punto.politica_foto;
  end if;

  select count(*) into v_nuevos
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);
  if v_nuevos <> 0 then raise exception 'FALLO 7a: la política de foto generó auditoría'; end if;
  raise notice 'OK 7a · política de foto sigue sincronizando y no audita';

  -- ── CASO 7b · Trigger anti-duplicado intacto ─────────────────────────────
  insert into public.ronda_puntos (
    ronda_base_id, nombre, orden, gps_requerido, latitud, longitud,
    radio_metros, activo
  )
  select v_punto.ronda_base_id, 'PRUEBA duplicado',
         coalesce(max(rp.orden), 0) + 1, true,
         v_lat0 + 0.05, v_lon0 + 0.05, 30, true
  from public.ronda_puntos rp
  where rp.ronda_base_id = v_punto.ronda_base_id
  returning id into v_otro_id;

  begin
    update public.ronda_puntos
    set latitud = v_lat0 + 0.05, longitud = v_lon0 + 0.05
    where id = v_punto.id;
    raise exception 'FALLO 7b: el anti-duplicado no bloqueó el movimiento';
  exception
    when check_violation then
      null;  -- esperado: ronda_punto_duplicado
  end;

  select count(*) into v_nuevos
  from public.ronda_puntos_auditoria
  where ronda_punto_id = v_punto.id and id <> all(v_vistos);
  if v_nuevos <> 0 then raise exception 'FALLO 7b: el movimiento bloqueado dejó auditoría'; end if;
  raise notice 'OK 7b · anti-duplicado sigue funcionando y aborta antes de auditar';

  -- ── EXTRA · Contexto mal formado se rechaza ──────────────────────────────
  begin
    update public.ronda_puntos
    set radio_metros = radio_metros + 1, ctx_cambio_origen = 'inventado'
    where id = v_punto.id;
    raise exception 'FALLO extra: se aceptó un origen desconocido';
  exception
    when check_violation then null;
  end;

  begin
    update public.ronda_puntos
    set radio_metros = radio_metros + 1, ctx_cambio_origen = 'diagnostico_gps'
    where id = v_punto.id;
    raise exception 'FALLO extra: se aceptó una sugerencia sin firma';
  exception
    when check_violation then null;
  end;

  begin
    update public.ronda_puntos
    set radio_metros = radio_metros + 1, ctx_cambio_firma = 'dg1:algo'
    where id = v_punto.id;
    raise exception 'FALLO extra: se aceptó una firma sin origen';
  exception
    when check_violation then null;
  end;
  raise notice 'OK extra · contexto mal formado rechazado en las tres variantes';

  -- ── Cierre ───────────────────────────────────────────────────────────────
  -- Se aborta A PROPÓSITO. El `rollback` del final ya alcanzaría, pero algunos
  -- editores SQL manejan la transacción por su cuenta y podrían no respetarlo.
  -- Con esta excepción, el descarte no depende del cliente: si el script llegó
  -- hasta acá, los diez casos pasaron.
  raise exception 'ROLLBACK INTENCIONAL — VERIFICACIÓN FUNCIONAL OK (10/10). Nada quedó guardado.'
    using errcode = 'raise_exception';
end;
$$;

rollback;
