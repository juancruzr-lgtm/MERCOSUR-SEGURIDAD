-- Corrige RLS de zonas_operativas y supervisor_zonas.
-- Solo toca estas dos tablas. No usa USING (true). No desactiva RLS.

alter table zonas_operativas enable row level security;
alter table supervisor_zonas enable row level security;

drop policy if exists "Admin puede insertar zonas operativas" on zonas_operativas;

create policy "Admin puede insertar zonas operativas"
on zonas_operativas
for insert
to authenticated
with check (
  exists (
    select 1
    from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);

drop policy if exists "Admin puede insertar supervisor_zonas" on supervisor_zonas;

create policy "Admin puede insertar supervisor_zonas"
on supervisor_zonas
for insert
to authenticated
with check (
  exists (
    select 1
    from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol = 'admin'
  )
);
