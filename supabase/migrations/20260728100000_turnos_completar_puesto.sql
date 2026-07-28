/*
================================================================================
turnos.puesto_id — completado automático, backfill y FK compuesta
================================================================================

CAUSA RAÍZ
  Ninguna de las cuatro rutas de alta de turnos escribe `puesto_id`:
    app/dashboard/AppClient.tsx:3441        alta individual del administrador
    app/dashboard/AppClient.tsx:4005        carga manual desde Reportes
    app/dashboard/AppClient.tsx:6413        generación mensual
    components/supervisor/SupervisorMobile.tsx:1177 y :1254  alta y repetir día

  `20260707_turnos_puesto_id.sql` agregó la columna como nullable e hizo backfill
  de los turnos existentes en ese momento, pero no se actualizó ninguna ruta de
  creación. Desde entonces todo turno nace con `puesto_id = null`.

  Medición previa a esta migración: 875 turnos sin puesto.
    722 en 24 objetivos con exactamente un puesto activo  -> se completan acá
    153 en  6 objetivos sin ningún puesto activo          -> NO se tocan

  El síntoma que lo hizo visible: `obtener_rondas_guardia_actual()` devuelve
  `turno_sin_puesto` y el vigilador de LA CASONA no ve sus rondas.

QUÉ HACE
  1. Función y trigger BEFORE INSERT que completan `puesto_id` únicamente cuando
     el objetivo tiene exactamente un puesto activo. Con 0 o 2+ deja el null y la
     validación queda en la aplicación, que sí puede mostrar un mensaje útil.
  2. Backfill de los turnos ya existentes bajo la misma regla, con conteo.
  3. Reemplazo de la FK simple `turnos_puesto_id_fkey` por una compuesta contra
     `puestos (id, objetivo_id)`, para que un turno no pueda apuntar a un puesto
     de otro objetivo.

QUÉ NO HACE
  * No modifica guardia, guardia_original_id, guardia_real_id, fecha, horarios,
    estado, tipo_evento, estado_revision, reemplazos, fichajes ni horas
    liquidables. Sólo escribe la columna `puesto_id`.
  * No inventa puestos. Los 6 objetivos sin puestos activos quedan intactos.
  * No impone `NOT NULL` sobre `puesto_id`: hay 153 turnos legítimos que no
    pueden completarse y no se los va a romper.

POR QUÉ EL TRIGGER Y NO SÓLO EL FRONTEND
  Cubre las cuatro rutas de una vez, más la generación mensual y cualquier carga
  futura o script. Resolverlo sólo en el cliente obliga a tocar cuatro lugares y
  deja la puerta abierta a que una quinta ruta reintroduzca el problema.

COMPORTAMIENTO DE LA FK
  La FK original se declaró como `references puestos(id)` sin cláusula
  `ON DELETE` (ver 20260707_turnos_puesto_id.sql:11), es decir NO ACTION.
  La compuesta preserva exactamente ese comportamiento: tampoco lleva
  `ON DELETE`. No se cambia a RESTRICT ni a CASCADE.

  Depende del índice único `puestos (id, objetivo_id)`, que ya existe: lo creó
  `20260725230000_rondas_correctivo_arquitectura.sql`. Si no estuviera, esta
  migración aborta con un mensaje explícito.

REVERSIBILIDAD
  El backfill registra los turnos que modifica en `turnos_puesto_backfill_20260728`
  para que el rollback pueda devolverlos a null de forma exacta.

IDEMPOTENCIA
  Reejecutable. La función usa `create or replace`, el trigger se recrea, el
  backfill sólo alcanza filas con `puesto_id is null` y la FK se verifica por
  catálogo antes de crearse.

ROLLBACK
  supabase/rollback/20260728100000_turnos_completar_puesto_rollback.sql
================================================================================
*/

begin;

-- ── 1. Completado automático en el alta ─────────────────────────────────────

create or replace function public.turnos_completar_puesto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_activos   integer;
  v_puesto_id uuid;
