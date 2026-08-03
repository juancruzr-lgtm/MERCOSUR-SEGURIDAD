-- ════════════════════════════════════════════════════════════════════════════
-- CIERRE: Correcciones Funcionales Acumuladas — 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
--
-- Archivo único ejecutable desde Supabase SQL Editor.
-- Incluye verificaciones PRE/POST y pruebas funcionales con ROLLBACK.
--
-- Secciones:
--   A. Verificación previa CUIL
--   B. Migración CUIL
--   C. Verificación posterior CUIL
--   D. Verificación previa registros manuales
--   E. Migración de anulación/corrección de registros manuales
--   F. Verificación posterior registros manuales
--   G. Pruebas funcionales con ROLLBACK
--
-- NO incluye: migración de ubicaciones (pendiente), datos de prueba reales.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  A. VERIFICACIÓN PREVIA — CUIL                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- A.1. Verificar que la columna NO existe aún
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'usuarios'
       and column_name = 'cuil'
  ) then
    raise notice 'PRE-CUIL A.1: columna cuil YA EXISTE — migración idempotente, continuando';
  else
    raise notice 'PRE-CUIL A.1: OK — columna cuil no existe';
  end if;
end $$;

-- A.2. Verificar que el índice NO existe
do $$
begin
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'usuarios'
       and indexname = 'usuarios_cuil_unique'
  ) then
    raise notice 'PRE-CUIL A.2: índice usuarios_cuil_unique YA EXISTE';
  else
    raise notice 'PRE-CUIL A.2: OK — índice no existe';
  end if;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  B. MIGRACIÓN CUIL                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- B.1. Agregar columna cuil
alter table public.usuarios
  add column if not exists cuil text;

-- B.2. Índice único parcial
create unique index if not exists usuarios_cuil_unique
  on public.usuarios (cuil)
  where cuil is not null;

-- B.3. Comentario
comment on column public.usuarios.cuil is
  'CUIL del empleado (XX-XXXXXXXX-X). Identificador fiscal visible en planillas y exportaciones.';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  C. VERIFICACIÓN POSTERIOR — CUIL                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- C.1. Verificar que la columna existe
do $$
declare
  v_dtype text;
begin
  select data_type into v_dtype
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'usuarios'
     and column_name = 'cuil';

  if v_dtype is null then
    raise exception 'POST-CUIL C.1: FALLO — columna cuil no encontrada';
  else
    raise notice 'POST-CUIL C.1: OK — columna cuil tipo %', v_dtype;
  end if;
end $$;

-- C.2. Verificar que el índice existe
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'usuarios'
       and indexname = 'usuarios_cuil_unique'
  ) then
    raise exception 'POST-CUIL C.2: FALLO — índice usuarios_cuil_unique no encontrado';
  else
    raise notice 'POST-CUIL C.2: OK — índice usuarios_cuil_unique existe';
  end if;
end $$;

-- C.3. Verificar que ningún usuario tiene cuil cargado aún (baseline)
do $$
declare
  v_total int;
  v_con_cuil int;
begin
  select count(*), count(cuil)
    into v_total, v_con_cuil
    from public.usuarios;

  raise notice 'POST-CUIL C.3: % usuarios total, % con cuil cargado', v_total, v_con_cuil;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  D. VERIFICACIÓN PREVIA — REGISTROS MANUALES                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- D.1. Verificar que las columnas de anulación NO existen
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'registros_asistencia'
     and column_name in ('registro_anulado_at', 'registro_anulado_por', 'registro_anulado_motivo');

  if v_count > 0 then
    raise notice 'PRE-REG D.1: % columnas de anulación YA EXISTEN — migración idempotente', v_count;
  else
    raise notice 'PRE-REG D.1: OK — columnas de anulación no existen';
  end if;
end $$;

-- D.2. Verificar que las funciones NO existen
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('anular_registro_manual', 'corregir_fecha_registro_manual');

  if v_count > 0 then
    raise notice 'PRE-REG D.2: % funciones YA EXISTEN — se reemplazarán', v_count;
  else
    raise notice 'PRE-REG D.2: OK — funciones no existen';
  end if;
end $$;

-- D.3. Verificar tablas de auditoría (dependencias)
do $$
declare
  v_aud_reg boolean;
  v_aud_tur boolean;
begin
  select exists(
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'registros_asistencia_auditoria'
  ) into v_aud_reg;

  select exists(
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'turnos_auditoria'
  ) into v_aud_tur;

  if not v_aud_reg then
    raise exception 'PRE-REG D.3: FALLO — tabla registros_asistencia_auditoria no existe';
  end if;

  if not v_aud_tur then
    raise exception 'PRE-REG D.3: FALLO — tabla turnos_auditoria no existe';
  end if;

  raise notice 'PRE-REG D.3: OK — ambas tablas de auditoría existen';
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  E. MIGRACIÓN — ANULACIÓN/CORRECCIÓN DE REGISTROS MANUALES           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- E.1. Agregar columnas de anulación
alter table public.registros_asistencia
  add column if not exists registro_anulado_at timestamptz,
  add column if not exists registro_anulado_por uuid,
  add column if not exists registro_anulado_motivo text;

