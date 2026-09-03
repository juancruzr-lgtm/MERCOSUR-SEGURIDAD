-- ============================================================================
-- NOCTURNIDAD · Excepción por empleado+objetivo y ajuste mensual manual
-- ============================================================================
--
-- Completa el modelo de 20260904100000 (nocturnidad general del objetivo) con
-- los otros dos niveles que la operación real necesita:
--
--   1º  Ajuste mensual manual por empleado/período  → valor FINAL informado.
--   2º  Excepción empleado+objetivo (heredar/si/no) → decide si se calcula.
--   3º  Configuración general del objetivo          → la regla por defecto.
--
-- AJUSTE MENSUAL — se reutiliza novedades_laborales, no se crea tabla nueva:
-- la tabla ya tiene horas_afectadas numeric(5,2), rango de fechas, flujo
-- cargado→aprobado con autoría (cargado_por / aprobado_por / timestamps) que
-- cubre la auditoría mínima. Sólo hace falta admitir el tipo nuevo
-- 'ajuste_nocturnidad' en el CHECK. Semántica: una novedad aprobada de ese
-- tipo cuyo rango cae en el mes fija las horas nocturnas FINALES del empleado
-- para ese período (no se suma al cálculo: lo reemplaza). Los consumidores de
-- clasificación de día no se ven afectados: el tipo no está en JUSTIFICAN ni
-- es falta_injustificada, así que un día cubierto sólo por el ajuste sigue
-- siendo 'sin_clasificar'.
--
-- EXCEPCIÓN EMPLEADO+OBJETIVO — no existe ninguna relación canónica
-- empleado↔objetivo en el modelo (la asignación es por turno), así que se crea
-- la tabla mínima. Tres modos, porque 'heredar' y 'no' son cosas distintas:
--   heredar → vale lo que diga el objetivo (equivalente a no tener fila)
--   si      → cobra nocturnidad aunque el objetivo no la tenga activa
--   no      → no cobra aunque el objetivo la tenga activa
--
-- AUDITORÍA — sin sistema nuevo: un trigger vuelca los cambios de la
-- excepción en objetivos_auditoria (la auditoría existente del objetivo), con
-- campo 'nocturnidad_empleado:<empleado_id>'. Quién, cuándo, antes/después,
-- visible con el mismo alcance que el resto de la auditoría del objetivo.
--
-- SEGURIDAD — la tabla nueva NO queda escribible por cualquier autenticado
-- (sería un agujero nuevo): RLS habilitada, escritura sólo admin con el
-- patrón vigente del sistema, lectura para authenticated. No amplía ningún
-- permiso existente; F1 sigue viajando por su propia serie.
-- ============================================================================

begin;

-- ── 1) Tipo de novedad para el ajuste mensual ───────────────────────────────

alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_tipo_check;

alter table public.novedades_laborales
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
    'otra',
    'ajuste_nocturnidad'
  ));

-- Un ajuste de nocturnidad sin cantidad de horas no significa nada.
alter table public.novedades_laborales
  add constraint novedades_laborales_ajuste_nocturnidad_horas
  check (tipo <> 'ajuste_nocturnidad' or horas_afectadas is not null);

comment on constraint novedades_laborales_ajuste_nocturnidad_horas
  on public.novedades_laborales is
  'El tipo ajuste_nocturnidad fija en horas_afectadas las horas nocturnas '
  'FINALES del empleado para el período que cubre el rango de fechas. '
  'Reemplaza al cálculo automático, no se le suma.';

-- ── 2) Excepción empleado+objetivo ──────────────────────────────────────────

