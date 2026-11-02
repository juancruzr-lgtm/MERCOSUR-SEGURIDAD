-- Pruebas de 20261113120000 sobre esquema_minimo.sql (PostgreSQL LOCAL).
-- Ventana E1: 08/10/2026 – 20/10/2026 (t1 = 21/10 00:00 ART). Frecuencia 24 h.
-- Cada caso: última supervisión válida el 01/10 10:00 ART → vence 02/10 10:00.
-- Termina con "OK supervision-exigibilidad" o aborta con el caso que falló.

\set ON_ERROR_STOP on
begin;

insert into public.zonas_operativas (id, nombre) values ('00000000-0000-0000-0000-0000000000ff', 'Z');
insert into public.usuarios (id, auth_user_id, nombre, rol, puesto_organizacional) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Gerencia', 'admin', 'gerencia'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'Supervisor', 'supervisor', 'supervisor');

insert into public.objetivos (id, nombre, estado, zona_id) values
  ('00000000-0000-0000-0000-00000000000a', 'A regularizado 12/10',   'activo',   '00000000-0000-0000-0000-0000000000ff'),
  ('00000000-0000-0000-0000-00000000000b', 'B baja 10/10 12:00',      'inactivo', '00000000-0000-0000-0000-0000000000ff'),
  ('00000000-0000-0000-0000-00000000000c', 'C reactivado 16/10',      'activo',   '00000000-0000-0000-0000-0000000000ff'),
  ('00000000-0000-0000-0000-00000000000d', 'D suspendido 12-14/10',   'activo',   '00000000-0000-0000-0000-0000000000ff'),
  ('00000000-0000-0000-0000-00000000000e', 'E fin servicio 09/10',    'activo',   '00000000-0000-0000-0000-0000000000ff'),
  ('00000000-0000-0000-0000-00000000000f', 'F sin cambios',           'activo',   '00000000-0000-0000-0000-0000000000ff');

insert into public.turnos (objetivo_id, fecha, estado)
select o.id, d::date, 'cubierto'
  from public.objetivos o, generate_series(date '2026-10-01', date '2026-10-31', interval '1 day') d;

insert into public.supervisiones (objetivo_id, estado, created_at)
select o.id, 'normal', timestamptz '2026-10-01 10:00-03' from public.objetivos o;
insert into public.supervisiones (objetivo_id, estado, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'normal',     '2026-10-12 10:00-03'),
  -- Una incompleta NO regulariza (igual que E1) y no es "última".
  ('00000000-0000-0000-0000-00000000000f', 'incompleta', '2026-10-15 10:00-03');

insert into public.objetivos_auditoria (objetivo_id, campo, valor_anterior, valor_nuevo, origen, created_at) values
  ('00000000-0000-0000-0000-00000000000b', 'estado', 'activo', 'inactivo', 'manual', '2026-10-10 12:00-03'),
  ('00000000-0000-0000-0000-00000000000c', 'estado', 'inactivo', 'activo', 'manual', '2026-10-16 00:00-03');

-- Antes de cargar fechas/suspensiones: resultado viejo.
create temp table antes as select * from public.evaluacion_vencimientos_supervision_vieja('2026-10-08', '2026-10-20');
commit;

-- Datos que sólo existen con la migración (como service role: auth.uid() null).
update public.objetivos set fecha_fin_servicio = date '2026-10-09' where id = '00000000-0000-0000-0000-00000000000e';
insert into public.objetivo_suspensiones (objetivo_id, desde, hasta, motivo)
values ('00000000-0000-0000-0000-00000000000d', date '2026-10-12', date '2026-10-14', 'Obra parada');

create temp table despues as select * from public.evaluacion_vencimientos_supervision('2026-10-08', '2026-10-20');

do $$
declare
  r record;
  esperado jsonb := jsonb_build_object(
    -- A: dos vencimientos: 08/10 00:00 → 12/10 10:00 (106 h) y 13/10 10:00 → 21/10 00:00 (182 h). Igual que antes.
    '00000000-0000-0000-0000-00000000000a', 288.0,
    -- B: hoy inactivo; antes NO contaba nada. Ahora cuenta mientras estuvo activo: 08/10 → 10/10 12:00 = 60 h.
    '00000000-0000-0000-0000-00000000000b', 60.0,
    -- C: hoy activo, reactivado el 16/10; antes contaba 312 h. Ahora 16/10 → 21/10 = 120 h.
    '00000000-0000-0000-0000-00000000000c', 120.0,
    -- D: 312 h menos 3 días suspendido = 240 h.
    '00000000-0000-0000-0000-00000000000d', 240.0,
    -- E: fin de servicio 09/10 (inclusivo) → 08/10 → 10/10 00:00 = 48 h.
    '00000000-0000-0000-0000-00000000000e', 48.0,
    -- F: la incompleta del 15/10 no regulariza: 312 h, igual que antes.
    '00000000-0000-0000-0000-00000000000f', 312.0);
  k text;
  h numeric;
