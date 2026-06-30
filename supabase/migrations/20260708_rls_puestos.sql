-- RLS minima para puestos. No usa USING (true). No toca ninguna otra tabla.
-- Lectura: cualquier usuario autenticado existente en la tabla usuarios
--          (espeja el comportamiento real actual de objetivos, sin
--          inventar visibilidad por zona todavia).
-- Escritura (insert/update/delete): solo admin.

alter table puestos enable row level security;

create policy "Lectura puestos usuarios autenticados"
on puestos
for select
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
  )
);

create policy "Admin escribe puestos"
on puestos
for insert
to authenticated
with check (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

create policy "Admin actualiza puestos"
on puestos
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

create policy "Admin elimina puestos"
on puestos
for delete
to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);
