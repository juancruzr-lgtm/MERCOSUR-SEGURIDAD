-- Chequeo PREVIO a aplicar las migraciones de facturación. SÓLO LECTURA.
-- Una sola sentencia: cada fila es un control; "ok" debe ser true en todas.
select 'sin objetos de facturación previos' control,
       not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and (c.relname like 'fact\_%' or c.relname like 'facturacion%'))
   and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'fact\_%' or p.proname like 'facturacion\_%')) ok,
       null::text detalle
union all
select 'funciones de acceso existentes',
       to_regprocedure('public.puede_acceder_gerencia_actual()') is not null and to_regprocedure('public.acceso_habilitado_actual()') is not null
   and to_regprocedure('public.alcance_operativo_de(uuid)') is not null, null
union all
select 'columnas de usuarios', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios'
   and column_name in ('id', 'auth_user_id', 'estado', 'puesto_organizacional', 'acceso_bloqueado')) = 5, null
union all
select 'columnas de turnos', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'turnos'
   and column_name in ('id', 'fecha', 'hora_inicio', 'hora_fin', 'objetivo_id', 'puesto_id', 'estado')) = 7, null
union all
select 'columnas de registros_asistencia', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'registros_asistencia'
   and column_name in ('id', 'turno_id', 'guardia_id', 'guardia_final_id', 'objetivo_final_id', 'hora_entrada_real', 'hora_salida_real', 'hora_entrada_final',
     'hora_salida_final', 'horas_trabajadas', 'horas_liquidables', 'origen_cobertura', 'cobertura_anulada_at', 'cierre_automatico', 'tipo_registro')) = 15, null
union all
select 'bucket facturacion-documentos libre', not exists (select 1 from storage.buckets where id = 'facturacion-documentos'), null
union all
select 'políticas de storage con nombre libre', not exists (select 1 from pg_policies where schemaname = 'storage' and policyname in ('fact_docs_lectura', 'fact_docs_alta')), null
union all
select 'usuarios con acceso a facturación (todos con alcance total)',
       not exists (select 1 from public.usuarios u where u.estado = 'activo' and u.puesto_organizacional in ('gerencia', 'administracion')
                   and public.alcance_operativo_de(u.id) <> 'todas'),
       (select string_agg(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '') || ' (' || u.puesto_organizacional || ')', ', ' order by u.puesto_organizacional)
          from public.usuarios u where u.estado = 'activo' and not u.acceso_bloqueado and u.puesto_organizacional in ('gerencia', 'administracion'))
union all
select 'turnos de octubre con puesto (necesario para relevos)',
       not exists (select 1 from public.turnos t where t.fecha >= '2026-10-01' and t.fecha < '2026-11-01' and t.puesto_id is null and t.estado <> 'anulado'),
       (select count(*)::text || ' turnos sin puesto' from public.turnos t where t.fecha >= '2026-10-01' and t.fecha < '2026-11-01' and t.puesto_id is null and t.estado <> 'anulado')
union all
select 'registro de migraciones: ninguna de facturación aplicada',
       not exists (select 1 from supabase_migrations.schema_migrations where name like '20261201%facturacion%'), null;