begin
  -- Si quien inserta ya eligió un puesto, se respeta tal cual.
  if new.puesto_id is not null then
    return new;
  end if;

  if new.objetivo_id is null then
    return new;
  end if;

  select count(*), min(p.id)
    into v_activos, v_puesto_id
    from public.puestos p
   where p.objetivo_id = new.objetivo_id
     and p.activo;

  -- Sólo se asigna cuando no hay ambigüedad posible.
  if v_activos = 1 then
    new.puesto_id := v_puesto_id;
  end if;

  return new;
end;
$$;

revoke all on function public.turnos_completar_puesto() from public;

drop trigger if exists trg_turnos_completar_puesto on public.turnos;

create trigger trg_turnos_completar_puesto
  before insert on public.turnos
  for each row execute function public.turnos_completar_puesto();

-- ── 2. Backfill de los turnos existentes ────────────────────────────────────

create table if not exists public.turnos_puesto_backfill_20260728 (
  turno_id   uuid primary key,
  puesto_id  uuid not null,
  aplicado_at timestamptz not null default now()
);

do $$
declare
  v_pendientes_antes  integer;
  v_corregidos        integer;
  v_pendientes_despues integer;
  v_sin_puestos       integer;
begin
  select count(*) into v_pendientes_antes
    from public.turnos where puesto_id is null;

  with puesto_unico as (
    select objetivo_id, (array_agg(id order by id))[1] as puesto_id
      from public.puestos
     where activo
     group by objetivo_id
    having count(*) = 1
  ),
  aplicados as (
    update public.turnos t
       set puesto_id = pu.puesto_id
      from puesto_unico pu
     where pu.objetivo_id = t.objetivo_id
       and t.puesto_id is null
    returning t.id, t.puesto_id
  )
  insert into public.turnos_puesto_backfill_20260728 (turno_id, puesto_id)
  select id, puesto_id from aplicados
  on conflict (turno_id) do nothing;

  get diagnostics v_corregidos = row_count;

  select count(*) into v_pendientes_despues
    from public.turnos where puesto_id is null;

  select count(*) into v_sin_puestos
    from public.turnos t
   where t.puesto_id is null
     and not exists (
       select 1 from public.puestos p
        where p.objetivo_id = t.objetivo_id and p.activo
     );

  raise notice '══════════════════════════════════════════════';
  raise notice 'BACKFILL turnos.puesto_id';
  raise notice '  Sin puesto antes      : %', v_pendientes_antes;
  raise notice '  Corregidos            : %', v_corregidos;
  raise notice '  Sin puesto después    : %', v_pendientes_despues;
  raise notice '    de los cuales, por objetivo sin puestos activos: %', v_sin_puestos;
  raise notice '══════════════════════════════════════════════';
end;
$$;

-- ── 3. FK simple -> FK compuesta ────────────────────────────────────────────

do $$
begin
  -- El índice de respaldo debe existir (lo crea la migración de rondas).
  if not exists (
    select 1 from pg_class c
     where c.relname = 'puestos_id_objetivo_unique'
       and c.relnamespace = 'public'::regnamespace
  ) then
    raise exception
      'Falta el índice único puestos (id, objetivo_id). Aplicar primero '
      '20260725230000_rondas_correctivo_arquitectura.sql';
  end if;

  -- Ninguna fila puede apuntar a un puesto de otro objetivo.
  if exists (
    select 1
      from public.turnos t
      join public.puestos p on p.id = t.puesto_id
     where p.objetivo_id is distinct from t.objetivo_id
  ) then
    raise exception
      'Hay turnos cuyo puesto pertenece a otro objetivo. Resolverlos antes de '
      'imponer la FK compuesta.';
  end if;

  -- Se elimina la FK simple para no dejar dos restricciones redundantes
  -- sobre la misma columna.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.turnos'::regclass
       and conname  = 'turnos_puesto_id_fkey'
  ) then
    alter table public.turnos drop constraint turnos_puesto_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turnos'::regclass
       and conname  = 'turnos_puesto_objetivo_fkey'
  ) then
    -- Sin ON DELETE, igual que la FK original: NO ACTION.
    alter table public.turnos
      add constraint turnos_puesto_objetivo_fkey
      foreign key (puesto_id, objetivo_id)
      references public.puestos (id, objetivo_id);
  end if;
end;
$$;

commit;
