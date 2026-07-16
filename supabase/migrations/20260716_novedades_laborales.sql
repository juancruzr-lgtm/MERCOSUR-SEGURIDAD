/*
  C1 — Novedades laborales estructuradas

  Esta tabla registra novedades laborales de empleados (parte médico,
  vacaciones, licencias, etc.) para uso en reportes de liquidación y
  conciliación mensual.

  IMPORTANTE: esta tabla es DISTINTA a la tabla `novedades` operativa
  (que registra incidencias en objetivos). No relacionarlas.

  Bucket de Storage para comprobantes: "novedades-comprobantes".
  Debe crearse manualmente en Supabase → Storage antes de subir archivos.
  Esta migración solo define documento_path como texto.

  Roles en sistema al momento de esta migración:
    admin, supervisor, guardia, vigilador
  El rol jefe_operativo está previsto en la arquitectura pero no existe
  todavía en la columna usuarios.rol. Cuando se agregue, extender las
  políticas de esta tabla.

  Idempotente: usa IF NOT EXISTS en tabla, índices y restricciones.
  Las políticas RLS usan el patrón do $$ begin / if not exists / end $$.
*/

-- ── Función compartida para updated_at ───────────────────────────────────
-- Si ya existe en el schema (de otra tabla) no la recrea.

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Tabla principal ───────────────────────────────────────────────────────

create table if not exists novedades_laborales (
  id              uuid        primary key default gen_random_uuid(),

  -- Empleado al que corresponde la novedad
  empleado_id     uuid        not null references usuarios(id) on delete restrict,

  -- Tipo estructurado (no texto libre)
  tipo            text        not null,

  -- Rango de fechas — fecha_hasta >= fecha_desde (ver constraint abajo)
  fecha_desde     date        not null,
  fecha_hasta     date        not null,

  -- Calculado automáticamente al insertar/actualizar
  cantidad_dias   integer     generated always as (fecha_hasta - fecha_desde + 1) stored,

  -- Horas afectadas solo cuando aplica (ej. suspensión parcial, accidente con baja parcial)
  horas_afectadas numeric(5,2) check (horas_afectadas is null or horas_afectadas >= 0),

  -- Descripción libre
  observacion     text,

  -- Path en Storage bucket "novedades-comprobantes" (opcional)
  documento_path  text,

  -- Quién la cargó en el sistema
  cargado_por     uuid        not null references usuarios(id),

  -- Flujo de aprobación
  estado          text        not null default 'pendiente',
  aprobado_por    uuid        references usuarios(id),
  aprobado_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Restricciones ─────────────────────────────────────────────────────────

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'novedades_laborales_tipo_check'
  ) then
    alter table novedades_laborales
      add constraint novedades_laborales_tipo_check
      check (tipo in (
        'parte_medico',
        'accidente',
        'licencia',
        'vacaciones',
        'falta_justificada',
        'falta_injustificada',
        'dia_estudio',
        'suspension',
        'franco',
        'otra'
      ));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'novedades_laborales_estado_check'
  ) then
    alter table novedades_laborales
      add constraint novedades_laborales_estado_check
      check (estado in ('pendiente', 'aprobada', 'rechazada'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'novedades_laborales_fechas_check'
  ) then
    alter table novedades_laborales
      add constraint novedades_laborales_fechas_check
      check (fecha_hasta >= fecha_desde);
  end if;
end $$;

-- aprobado_por solo se completa cuando el estado deja de ser 'pendiente'
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'novedades_laborales_aprobacion_check'
  ) then
    alter table novedades_laborales
      add constraint novedades_laborales_aprobacion_check
      check (
        (estado = 'pendiente' and aprobado_por is null and aprobado_at is null)
        or
        (estado in ('aprobada', 'rechazada') and aprobado_por is not null and aprobado_at is not null)
      );
  end if;
end $$;

-- ── Trigger updated_at ────────────────────────────────────────────────────

drop trigger if exists trg_novedades_laborales_updated_at on novedades_laborales;
create trigger trg_novedades_laborales_updated_at
  before update on novedades_laborales
  for each row execute function set_updated_at();

-- ── Índices ───────────────────────────────────────────────────────────────

create index if not exists idx_novedades_laborales_empleado
  on novedades_laborales (empleado_id, fecha_desde desc);

create index if not exists idx_novedades_laborales_tipo_estado
  on novedades_laborales (tipo, estado);

create index if not exists idx_novedades_laborales_rango
  on novedades_laborales using gist (empleado_id, daterange(fecha_desde, fecha_hasta, '[]'));

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table novedades_laborales enable row level security;

-- Admin: CRUD completo sobre todas las novedades
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'novedades_laborales'
      and policyname = 'Admin CRUD novedades_laborales'
  ) then
    create policy "Admin CRUD novedades_laborales"
    on novedades_laborales for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- Supervisor: puede insertar novedades y leer las que cargó él mismo.
-- No puede aprobar ni rechazar (eso es de admin).
-- El alcance por zona se aplica en UI; a nivel RLS se permite por cargado_por.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'novedades_laborales'
      and policyname = 'Supervisor insert novedades_laborales'
  ) then
    create policy "Supervisor insert novedades_laborales"
    on novedades_laborales for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol = 'supervisor'
          and id = novedades_laborales.cargado_por
      )
    );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'novedades_laborales'
      and policyname = 'Supervisor lee sus novedades_laborales cargadas'
  ) then
    create policy "Supervisor lee sus novedades_laborales cargadas"
    on novedades_laborales for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol = 'supervisor'
          and id = novedades_laborales.cargado_por
      )
    );
  end if;
end $$;

-- Guardia / vigilador: puede leer sus propias novedades (preparado para
-- cuando se habilite la vista en la app del guardia).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'novedades_laborales'
      and policyname = 'Guardia lee sus novedades_laborales'
  ) then
    create policy "Guardia lee sus novedades_laborales"
    on novedades_laborales for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where auth_user_id = auth.uid()
          and rol in ('guardia', 'vigilador')
          and id = novedades_laborales.empleado_id
      )
    );
  end if;
end $$;

-- ── Nota sobre jefe_operativo ─────────────────────────────────────────────
-- Cuando se agregue el rol jefe_operativo al sistema, extender con:
--
-- create policy "Jefe operativo CRUD novedades_laborales"
-- on novedades_laborales for all to authenticated
-- using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'jefe_operativo'))
-- with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'jefe_operativo'));
--
-- Ajustar alcance según definición final del rol.
