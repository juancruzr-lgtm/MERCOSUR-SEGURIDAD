-- Habilitar RLS en 8 tablas que aparecen como ERROR en el Security Advisor
-- (rls_disabled_in_public). Ninguna modificacion de datos ni logica.
-- Sin USING(true). Idempotente: cada politica verifica pg_policies antes
-- de crearse.

-- ── checklist_plantillas ─────────────────────────────────────────────
-- Admin: CRUD completo. Supervisor: solo lectura (necesita las plantillas
-- para ejecutar supervisiones desde SupervisorMobile).

alter table checklist_plantillas enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'checklist_plantillas'
      and policyname = 'Admin CRUD checklist_plantillas'
  ) then
    create policy "Admin CRUD checklist_plantillas"
    on checklist_plantillas for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'checklist_plantillas'
      and policyname = 'Supervisor lee checklist_plantillas'
  ) then
    create policy "Supervisor lee checklist_plantillas"
    on checklist_plantillas for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- ── checklist_items ──────────────────────────────────────────────────
-- Mismo criterio que checklist_plantillas.

alter table checklist_items enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'checklist_items'
      and policyname = 'Admin CRUD checklist_items'
  ) then
    create policy "Admin CRUD checklist_items"
    on checklist_items for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'checklist_items'
      and policyname = 'Supervisor lee checklist_items'
  ) then
    create policy "Supervisor lee checklist_items"
    on checklist_items for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- ── supervisiones ────────────────────────────────────────────────────
-- Admin: lectura de todas (sin filtro de zona; el admin ve el negocio
-- completo). Supervisor: CRUD solo de sus propias supervisiones
-- (scoped por supervisor_id).

alter table supervisiones enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervisiones'
      and policyname = 'Admin lee supervisiones'
  ) then
    create policy "Admin lee supervisiones"
    on supervisiones for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervisiones'
      and policyname = 'Supervisor CRUD sus supervisiones'
  ) then
    create policy "Supervisor CRUD sus supervisiones"
    on supervisiones for all to authenticated
    using (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol = 'supervisor'
          and id = supervisiones.supervisor_id
      )
    )
    with check (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol = 'supervisor'
          and id = supervisiones.supervisor_id
      )
    );
  end if;
end $$;

-- ── supervision_respuestas ───────────────────────────────────────────
-- Admin: lectura (via join en AppClient). Supervisor: CRUD de las
-- respuestas de sus propias supervisiones (scoped via supervision_id).

alter table supervision_respuestas enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervision_respuestas'
      and policyname = 'Admin lee supervision_respuestas'
  ) then
    create policy "Admin lee supervision_respuestas"
    on supervision_respuestas for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervision_respuestas'
      and policyname = 'Supervisor CRUD sus supervision_respuestas'
  ) then
    create policy "Supervisor CRUD sus supervision_respuestas"
    on supervision_respuestas for all to authenticated
    using (
      exists (
        select 1 from supervisiones s
        join usuarios u on u.id = s.supervisor_id
        where u.auth_user_id = auth.uid()
          and u.rol = 'supervisor'
          and s.id = supervision_respuestas.supervision_id
      )
    )
    with check (
      exists (
        select 1 from supervisiones s
        join usuarios u on u.id = s.supervisor_id
        where u.auth_user_id = auth.uid()
          and u.rol = 'supervisor'
          and s.id = supervision_respuestas.supervision_id
      )
    );
  end if;
end $$;

-- ── supervision_fotos ────────────────────────────────────────────────
-- Mismo criterio que supervision_respuestas.
-- Nota: el Storage bucket "supervision-fotos" tiene sus propias politicas
-- en storage.objects (migracion 20260628). Esta tabla guarda solo el
-- storage_path como metadato.

alter table supervision_fotos enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervision_fotos'
      and policyname = 'Admin lee supervision_fotos'
  ) then
    create policy "Admin lee supervision_fotos"
    on supervision_fotos for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervision_fotos'
      and policyname = 'Supervisor CRUD sus supervision_fotos'
  ) then
    create policy "Supervisor CRUD sus supervision_fotos"
    on supervision_fotos for all to authenticated
    using (
      exists (
        select 1 from supervisiones s
        join usuarios u on u.id = s.supervisor_id
        where u.auth_user_id = auth.uid()
          and u.rol = 'supervisor'
          and s.id = supervision_fotos.supervision_id
      )
    )
    with check (
      exists (
        select 1 from supervisiones s
        join usuarios u on u.id = s.supervisor_id
        where u.auth_user_id = auth.uid()
          and u.rol = 'supervisor'
          and s.id = supervision_fotos.supervision_id
      )
    );
  end if;
end $$;

-- ── cambios_guardia ──────────────────────────────────────────────────
-- Sin uso en codigo todavia. Solo admin hasta que se implemente el flujo.

alter table cambios_guardia enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'cambios_guardia'
      and policyname = 'Admin CRUD cambios_guardia'
  ) then
    create policy "Admin CRUD cambios_guardia"
    on cambios_guardia for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- ── cambios_guardia_evidencias ───────────────────────────────────────
-- Sin uso en codigo todavia. Solo admin hasta que se implemente el flujo.

alter table cambios_guardia_evidencias enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'cambios_guardia_evidencias'
      and policyname = 'Admin CRUD cambios_guardia_evidencias'
  ) then
    create policy "Admin CRUD cambios_guardia_evidencias"
    on cambios_guardia_evidencias for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- ── registros_asistencia_auditoria ───────────────────────────────────
-- Admin: lectura completa.
-- Admin y supervisor: solo INSERT (al corregir registros o cargar manual).
-- Nadie actualiza ni borra registros de auditoria (inmutables por diseno).

alter table registros_asistencia_auditoria enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registros_asistencia_auditoria'
      and policyname = 'Admin lee registros_asistencia_auditoria'
  ) then
    create policy "Admin lee registros_asistencia_auditoria"
    on registros_asistencia_auditoria for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registros_asistencia_auditoria'
      and policyname = 'Admin y supervisor insertan auditoria'
  ) then
    create policy "Admin y supervisor insertan auditoria"
    on registros_asistencia_auditoria for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol in ('admin', 'supervisor')
      )
    );
  end if;
end $$;
