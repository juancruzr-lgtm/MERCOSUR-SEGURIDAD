-- Seed FICTICIO para el entorno PGlite. Nada de esto sale de producción:
-- nombres, DNI, CUIL, emails y coordenadas son inventados.
-- UUID fijos: <tipo>-0000-4000-8000-<n>. Los de auth (sub del JWT) son distintos
-- de usuarios.id, como en producción (usuarios.auth_user_id).
-- Se carga como superusuario (auth.uid() nulo): los triggers de usuarios dejan pasar.

insert into public.zonas_operativas (id, nombre, descripcion) values
  ('20000000-0000-4000-8000-000000000001', 'Zona Norte Ficticia', 'zona de prueba'),
  ('20000000-0000-4000-8000-000000000002', 'Zona Sur Ficticia', 'zona de prueba');

insert into public.usuarios (id, auth_user_id, nombre, apellido, dni, cuil, email, telefono, legajo, rol, puesto_organizacional, cuenta_bancaria, es_prueba) values
  ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Vigilador', 'Ficticio Norte', '00000001', '20-00000001-0', 'vigilador.norte@ejemplo.test', '0000-000001', 'F-001', 'guardia',    'vigilador',         '0000000000000000000001', true),
  ('10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Supervisor', 'Ficticio Norte', '00000002', '20-00000002-0', 'supervisor.norte@ejemplo.test', '0000-000002', 'F-002', 'supervisor', 'supervisor',        null, true),
  ('10000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'Jefa', 'Ficticia Supervisores', '00000003', '27-00000003-0', 'jefa.supervisores@ejemplo.test', '0000-000003', 'F-003', 'supervisor', 'jefe_supervisores', null, true),
  ('10000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 'Admin', 'Ficticia', '00000004', '27-00000004-0', 'administracion@ejemplo.test', '0000-000004', 'F-004', 'admin', 'administracion', null, true),
  ('10000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', 'Gerente', 'Ficticio', '00000005', '20-00000005-0', 'gerencia@ejemplo.test', '0000-000005', 'F-005', 'admin', 'gerencia', null, true),
  -- Sexto perfil: un vigilador que sólo trabaja en la Zona Sur (para probar alcance por zona).
  ('10000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', 'Vigilador', 'Ficticio Sur', '00000006', '20-00000006-0', 'vigilador.sur@ejemplo.test', '0000-000006', 'F-006', 'guardia', 'vigilador', null, true);

insert into public.supervisor_zonas (supervisor_id, zona_id) values
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');

insert into public.objetivos (id, nombre, cliente, zona_id, es_prueba) values
  ('30000000-0000-4000-8000-000000000001', 'Objetivo Ficticio Norte Uno', 'Cliente Ficticio SA', '20000000-0000-4000-8000-000000000001', true),
  ('30000000-0000-4000-8000-000000000002', 'Objetivo Ficticio Sur Uno', 'Cliente Ficticio SA', '20000000-0000-4000-8000-000000000002', true),
  ('30000000-0000-4000-8000-000000000003', 'Objetivo Ficticio Sur Dos', 'Otro Cliente Ficticio SRL', '20000000-0000-4000-8000-000000000002', true);

insert into public.puestos (id, objetivo_id, nombre, orden) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Principal', 1),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Principal', 1),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'Principal', 1);

insert into public.turnos (id, guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, publicado) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', date '2026-11-02', '08:00', '20:00', 'cubierto', true),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', date '2026-11-02', '08:00', '20:00', 'cubierto', true),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', date '2026-11-03', '08:00', '20:00', 'programado', true);

insert into public.registros_asistencia (id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, tipo_registro, latitud_ingreso, longitud_ingreso) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '08:02', '20:01', 'fichaje_gps', -34.0, -58.0),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', '07:58', '20:00', 'fichaje_gps', -35.0, -59.0);

insert into public.supervisiones (id, objetivo_id, supervisor_id, lat, lng, precision_gps, estado) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', -34.0, -58.0, 10, 'ok'),
  ('70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', -35.0, -59.0, 10, 'ok');

insert into public.supervision_respuestas (supervision_id, item_id, resultado) values
  ('70000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'correcto');

insert into public.liquidacion_auditoria (periodo_id, empleado_id, codigo, cantidad_anterior, cantidad_nueva, origen, usuario_id) values
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '001', 0, 1, 'prueba', '10000000-0000-4000-8000-000000000004');

insert into public.app_config (key, value, description) values
  ('ejemplo_publico', 'valor-ficticio', 'clave de prueba'),
  ('ejemplo_api_key', 'valor-ficticio', 'clave de prueba con nombre de secreto');