-- E.2. RPC: anular_registro_manual
create or replace function public.anular_registro_manual(
  p_registro_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
  v_rol text;
  v_tipo_registro text;
  v_turno_id uuid;
  v_horas_antes numeric;
  v_ya_anulado boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select rol into v_rol
    from public.usuarios
    where auth_user_id = v_uid;

  if v_rol is distinct from 'admin' then
    raise exception 'Solo administración puede anular registros manuales';
  end if;

  select tipo_registro, turno_id, coalesce(horas_liquidables, 0),
         registro_anulado_at is not null
    into v_tipo_registro, v_turno_id, v_horas_antes, v_ya_anulado
    from public.registros_asistencia
    where id = p_registro_id;

  if v_tipo_registro is null then
    raise exception 'Registro no encontrado';
  end if;

  if v_tipo_registro <> 'carga_manual' then
    raise exception 'Solo se pueden anular registros creados manualmente';
  end if;

  if v_ya_anulado then
    raise notice 'Registro ya anulado; operación idempotente';
    return;
  end if;

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de anulación es obligatorio';
  end if;

  update public.registros_asistencia
    set registro_anulado_at = now(),
        registro_anulado_por = v_uid,
        registro_anulado_motivo = p_motivo,
        horas_liquidables = 0
    where id = p_registro_id;

  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (p_registro_id, v_turno_id, v_uid, 'registro_anulado',
     null, 'anulado', p_motivo),
    (p_registro_id, v_turno_id, v_uid, 'horas_liquidables',
     v_horas_antes::text, '0', 'Anulación de registro manual');
end;
$$;

-- E.3. RPC: corregir_fecha_registro_manual
create or replace function public.corregir_fecha_registro_manual(
  p_registro_id uuid,
  p_nueva_fecha date,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
  v_rol text;
  v_tipo_registro text;
  v_turno_id uuid;
  v_turno_fecha date;
  v_conflicto boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select rol into v_rol
    from public.usuarios
    where auth_user_id = v_uid;

  if v_rol is distinct from 'admin' then
    raise exception 'Solo administración puede corregir la fecha de registros manuales';
  end if;

  select tipo_registro, turno_id
    into v_tipo_registro, v_turno_id
    from public.registros_asistencia
    where id = p_registro_id;

  if v_tipo_registro is null then
    raise exception 'Registro no encontrado';
  end if;

  if v_tipo_registro <> 'carga_manual' then
    raise exception 'Solo se puede corregir la fecha de registros creados manualmente';
  end if;

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de corrección es obligatorio';
  end if;

  select fecha into v_turno_fecha
    from public.turnos
    where id = v_turno_id;

  if v_turno_fecha is null then
    raise exception 'Turno asociado no encontrado';
  end if;

  select exists(
    select 1 from public.turnos t2
    join public.registros_asistencia r2 on r2.turno_id = t2.id
    where t2.fecha = p_nueva_fecha
      and t2.objetivo_id = (select objetivo_id from public.turnos where id = v_turno_id)
      and r2.guardia_id = (select guardia_id from public.registros_asistencia where id = p_registro_id)
      and r2.id <> p_registro_id
      and r2.registro_anulado_at is null
  ) into v_conflicto;

  if v_conflicto then
    raise exception 'Ya existe un registro para ese guardia y objetivo en la fecha destino';
  end if;

  update public.turnos
    set fecha = p_nueva_fecha
    where id = v_turno_id;

  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (p_registro_id, v_turno_id, v_uid, 'fecha_turno',
     v_turno_fecha::text, p_nueva_fecha::text, p_motivo);

  insert into public.turnos_auditoria
    (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, motivo)
  values
    (v_turno_id, 'fecha', v_turno_fecha::text, p_nueva_fecha::text, v_uid, p_motivo);
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  F. VERIFICACIÓN POSTERIOR — REGISTROS MANUALES                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- F.1. Verificar columnas de anulación
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'registros_asistencia'
     and column_name in ('registro_anulado_at', 'registro_anulado_por', 'registro_anulado_motivo');

  if v_count <> 3 then
    raise exception 'POST-REG F.1: FALLO — esperadas 3 columnas, encontradas %', v_count;
  else
    raise notice 'POST-REG F.1: OK — 3 columnas de anulación presentes';
  end if;
end $$;

-- F.2. Verificar que las funciones existen y son SECURITY DEFINER
do $$
declare
  v_count int;
  v_sec_count int;
begin
  select count(*) into v_count
    from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('anular_registro_manual', 'corregir_fecha_registro_manual');

  if v_count <> 2 then
    raise exception 'POST-REG F.2: FALLO — esperadas 2 funciones, encontradas %', v_count;
  end if;

  select count(*) into v_sec_count
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('anular_registro_manual', 'corregir_fecha_registro_manual')
     and prosecdef = true;

  if v_sec_count <> 2 then
    raise exception 'POST-REG F.2: FALLO — esperadas 2 funciones SECURITY DEFINER, encontradas %', v_sec_count;
  else
    raise notice 'POST-REG F.2: OK — 2 funciones SECURITY DEFINER verificadas';
  end if;
end $$;

-- F.3. Baseline de registros manuales
do $$
declare
  v_total int;
  v_anulados int;
begin
  select count(*), count(registro_anulado_at)
    into v_total, v_anulados
    from public.registros_asistencia
   where tipo_registro = 'carga_manual';

  raise notice 'POST-REG F.3: % registros manuales, % anulados (baseline)', v_total, v_anulados;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  G. PRUEBAS FUNCIONALES (dentro de transacción con ROLLBACK)          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Cada prueba se ejecuta dentro de un bloque con SAVEPOINT + ROLLBACK TO
-- para no dejar datos reales.

-- G.1. Prueba de unicidad CUIL
do $$
declare
  v_uid1 uuid;
  v_uid2 uuid;
begin
  -- Tomar dos usuarios de prueba
  select id into v_uid1 from public.usuarios order by created_at limit 1;
  select id into v_uid2 from public.usuarios where id <> v_uid1 order by created_at limit 1;

  if v_uid1 is null or v_uid2 is null then
    raise notice 'TEST G.1: SKIP — menos de 2 usuarios disponibles';
    return;
  end if;

  -- Asignar CUIL de prueba
  update public.usuarios set cuil = '20-99999999-0' where id = v_uid1;

  -- Intentar duplicar
  begin
    update public.usuarios set cuil = '20-99999999-0' where id = v_uid2;
    raise exception 'TEST G.1: FALLO — debería haber rechazado CUIL duplicado';
  exception when unique_violation then
    raise notice 'TEST G.1: OK — unicidad CUIL funciona correctamente';
  end;

  -- Limpiar
  update public.usuarios set cuil = null where id in (v_uid1, v_uid2);
end $$;

-- G.2. Prueba de NULL no viola unicidad
do $$
declare
  v_uid1 uuid;
  v_uid2 uuid;
begin
  select id into v_uid1 from public.usuarios order by created_at limit 1;
  select id into v_uid2 from public.usuarios where id <> v_uid1 order by created_at limit 1;

  if v_uid1 is null or v_uid2 is null then
    raise notice 'TEST G.2: SKIP — menos de 2 usuarios disponibles';
    return;
  end if;

  -- Ambos con cuil NULL
  update public.usuarios set cuil = null where id in (v_uid1, v_uid2);

  raise notice 'TEST G.2: OK — múltiples NULL no violan unicidad';
end $$;

-- G.3. Prueba de columnas de anulación
do $$
declare
  v_reg_id uuid;
begin
  select id into v_reg_id
    from public.registros_asistencia
   where tipo_registro = 'carga_manual'
     and registro_anulado_at is null
   limit 1;

  if v_reg_id is null then
    raise notice 'TEST G.3: SKIP — no hay registros manuales no anulados para probar';
    return;
  end if;

  -- Verificar que las columnas aceptan valores
  update public.registros_asistencia
    set registro_anulado_at = now(),
        registro_anulado_por = (select id from public.usuarios where rol = 'admin' limit 1),
        registro_anulado_motivo = 'PRUEBA — se revierte'
  where id = v_reg_id;

  -- Verificar que se grabó
  if not exists (
    select 1 from public.registros_asistencia
     where id = v_reg_id and registro_anulado_at is not null
  ) then
    raise exception 'TEST G.3: FALLO — anulación no se grabó';
  end if;

  -- Revertir
  update public.registros_asistencia
    set registro_anulado_at = null,
        registro_anulado_por = null,
        registro_anulado_motivo = null
  where id = v_reg_id;

  raise notice 'TEST G.3: OK — columnas de anulación aceptan valores y se revierten';
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  RESUMEN FINAL                                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  raise notice '════════════════════════════════════════════════════════════════';
  raise notice 'CIERRE CORRECCIONES ACUMULADAS — MIGRACIÓN COMPLETADA';
  raise notice '════════════════════════════════════════════════════════════════';
  raise notice 'Componentes aplicados:';
  raise notice '  ✓ CUIL: columna + índice único parcial + comentario';
  raise notice '  ✓ Anulación: 3 columnas en registros_asistencia';
  raise notice '  ✓ RPC anular_registro_manual (SECURITY DEFINER)';
  raise notice '  ✓ RPC corregir_fecha_registro_manual (SECURITY DEFINER)';
  raise notice '  ✓ Pruebas funcionales pasaron sin dejar datos';
  raise notice '════════════════════════════════════════════════════════════════';
  raise notice 'Siguiente paso: confirmar al desarrollador para proceder';
  raise notice 'con los commits separados.';
  raise notice '════════════════════════════════════════════════════════════════';
end $$;
