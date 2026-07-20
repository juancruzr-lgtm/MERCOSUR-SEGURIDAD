-- Corrige hallazgo H1: las políticas "using (true)" en turnos y
-- registros_asistencia permitían que un guardia accediera a datos de otros.
-- Se reemplazan por políticas separadas por rol.
--
-- Roles en usuarios.rol: 'admin' | 'supervisor' | 'guardia' | 'vigilador'
-- Invariante: las rutas /api/* usan service_role y no son afectadas por RLS.

-- ── registros_asistencia ─────────────────────────────────────────────────────

drop policy if exists "Admin acceso total registros" on registros_asistencia;

-- Admin: acceso total (SELECT, INSERT, UPDATE, DELETE)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registros_asistencia'
      and policyname = 'Admin CRUD registros_asistencia'
  ) then
    create policy "Admin CRUD registros_asistencia"
    on registros_asistencia for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- Supervisor: solo lectura (necesita ver todos los registros de los turnos
-- que supervisa; el filtro por turno_id lo aplica la app).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registros_asistencia'
      and policyname = 'Supervisor lee registros_asistencia'
  ) then
    create policy "Supervisor lee registros_asistencia"
    on registros_asistencia for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- Guardia/vigilador: acceso completo solo a sus propios registros
-- (SELECT propio + INSERT propio + UPDATE propio para egreso/anulación).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registros_asistencia'
      and policyname = 'Guardia gestiona sus registros'
  ) then
    create policy "Guardia gestiona sus registros"
    on registros_asistencia for all to authenticated
    using (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol in ('guardia', 'vigilador')
          and id = registros_asistencia.guardia_id
      )
    )
    with check (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol in ('guardia', 'vigilador')
          and id = registros_asistencia.guardia_id
      )
    );
  end if;
end $$;

-- ── turnos ───────────────────────────────────────────────────────────────────

drop policy if exists "Admin acceso total turnos" on turnos;

-- Admin: acceso total
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'turnos'
      and policyname = 'Admin CRUD turnos'
  ) then
    create policy "Admin CRUD turnos"
    on turnos for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- Supervisor: acceso total (SELECT para ver todos los turnos del rango,
-- INSERT para crear turnos, UPDATE para modificar estado y asignación).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'turnos'
      and policyname = 'Supervisor CRUD turnos'
  ) then
    create policy "Supervisor CRUD turnos"
    on turnos for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- Guardia/vigilador: solo lectura de sus propios turnos
-- (guardia_id = propio o guardia_original_id = propio para reemplazos).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'turnos'
      and policyname = 'Guardia lee sus turnos'
  ) then
    create policy "Guardia lee sus turnos"
    on turnos for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol in ('guardia', 'vigilador')
          and (id = turnos.guardia_id or id = turnos.guardia_original_id)
      )
    );
  end if;
end $$;