begin
  for k in select jsonb_object_keys(esperado) loop
    select coalesce(sum(horas_vencido), 0) into h from despues where objetivo_id = k::uuid;
    if h <> (esperado ->> k)::numeric then
      raise exception 'FALLA E1 %: esperado % h, obtuvo % h', k, esperado ->> k, h;
    end if;
  end loop;

  -- Sin fechas ni suspensiones ni cambios de estado, el resultado es idéntico al viejo.
  for r in select a.objetivo_id, a.vencio_at, a.horas_vencido as viejo, d.horas_vencido as nuevo
             from antes a join despues d using (objetivo_id, vencio_at)
            where a.objetivo_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000f') loop
    if r.viejo <> r.nuevo then raise exception 'FALLA equivalencia %: % vs %', r.objetivo_id, r.viejo, r.nuevo; end if;
  end loop;
  if (select count(*) from antes where objetivo_id = '00000000-0000-0000-0000-00000000000b') <> 0 then
    raise exception 'FALLA: la versión vieja debía excluir a B (inactivo hoy)';
  end if;

  -- objetivo_exigible_en
  if public.objetivo_exigible_en('00000000-0000-0000-0000-00000000000b', '2026-10-09 12:00-03') is not true then
    raise exception 'FALLA: B era exigible el 09/10'; end if;
  if public.objetivo_exigible_en('00000000-0000-0000-0000-00000000000b', '2026-10-11 12:00-03') is not false then
    raise exception 'FALLA: B no era exigible el 11/10'; end if;
  if public.objetivo_exigible_en('00000000-0000-0000-0000-00000000000d', '2026-10-14 23:59-03') is not false then
    raise exception 'FALLA: D suspendido hasta el 14/10 inclusive'; end if;
  if public.objetivo_exigible_en('00000000-0000-0000-0000-00000000000d', '2026-10-15 00:00-03') is not true then
    raise exception 'FALLA: D exigible desde el 15/10'; end if;

  -- ultima_supervision_por_objetivo ignora la incompleta
  if (select ultima_at from public.ultima_supervision_por_objetivo() where objetivo_id = '00000000-0000-0000-0000-00000000000f')
     <> timestamptz '2026-10-01 10:00-03' then
    raise exception 'FALLA: la última de F no debe ser la incompleta'; end if;

  -- Auditoría del cambio de fecha de servicio
  if not exists (select 1 from public.objetivos_auditoria
                  where objetivo_id = '00000000-0000-0000-0000-00000000000e'
                    and campo = 'fecha_fin_servicio' and valor_nuevo = '2026-10-09' and origen = 'service_role') then
    raise exception 'FALLA: falta auditoría de fecha_fin_servicio'; end if;
end $$;

-- Supervisor NO puede cambiar fechas de servicio; Gerencia sí.
select set_config('prueba.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$ begin
  begin
    update public.objetivos set fecha_fin_servicio = date '2026-12-31' where id = '00000000-0000-0000-0000-00000000000f';
    raise exception 'FALLA: el supervisor pudo cambiar la fecha de fin';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('prueba.uid', '00000000-0000-0000-0000-0000000000a1', false);
update public.objetivos set fecha_fin_servicio = date '2026-12-31' where id = '00000000-0000-0000-0000-00000000000f';
do $$ begin
  if not exists (select 1 from public.objetivos_auditoria where objetivo_id = '00000000-0000-0000-0000-00000000000f'
                   and campo = 'fecha_fin_servicio' and origen = 'manual'
                   and modificado_por = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FALLA: auditoría manual con usuario'; end if;
end $$;

-- Suspensiones: identidad desde auth.uid(), sólo «hasta» y anulación editables.
insert into public.objetivo_suspensiones (objetivo_id, desde, motivo, creado_por)
values ('00000000-0000-0000-0000-00000000000f', date '2026-11-01', 'Prueba', '00000000-0000-0000-0000-0000000000d1');
do $$
declare v_id uuid;
begin
  select id into v_id from public.objetivo_suspensiones where motivo = 'Prueba';
  if (select creado_por from public.objetivo_suspensiones where id = v_id) <> '00000000-0000-0000-0000-0000000000c1' then
    raise exception 'FALLA: creado_por debe salir de auth.uid()'; end if;
  begin
    update public.objetivo_suspensiones set motivo = 'otro' where id = v_id;
    raise exception 'FALLA: el motivo no debía poder cambiarse';
  exception when check_violation then null;
  end;
  update public.objetivo_suspensiones set hasta = date '2026-11-05' where id = v_id;
  update public.objetivo_suspensiones set anulada_at = now() where id = v_id;
  if (select anulada_por from public.objetivo_suspensiones where id = v_id) <> '00000000-0000-0000-0000-0000000000c1' then
    raise exception 'FALLA: anulada_por'; end if;
  begin
    update public.objetivo_suspensiones set hasta = date '2026-11-06' where id = v_id;
    raise exception 'FALLA: una anulada no debía modificarse';
  exception when check_violation then null;
  end;
end $$;

select 'OK supervision-exigibilidad' as resultado;
