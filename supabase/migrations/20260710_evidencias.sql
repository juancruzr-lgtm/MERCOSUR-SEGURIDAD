/*
Decision de arquitectura - Julio 2026

Tabla unificada de evidencias para todos los procesos del sistema.

La misma estructura sirve para ingreso, egreso, supervision, ronda,
cambio_guardia, reemplazo, protocolo y cualquier proceso futuro.

No se usa una tabla por modulo. Esta es la unica tabla de evidencias.

proceso_id no tiene FK declarada porque puede referenciar tablas
distintas segun proceso_tipo. La integridad se garantiza por logica
de aplicacion y triggers de limpieza cuando corresponda.

tipo_evidencia NO tiene CHECK: el catalogo crece constantemente
(libro_guardia, uniforme, puesto, matafuegos, hidrante, alarma,
camara, llave, documento, etc.). Solo proceso_tipo tiene CHECK.

El bucket de Storage se guarda en la tabla para que cada fila sea
autocontenida: supabase.storage.from(evidencia.bucket)
  .createSignedUrl(evidencia.storage_path)
sin logica adicional en el cliente.

Tablas legacy supervision_fotos, cambios_guardia_evidencias y
reemplazos_guardia_evidencias siguen existiendo para registros
historicos. La arquitectura nueva es esta tabla.
*/

create table if not exists evidencias (
  id            uuid        primary key default gen_random_uuid(),
  proceso_tipo  text        not null,
  proceso_id    uuid        not null,
  turno_id      uuid        references turnos(id),
  guardia_id    uuid        references usuarios(id),
  objetivo_id   uuid        references objetivos(id),
  tipo_evidencia text       not null,
  bucket        text        not null,
  storage_path  text        not null,
  created_at    timestamptz not null default now(),

  constraint evidencias_proceso_tipo_check
    check (proceso_tipo in (
      'ingreso',
      'egreso',
      'supervision',
      'ronda',
      'cambio_guardia',
      'reemplazo',
      'protocolo'
    ))
);

-- ── Unicidad ──────────────────────────────────────────────────────────
-- Un proceso tiene exactamente una evidencia de cada tipo.
-- Impide duplicados por doble-tap o reintentos mal manejados.

create unique index if not exists uq_evidencias_proceso_tipo_evidencia
  on evidencias (proceso_tipo, proceso_id, tipo_evidencia);

-- ── Indices de busqueda ───────────────────────────────────────────────

create index if not exists idx_evidencias_proceso
  on evidencias (proceso_tipo, proceso_id);

create index if not exists idx_evidencias_turno
  on evidencias (turno_id);

create index if not exists idx_evidencias_guardia
  on evidencias (guardia_id, created_at desc);

create index if not exists idx_evidencias_objetivo
  on evidencias (objetivo_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────

alter table evidencias enable row level security;

-- Guardia: INSERT solo de sus propias evidencias
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'evidencias'
      and policyname = 'Guardia inserta sus evidencias'
  ) then
    create policy "Guardia inserta sus evidencias"
    on evidencias for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = guardia_id
          and usuarios.rol in ('guardia', 'vigilador')
      )
    );
  end if;
end $$;

-- Guardia: SELECT solo de sus propias evidencias
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'evidencias'
      and policyname = 'Guardia lee sus evidencias'
  ) then
    create policy "Guardia lee sus evidencias"
    on evidencias for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = guardia_id
      )
    );
  end if;
end $$;

-- Admin: SELECT sobre todas las evidencias
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'evidencias'
      and policyname = 'Admin lee todas las evidencias'
  ) then
    create policy "Admin lee todas las evidencias"
    on evidencias for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'admin'
      )
    );
  end if;
end $$;

-- Supervisor: SELECT sobre todas las evidencias
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'evidencias'
      and policyname = 'Supervisor lee todas las evidencias'
  ) then
    create policy "Supervisor lee todas las evidencias"
    on evidencias for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'supervisor'
      )
    );
  end if;
end $$;

-- ── storage.objects: bucket "ingreso-evidencias" ──────────────────────
-- Path: {registro_asistencia_id}/{tipo_evidencia}-{timestamp}.jpg
-- storage.foldername(name)[1] = registro_asistencia_id
--
-- INSERT: permisivo para guardia/vigilador. No se puede restringir
-- por FK a evidencias porque el upload ocurre antes del INSERT en la
-- tabla (el archivo debe existir para tener el path a guardar).
--
-- SELECT: admin y supervisor leen todo el bucket.
--         guardia lee solo paths asociados a sus propias evidencias.

drop policy if exists "Guardia sube evidencias de ingreso" on storage.objects;
drop policy if exists "Admin lee evidencias de ingreso" on storage.objects;
drop policy if exists "Supervisor lee evidencias de ingreso" on storage.objects;
drop policy if exists "Guardia lee sus evidencias de ingreso" on storage.objects;

create policy "Guardia sube evidencias de ingreso"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ingreso-evidencias'
  and exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol in ('guardia', 'vigilador')
  )
);

create policy "Admin lee evidencias de ingreso"
on storage.objects for select to authenticated
using (
  bucket_id = 'ingreso-evidencias'
  and exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Supervisor lee evidencias de ingreso"
on storage.objects for select to authenticated
using (
  bucket_id = 'ingreso-evidencias'
  and exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'supervisor'
  )
);

create policy "Guardia lee sus evidencias de ingreso"
on storage.objects for select to authenticated
using (
  bucket_id = 'ingreso-evidencias'
  and (storage.foldername(name))[1] in (
    select e.proceso_id::text
    from evidencias e
    join usuarios u on u.id = e.guardia_id
    where u.auth_user_id = auth.uid()
      and e.proceso_tipo = 'ingreso'
  )
);
