-- Cierre definitivo de RLS para zonas_operativas, supervisor_zonas y el
-- bucket de Storage "supervision-fotos". Supersede las politicas parciales
-- de 20260627_rls_zonas_operativas.sql (solo INSERT para admin).
-- No desactiva RLS. No usa USING (true). No toca ninguna otra tabla.
--
-- Permisos:
--   ADMIN      -> CRUD completo sobre zonas_operativas y supervisor_zonas,
--                 lectura completa de fotos de supervision en Storage.
--   SUPERVISOR -> lectura de las zonas que tiene asignadas (via
--                 supervisor_zonas), upload de fotos propias en Storage,
--                 lectura solo de sus propias fotos.
--   GUARDIA    -> sin acceso (no se crea ninguna politica para 'guardia';
--                 con RLS activo y sin politica que lo permita, Postgres
--                 deniega todo por defecto).

alter table zonas_operativas enable row level security;
alter table supervisor_zonas enable row level security;

-- ── zonas_operativas ──────────────────────────────────────────

drop policy if exists "Admin puede insertar zonas operativas" on zonas_operativas;
drop policy if exists "Admin select zonas_operativas" on zonas_operativas;
drop policy if exists "Admin insert zonas_operativas" on zonas_operativas;
drop policy if exists "Admin update zonas_operativas" on zonas_operativas;
drop policy if exists "Admin delete zonas_operativas" on zonas_operativas;
drop policy if exists "Supervisor select zonas asignadas" on zonas_operativas;

create policy "Admin select zonas_operativas"
on zonas_operativas
for select
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin insert zonas_operativas"
on zonas_operativas
for insert
to authenticated
with check (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin update zonas_operativas"
on zonas_operativas
for update
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
)
with check (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin delete zonas_operativas"
on zonas_operativas
for delete
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Supervisor select zonas asignadas"
on zonas_operativas
for select
to authenticated
using (
  exists (
    select 1
    from supervisor_zonas sz
    join usuarios u on u.id = sz.supervisor_id
    where u.auth_user_id = auth.uid()
      and u.rol = 'supervisor'
      and sz.zona_id = zonas_operativas.id
  )
);

-- ── supervisor_zonas ──────────────────────────────────────────

drop policy if exists "Admin puede insertar supervisor_zonas" on supervisor_zonas;
drop policy if exists "Admin select supervisor_zonas" on supervisor_zonas;
drop policy if exists "Admin insert supervisor_zonas" on supervisor_zonas;
drop policy if exists "Admin update supervisor_zonas" on supervisor_zonas;
drop policy if exists "Admin delete supervisor_zonas" on supervisor_zonas;
drop policy if exists "Supervisor select sus asignaciones" on supervisor_zonas;

create policy "Admin select supervisor_zonas"
on supervisor_zonas
for select
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin insert supervisor_zonas"
on supervisor_zonas
for insert
to authenticated
with check (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin update supervisor_zonas"
on supervisor_zonas
for update
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
)
with check (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin delete supervisor_zonas"
on supervisor_zonas
for delete
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Supervisor select sus asignaciones"
on supervisor_zonas
for select
to authenticated
using (
  exists (
    select 1 from usuarios u
    where u.auth_user_id = auth.uid()
      and u.rol = 'supervisor'
      and u.id = supervisor_zonas.supervisor_id
  )
);

-- ── storage.objects: bucket "supervision-fotos" ──────────────
-- El path de cada foto es "<supervision_id>/<timestamp>-<index>-<nombre>"
-- (SupervisorMobile.tsx, guardarSupervision). storage.foldername(name)[1]
-- es ese primer segmento = supervision_id.

drop policy if exists "Admin lee todas las fotos de supervision" on storage.objects;
drop policy if exists "Supervisor sube sus fotos de supervision" on storage.objects;
drop policy if exists "Supervisor lee sus fotos de supervision" on storage.objects;

create policy "Admin lee todas las fotos de supervision"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'supervision-fotos'
  and exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Supervisor sube sus fotos de supervision"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'supervision-fotos'
  and exists (
    select 1
    from supervisiones s
    join usuarios u on u.id = s.supervisor_id
    where u.auth_user_id = auth.uid()
      and u.rol = 'supervisor'
      and (storage.foldername(name))[1] = s.id::text
  )
);

create policy "Supervisor lee sus fotos de supervision"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'supervision-fotos'
  and exists (
    select 1
    from supervisiones s
    join usuarios u on u.id = s.supervisor_id
    where u.auth_user_id = auth.uid()
      and u.rol = 'supervisor'
      and (storage.foldername(name))[1] = s.id::text
  )
);
