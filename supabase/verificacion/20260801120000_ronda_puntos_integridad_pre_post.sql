-- VERIFICACIÓN — integridad de puntos de ronda
-- 1. Estructura.
select
  exists (select 1 from information_schema.columns
    where table_name='ronda_puntos' and column_name='posicion_capturada_at') as col_ok,
  to_regprocedure('public.ronda_puntos_no_duplicado()') is not null          as fn_trigger_ok,
  exists (select 1 from pg_trigger where tgname='trg_ronda_puntos_no_duplicado') as trigger_ok,
  to_regprocedure('public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text,timestamptz)') is not null as rpc13_ok;

-- 2. Distancia real (Haversine): dos puntos ~2.2 m deben dar < 3.
select round(public.rondas_distancia_metros(-32.9442000, -60.6505000,
                                            -32.9442200, -60.6505000)::numeric, 2) as dist_aprox_2m; -- ~2.2

-- 3. Coordenadas IGUALES → rechazo (rollback). Esperado: ERROR ronda_punto_duplicado.
begin;
  with rb as (select id from public.rondas_base limit 1)
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
     latitud, longitud, radio_metros, activo, politica_foto)
  select rb.id, 'DUP A', 9001, false, true, -31.4000000, -62.1000000, 30, true, 'opcional' from rb;
  -- Segundo punto con MISMAS coords en la misma ronda → debe fallar el trigger:
  with rb as (select id from public.rondas_base limit 1)
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
     latitud, longitud, radio_metros, activo, politica_foto)
  select rb.id, 'DUP B', 9002, false, true, -31.4000000, -62.1000000, 30, true, 'opcional' from rb;
rollback;

-- 4. Puntos SEPARADOS (> 3 m) → aceptado (rollback, sin error).
begin;
  with rb as (select id from public.rondas_base limit 1)
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
     latitud, longitud, radio_metros, activo, politica_foto)
  select rb.id, 'SEP A', 9101, false, true, -31.4000000, -62.1000000, 30, true, 'opcional' from rb;
  with rb as (select id from public.rondas_base limit 1)
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
     latitud, longitud, radio_metros, activo, politica_foto)
  select rb.id, 'SEP B', 9102, false, true, -31.4005000, -62.1005000, 30, true, 'opcional' from rb; -- ~65 m
rollback;
-- Esperado: 3 falla con ronda_punto_duplicado; 4 no falla.
