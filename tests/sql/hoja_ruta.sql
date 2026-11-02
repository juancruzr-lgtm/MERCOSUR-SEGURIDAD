-- Pruebas de 20261114120000_hoja_ruta_supervisores (Postgres local, termina en ROLLBACK).
\set ON_ERROR_STOP on
begin;
create temp table _ids (k text primary key, v uuid);
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select v from _ids where _ids.k = $1 $$;
create or replace function pg_temp.como(k text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select u.auth_user_id from public.usuarios u where u.id = pg_temp.id(k)))::text, true) $$;
create or replace function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional) values
  (gen_random_uuid(), 'G', 'GERENTE', 'admin', 'activo', 'gerencia'),
  (gen_random_uuid(), 'Aldo', 'MONZON', 'supervisor', 'activo', 'jefe_supervisores'),
  (gen_random_uuid(), 'Rodolfo', 'ROMERO', 'admin', 'activo', 'direccion_operativa'),
  (gen_random_uuid(), 'S', 'SUP', 'supervisor', 'activo', 'supervisor'),
  (gen_random_uuid(), 'V', 'VIGILADOR', 'guardia', 'activo', null) returning id, apellido)
insert into _ids select case apellido when 'GERENTE' then 'ger' when 'MONZON' then 'aldo' when 'ROMERO' then 'rodolfo'
  when 'SUP' then 'sup' else 'vig' end, id from x;
with x as (insert into public.supervisores_guardia (supervisor_id, fecha, hora_inicio, hora_fin, zona, estado)
  values (pg_temp.id('sup'), date '2026-10-29', '07:00', '19:00', 'Rosario', 'activo') returning id)
insert into _ids select 'g', id from x;
insert into public.supervisor_route_points (supervisor_id, client_ts, latitud, longitud, precision_m, turno_supervisor_id, seq)
values (pg_temp.id('sup'), '2026-10-29T12:00Z', -32.9, -60.6, 10, pg_temp.id('g')::text, 1);

do $$ begin
  assert (select value from public.app_config where key = 'hoja_ruta_modo') = 'desactivado';
  assert (select value from public.app_config where key = 'hoja_ruta_margen_cierre_min') = '30';
  assert not has_function_privilege('authenticated', 'public.hoja_ruta_puntos_guardia(uuid)', 'execute'), 'GPS para generar: solo servidor';
  assert not has_table_privilege('authenticated', 'public.hoja_ruta_envios', 'insert');
  assert not has_table_privilege('authenticated', 'public.hojas_ruta', 'update');
  raise notice 'OK 1 - arranca desactivado; generacion y envios solo desde el servidor';
end $$;

do $$ declare e text; begin
  perform pg_temp.como('aldo');
  e := pg_temp.error_de(format('select public.hoja_ruta_destinatario_guardar(%L, true, %L, %L)', pg_temp.id('aldo'), 'Jefe', 'yo'));
  assert e like 'Solo Gerencia%', e;
  perform pg_temp.como('ger');
  e := pg_temp.error_de(format('select public.hoja_ruta_destinatario_guardar(%L, true, %L, %L)', pg_temp.id('vig'), 'x', 'no corresponde'));
  assert e like 'El destinatario debe ser personal de conducci%', e;
  perform public.hoja_ruta_destinatario_guardar(pg_temp.id('aldo'), true, 'Jefe de Supervisores', 'Orden de JC 02/11');
  perform public.hoja_ruta_destinatario_guardar(pg_temp.id('rodolfo'), true, 'Director Técnico', 'Orden de JC 02/11');
  perform public.hoja_ruta_destinatario_guardar(pg_temp.id('aldo'), true, 'Jefe de Supervisores', 'repetido');
  assert (select count(*) from public.hoja_ruta_destinatarios where activo) = 2;
  assert (select count(*) from public.hoja_ruta_destinatarios where creado_por = pg_temp.id('ger') and motivo <> '') = 2, 'auditable';
  raise notice 'OK 2 - destinatarios solo por Gerencia, con motivo y autor, sin duplicar, sin vigiladores';
end $$;

