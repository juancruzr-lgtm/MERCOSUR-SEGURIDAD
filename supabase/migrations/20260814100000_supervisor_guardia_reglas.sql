-- ============================================================================
-- PROGRAMACIÓN SEMANAL DE SUPERVISORES — plantilla + calendario efectivo
-- ============================================================================
--
-- Hoy `supervisores_guardia` se carga día por día a mano. Esta migración
-- agrega la capa que faltaba: una REGLA SEMANAL por supervisor/zona/horario
-- que sirve de plantilla, y la trazabilidad para generar desde ella las filas
-- diarias sin perder las excepciones.
--
-- Es el mismo patrón que ya usa la programación de objetivos
-- (`servicios_objetivo` → `turnos`): la plantilla no es el calendario. Lo que
-- leen las alertas, la Vista Supervisor y el reparto de carga sigue siendo
-- `supervisores_guardia`, porque ahí están los francos, reemplazos y
-- coberturas reales.
--
-- ESTA MIGRACIÓN ES ADITIVA Y REVERSIBLE.
--
-- Rollback: supabase/rollback/20260814100000_supervisor_guardia_reglas_rollback.sql
--
-- ── QUÉ NO TOCA, NI UNA FILA ────────────────────────────────────────────────
--   registros_asistencia   turnos               horas liquidables
--   servicios_objetivo     turnos_base          objetivos / usuarios
--   supervisor_zonas       zonas_operativas     supervisor_intervenciones
--   las filas ya cargadas en supervisores_guardia
--
-- Sobre `supervisores_guardia` sólo agrega cuatro columnas nullable (o con
-- default), suelta un default equivocado y crea un índice único. No modifica
-- ninguna fila existente ni ninguna policy.
--
-- ── POR QUÉ SE SUELTA EL DEFAULT DE `zona` ──────────────────────────────────
-- `zona text not null default 'Rosario / General'` es la causa del problema
-- que se viene arrastrando: ese string no es el nombre de ninguna fila de
-- `zonas_operativas`, y desde que la búsqueda del supervisor de guardia
-- compara contra la zona real del objetivo, toda guardia cargada con el
-- default quedaba invisible. Sin default, una inserción que se olvide la zona
-- falla de entrada en lugar de fallar en silencio seis meses después.
-- Las filas ya cargadas no se tocan: soltar un default no reescribe datos.
--
-- ── POR QUÉ LA REGLA GUARDA `zona_id` Y LA FILA DIARIA SIGUE EN TEXTO ───────
-- La regla referencia `zonas_operativas(id)`: es la fuente de verdad y no
-- puede quedar desincronizada de un renombre. La fila diaria conserva
-- `zona text` porque es lo que hoy leen las dos pantallas; la generación
-- escribe siempre el nombre canónico de la zona, así que el texto libre deja
-- de divergir en la práctica. Migrar los lectores a `zona_id` es un paso
-- posterior y separado.
--
-- ── VOCABULARIO ─────────────────────────────────────────────────────────────
-- `tipo_evento` copia el vocabulario que ya usan los turnos: 'normal' es la
-- guardia tal como salió de la regla, y el resto son excepciones del día.
-- 'franco' y 'ausencia' significan que ese día NO hay cobertura: quien lea
-- las guardias efectivas tiene que excluirlas, igual que hace la revisión
-- operativa con los turnos reemplazados/anulados.
-- ============================================================================

begin;

-- ── Guardas de dependencia ──────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.usuarios') is null then
    raise exception 'Dependencia faltante: tabla public.usuarios';
  end if;
  if to_regclass('public.zonas_operativas') is null then
    raise exception 'Dependencia faltante: tabla public.zonas_operativas';
  end if;
  if to_regclass('public.supervisores_guardia') is null then
    raise exception 'Dependencia faltante: tabla public.supervisores_guardia';
  end if;
end $$;

