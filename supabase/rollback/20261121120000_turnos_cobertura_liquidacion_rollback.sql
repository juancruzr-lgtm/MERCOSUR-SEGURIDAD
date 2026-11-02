-- Rollback de 20261121120000_turnos_cobertura_liquidacion.sql
--
-- Quita triggers y funciones nuevas. NO borra datos de negocio:
--   · turnos_historial y asistencia_excepciones_autorizadas se CONSERVAN
--     (son auditoría); sólo se les quitan los triggers de escritura. Si se
--     quisiera descartarlas, hacerlo aparte y con autorización.
--   · turnos.reemplaza_turno_id y registros_asistencia.excepcion_asistencia_id
--     se conservan (columnas nulables, ninguna función previa las usa).
-- Ninguna función existente fue modificada por la migración, así que no hay
-- definiciones previas que restaurar.

begin;

drop trigger if exists turnos_validar_superposicion on public.turnos;
drop trigger if exists turnos_historial_registrar on public.turnos;
drop trigger if exists registros_asistencia_validar_liquidable on public.registros_asistencia;
drop trigger if exists registros_asistencia_consumir_excepcion on public.registros_asistencia;

drop function if exists public.turnos_validar_superposicion();
drop function if exists public.turnos_registrar_historial();
drop function if exists public._turnos_historial_insertar(uuid, text, text[], jsonb, jsonb, text);
drop function if exists public.registros_asistencia_validar_liquidable();
drop function if exists public.registros_asistencia_consumir_excepcion();
drop function if exists public._registro_liquidable_validar(text, jsonb, jsonb, boolean);
drop function if exists public._registro_excepcion_consumir(uuid, uuid);
drop function if exists public.detectar_doble_liquidacion(date, date);
drop function if exists public.cobertura_real_turno(uuid);
drop function if exists public._cobertura_real_turno(uuid);
drop function if exists public.turno_coberturas(uuid);
drop function if exists public.turno_horas_liquidadas(uuid, uuid);
drop function if exists public.asistencia_evidencia_tipo(uuid, uuid);
drop function if exists public.autorizar_excepcion_asistencia(uuid, uuid, text);
drop function if exists public.puede_autorizar_excepcion_asistencia(uuid);

-- Las tablas de auditoría quedan, inmutables y sin escritor.
revoke insert, update, delete on public.turnos_historial from authenticated, service_role;
revoke insert, update, delete on public.asistencia_excepciones_autorizadas from authenticated, service_role;

commit;

-- Verificación:
--   select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass, 'public.registros_asistencia'::regclass) and not tgisinternal order by 1;
--   → deben quedar sólo trg_turnos_completar_puesto, turnos_updated_at,
--     registro_alerta_salida, registro_detectar_salida_anticipada.