do $$ declare h uuid; e text; begin
  insert into public.hojas_ruta (supervisor_guardia_id, supervisor_id, fecha, inicio, fin, contenido, texto, mensaje, mensaje_variables, mensaje_longitud)
  values (pg_temp.id('g'), pg_temp.id('sup'), date '2026-10-29', '2026-10-29T10:00Z', '2026-10-29T22:00Z', '{}', 'x', 'x', '[]', 1)
  returning id into h;
  insert into _ids values ('h', h);
  -- Una sola hoja por guardia (cron simultáneo).
  e := pg_temp.error_de(format($q$insert into public.hojas_ruta (supervisor_guardia_id, supervisor_id, fecha, inicio, fin, contenido, texto, mensaje, mensaje_variables, mensaje_longitud)
    values (%L, %L, '2026-10-29', now(), now(), '{}', 'x', 'x', '[]', 1)$q$, pg_temp.id('g'), pg_temp.id('sup')));
  assert e like 'duplicate key%', e;
  -- Un solo mensaje por destinatario: con un intento reservado, otra corrida no puede reservar otro.
  insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado) values (h, pg_temp.id('aldo'), 1, 'automatico', 'p', 'enviando');
  e := pg_temp.error_de(format($q$insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado)
    values (%L, %L, 2, 'automatico', 'p', 'enviando')$q$, h, pg_temp.id('aldo')));
  assert e like 'duplicate key%', 'segundo intento vivo: ' || coalesce(e, 'aceptado');
  update public.hoja_ruta_envios set estado = 'enviado', id_proveedor = 'w.a' where hoja_id = h and destinatario_id = pg_temp.id('aldo');
  e := pg_temp.error_de(format($q$insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado)
    values (%L, %L, 2, 'automatico', 'p', 'enviando')$q$, h, pg_temp.id('aldo')));
  assert e like 'duplicate key%', 'ya enviado: ' || coalesce(e, 'aceptado');
  e := pg_temp.error_de(format($q$insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado)
    values (%L, %L, 4, 'automatico', 'p', 'error')$q$, h, pg_temp.id('rodolfo')));
  assert e like '%check%', 'tope de 3 intentos: ' || coalesce(e, 'aceptado');
  raise notice 'OK 3 - una hoja por guardia; un solo mensaje vivo o enviado por destinatario; tope de 3 intentos';
end $$;

do $$ declare h uuid := pg_temp.id('h'); v record; begin
  -- Rodolfo: intento 1 error de Meta, intento 2 enviado y entregado. Aldo: leído.
  insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado, error)
    values (h, pg_temp.id('rodolfo'), 1, 'automatico', 'p', 'error', '(#131026) Message undeliverable');
  insert into public.hoja_ruta_envios (hoja_id, destinatario_id, intento, modo, plantilla, estado, id_proveedor)
    values (h, pg_temp.id('rodolfo'), 2, 'automatico', 'p', 'enviado', 'w.r');
  insert into public.whatsapp_mensaje_estados (id_proveedor, estado, ocurrido_at) values
    ('w.a', 'sent', now() - interval '2 min'), ('w.a', 'delivered', now() - interval '1 min'), ('w.a', 'read', now()),
    ('w.r', 'sent', now() - interval '1 min'), ('w.r', 'delivered', now());
  select * into v from public.hoja_ruta_destinatario_estado where hoja_id = h and destinatario_id = pg_temp.id('aldo');
  assert v.estado_envio = 'enviado' and v.estado_meta = 'read' and v.intentos = 1, row_to_json(v)::text;
  select * into v from public.hoja_ruta_destinatario_estado where hoja_id = h and destinatario_id = pg_temp.id('rodolfo');
  assert v.estado_envio = 'enviado' and v.estado_meta = 'delivered' and v.intentos = 2, row_to_json(v)::text;
  assert (select count(*) from public.hoja_ruta_envios where hoja_id = h) = 3, 'historial completo de intentos';
  raise notice 'OK 4 - Aldo leido; Rodolfo entregado al 2do intento; historial completo';
end $$;

do $$ declare n int; e text; begin
  perform pg_temp.como('aldo');  assert public.hoja_ruta_puede_ver_actual(), 'destinatario ve';
  n := (select count(*) from public.hoja_ruta_recorrido(pg_temp.id('h')));
  assert n = 1, 'destinatario ve el mapa: ' || n;
  perform pg_temp.como('sup');   assert not public.hoja_ruta_puede_ver_actual(), 'el supervisor no recibe copia ni la ve';
  e := pg_temp.error_de(format('select * from public.hoja_ruta_recorrido(%L)', pg_temp.id('h')));
  assert e like 'sin permiso%', e;
  perform pg_temp.como('vig');   assert not public.hoja_ruta_puede_ver_actual(), 'vigilador no ve';
  -- Al dar de baja al destinatario, pierde el acceso.
  perform pg_temp.como('ger');
  perform public.hoja_ruta_destinatario_guardar(pg_temp.id('aldo'), false, null, 'Prueba de baja');
  perform pg_temp.como('aldo');  assert not public.hoja_ruta_puede_ver_actual(), 'baja = sin acceso';
  raise notice 'OK 5 - consulta y mapa: destinatarios activos y lista del legajo; nadie mas';
end $$;

rollback;