create table public.nocturnidad_empleado_objetivo (
  id           uuid primary key default gen_random_uuid(),
  objetivo_id  uuid not null references public.objetivos(id) on delete cascade,
  empleado_id  uuid not null references public.usuarios(id)  on delete cascade,
  -- heredar = vale la configuración del objetivo (igual que no tener fila);
  -- si / no = fuerza el resultado para ese empleado en ese objetivo.
  modo         text not null default 'heredar',
  actualizado_por uuid references public.usuarios(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint nocturnidad_empleado_objetivo_modo
    check (modo in ('heredar', 'si', 'no')),

  constraint nocturnidad_empleado_objetivo_unico
    unique (objetivo_id, empleado_id)
);

comment on table public.nocturnidad_empleado_objetivo is
  'Excepción de nocturnidad por empleado dentro de un objetivo. La precedencia '
  'del Resumen Guardia es: ajuste mensual manual (novedades_laborales tipo '
  'ajuste_nocturnidad) > esta excepción > configuración del objetivo. La '
  'configuración pertenece a la COMBINACIÓN empleado+objetivo: la misma '
  'persona puede cobrar nocturnidad en un objetivo y no en otro.';

-- ── 3) Auditoría vía la infraestructura existente del objetivo ──────────────

create or replace function public.nocturnidad_excepcion_auditar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario uuid;
  v_objetivo uuid;
  v_empleado uuid;
  v_anterior text;
  v_nuevo text;
begin
  select u.id into v_usuario
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  if tg_op = 'INSERT' then
    v_objetivo := new.objetivo_id; v_empleado := new.empleado_id;
    v_anterior := null;            v_nuevo := new.modo;
    new.actualizado_por := coalesce(v_usuario, new.actualizado_por);
  elsif tg_op = 'UPDATE' then
    v_objetivo := new.objetivo_id; v_empleado := new.empleado_id;
    v_anterior := old.modo;        v_nuevo := new.modo;
    new.updated_at := now();
    new.actualizado_por := coalesce(v_usuario, new.actualizado_por);
    if v_anterior is not distinct from v_nuevo then
      return new;
    end if;
  else -- DELETE: quitar la fila equivale a volver a 'heredar'
    v_objetivo := old.objetivo_id; v_empleado := old.empleado_id;
    v_anterior := old.modo;        v_nuevo := 'heredar';
  end if;

  insert into public.objetivos_auditoria (
    objetivo_id, campo, valor_anterior, valor_nuevo, origen, firma, modificado_por
  ) values (
    v_objetivo,
    'nocturnidad_empleado:' || v_empleado::text,
    v_anterior,
    v_nuevo,
    'manual',
    null,
    v_usuario
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.nocturnidad_excepcion_auditar() from public;
revoke all on function public.nocturnidad_excepcion_auditar() from anon;
revoke all on function public.nocturnidad_excepcion_auditar() from authenticated;

create trigger trg_nocturnidad_excepcion_zz_auditoria
  before insert or update or delete on public.nocturnidad_empleado_objetivo
  for each row execute function public.nocturnidad_excepcion_auditar();

-- ── 4) RLS y grants de la tabla nueva ───────────────────────────────────────
-- `authenticated` hereda DEFAULT PRIVILEGES totales (ver M1-bis): el REVOKE
-- es imprescindible para que la tabla no nazca escribible por cualquiera.

alter table public.nocturnidad_empleado_objetivo enable row level security;

revoke all on table public.nocturnidad_empleado_objetivo from public;
revoke all on table public.nocturnidad_empleado_objetivo from anon;
revoke all on table public.nocturnidad_empleado_objetivo from authenticated;

grant select, insert, update, delete
  on table public.nocturnidad_empleado_objetivo to authenticated;

create policy "Lectura autenticada de excepciones de nocturnidad"
on public.nocturnidad_empleado_objetivo
for select
to authenticated
using (true);

-- Escritura sólo admin: mismo patrón inline vigente en el resto del sistema.
create policy "Solo admin escribe excepciones de nocturnidad"
on public.nocturnidad_empleado_objetivo
for all
to authenticated
using (
  exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.rol = 'admin'
      and u.estado = 'activo'
  )
)
with check (
  exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.rol = 'admin'
      and u.estado = 'activo'
  )
);

notify pgrst, 'reload schema';

commit;