-- ── 1. Regla semanal (la plantilla) ─────────────────────────────────────────
--
-- Un supervisor puede tener varias reglas: Sabino son tres (dom-jue 07-19,
-- vie 07-13, vie 19-07). Eso es deliberado — una regla es un bloque horario
-- con sus días, no "el horario del supervisor".
create table if not exists public.supervisor_guardia_reglas (
  id             uuid primary key default gen_random_uuid(),
  supervisor_id  uuid not null references public.usuarios(id),
  zona_id        uuid not null references public.zonas_operativas(id),
  -- 1=Lunes … 7=Domingo, igual que servicios_objetivo.dias_semana
  dias_semana    smallint[] not null,
  hora_inicio    time not null,
  hora_fin       time not null,
  -- hora_fin <= hora_inicio significa que cruza la medianoche; la fila diaria
  -- se genera con la fecha de INICIO, igual que ya funcionaba a mano.
  rol_operativo  text not null default 'supervisor',
  observacion    text,
  activo         boolean not null default true,
  -- Vigencia opcional: sirve para que un cambio de programación no reescriba
  -- la historia ni obligue a borrar la regla anterior.
  vigencia_desde date,
  vigencia_hasta date,
  creado_por     uuid references public.usuarios(id),
  created_at     timestamptz not null default now(),

  constraint supervisor_guardia_reglas_dias_validos check (
    array_length(dias_semana, 1) between 1 and 7
    and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint supervisor_guardia_reglas_rol_valido check (
    rol_operativo in ('supervisor', 'jefe_operativo', 'director_tecnico')
  ),
  constraint supervisor_guardia_reglas_vigencia_coherente check (
    vigencia_desde is null or vigencia_hasta is null or vigencia_hasta >= vigencia_desde
  )
);

create index if not exists idx_supervisor_guardia_reglas_supervisor
  on public.supervisor_guardia_reglas (supervisor_id);
create index if not exists idx_supervisor_guardia_reglas_zona
  on public.supervisor_guardia_reglas (zona_id);
create index if not exists idx_supervisor_guardia_reglas_activo
  on public.supervisor_guardia_reglas (activo);

-- ── 2. Trazabilidad en el calendario efectivo ───────────────────────────────
--
-- `regla_id` es lo que hace que regenerar un mes sea idempotente aunque el
-- día haya sido editado: si ya existe una fila de esa regla para esa fecha,
-- no se vuelve a crear, tenga el horario que tenga. Sin esta columna, un
-- cambio puntual de horario haría aparecer un duplicado en la regeneración.
alter table public.supervisores_guardia
  add column if not exists regla_id uuid references public.supervisor_guardia_reglas(id) on delete set null;

alter table public.supervisores_guardia
  add column if not exists origen text not null default 'manual';

alter table public.supervisores_guardia
  add column if not exists tipo_evento text not null default 'normal';

-- Reemplazo: se edita el supervisor de la fila y queda registrado a quién
-- cubre. Mismo criterio que guardia_original_id en turnos.
alter table public.supervisores_guardia
  add column if not exists supervisor_original_id uuid references public.usuarios(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supervisores_guardia_origen_valido'
  ) then
    alter table public.supervisores_guardia
      add constraint supervisores_guardia_origen_valido
      check (origen in ('manual', 'regla'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supervisores_guardia_tipo_evento_valido'
  ) then
    alter table public.supervisores_guardia
      add constraint supervisores_guardia_tipo_evento_valido
      check (tipo_evento in (
        'normal', 'franco', 'ausencia', 'reemplazo', 'cobertura', 'cambio_horario'
      ));
  end if;
end $$;

create index if not exists idx_supervisores_guardia_regla
  on public.supervisores_guardia (regla_id, fecha);
create index if not exists idx_supervisores_guardia_zona_fecha
  on public.supervisores_guardia (zona, fecha);

-- ── 3. El default que rompía la búsqueda por zona ───────────────────────────
alter table public.supervisores_guardia alter column zona drop default;

-- ── 4. Duplicado exacto, garantizado en la base ─────────────────────────────
--
-- La zona va normalizada porque en producción conviven 'rafaela' y 'Rafaela'.
-- Sin esto, la deduplicación viviría sólo en el cliente y dos pestañas
-- abiertas alcanzarían para duplicar un mes entero.
create unique index if not exists uq_supervisores_guardia_slot
  on public.supervisores_guardia (supervisor_id, fecha, hora_inicio, hora_fin, lower(btrim(zona)));

-- ── 5. Permisos ─────────────────────────────────────────────────────────────
--
-- Mismo nivel que `supervisores_guardia`, que es lo que esta tabla programa:
-- nada para anon, todo para el usuario autenticado. Endurecer por rol es una
-- fase aparte y tiene que hacerse sobre las dos tablas a la vez, no sobre una.
alter table public.supervisor_guardia_reglas enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'supervisor_guardia_reglas'
      and policyname = 'supervisor_guardia_reglas_autenticado'
  ) then
    create policy supervisor_guardia_reglas_autenticado
      on public.supervisor_guardia_reglas
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

revoke all on public.supervisor_guardia_reglas from anon;
grant select, insert, update, delete on public.supervisor_guardia_reglas to authenticated;

commit;
