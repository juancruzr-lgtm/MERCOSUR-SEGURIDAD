-- ============================================================================
-- REPARACIÓN · dejar 20260813100000 en su estado final correcto
-- ============================================================================
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- Se ejecutaron seguidos los tres bloques SQL de la revisión: la migración de
-- auditoría, la del diagnóstico GPS y el ROLLBACK (etapa A) de la primera. El
-- tercero deshizo el trigger, la función, el CHECK y las dos columnas de
-- transporte, y conservó (por diseño) la tabla ronda_puntos_auditoria.
--
-- Este script vuelve a dejar la migración 1 completa. Es IDEMPOTENTE: converge
-- al estado correcto sin importar qué subconjunto quedó aplicado, y se puede
-- correr dos veces sin efecto adicional.
--
-- NO destruye nada. NO toca puntos existentes. NO toca la migración 2.
-- ============================================================================

begin;

-- ── Columnas de transporte ──────────────────────────────────────────────────

alter table public.ronda_puntos
  add column if not exists ctx_cambio_origen text,
  add column if not exists ctx_cambio_firma  text;

comment on column public.ronda_puntos.ctx_cambio_origen is
  'COLUMNA DE TRANSPORTE, no es estado del punto. Viaja en el UPDATE para '
  'declarar el origen del cambio (manual | diagnostico_gps). El trigger '
  'trg_ronda_puntos_zz_auditoria la consume y la deja en NULL antes de '
  'persistir. En reposo siempre es NULL (garantizado por CHECK).';

comment on column public.ronda_puntos.ctx_cambio_firma is
  'COLUMNA DE TRANSPORTE, no es estado del punto. Viaja en el UPDATE con la '
  'firma del diagnóstico que originó la sugerencia aplicada. El trigger '
  'trg_ronda_puntos_zz_auditoria la consume y la deja en NULL antes de '
  'persistir. En reposo siempre es NULL (garantizado por CHECK).';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ronda_puntos'::regclass
      and c.conname  = 'ronda_puntos_ctx_cambio_en_reposo'
  ) then
    alter table public.ronda_puntos
      add constraint ronda_puntos_ctx_cambio_en_reposo
      check (ctx_cambio_origen is null and ctx_cambio_firma is null);
  end if;
end;
$$;

-- Los grants por columna se perdieron junto con las columnas al hacer rollback.
grant update (ctx_cambio_origen) on table public.ronda_puntos to authenticated;
grant update (ctx_cambio_firma)  on table public.ronda_puntos to authenticated;

-- ── Tabla de auditoría (sobrevivió al rollback; se reafirma por si acaso) ───

create table if not exists public.ronda_puntos_auditoria (
  id              uuid primary key default gen_random_uuid(),
  ronda_punto_id  uuid not null references public.ronda_puntos(id) on delete cascade,
  ronda_base_id   uuid not null references public.rondas_base(id) on delete restrict,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  origen          text not null,
  firma           text,
  modificado_por  uuid references public.usuarios(id),
  created_at      timestamptz not null default now(),

  constraint ronda_puntos_auditoria_campo_no_vacio
    check (length(btrim(campo)) > 0),
  constraint ronda_puntos_auditoria_origen_valido
    check (origen in ('manual', 'diagnostico_gps')),
  constraint ronda_puntos_auditoria_firma_coherente
    check (
      (origen =  'manual' and firma is null)
      or
      (origen <> 'manual' and firma is not null)
    ),
  constraint ronda_puntos_auditoria_cambio_real
    check (valor_anterior is distinct from valor_nuevo)
);

comment on table public.ronda_puntos_auditoria is
  'Historial de modificaciones de los campos sensibles de ronda_puntos '
  '(radio_metros, latitud, longitud, gps_requerido). Una fila por campo '
  'realmente modificado. Se escribe únicamente desde el trigger '
  'trg_ronda_puntos_zz_auditoria: no hay grants de INSERT/UPDATE/DELETE.';

comment on column public.ronda_puntos_auditoria.origen is
  'manual = edición directa del administrador. diagnostico_gps = se aplicó una '
  'sugerencia del diagnóstico GPS; en ese caso firma identifica el diagnóstico.';

create index if not exists idx_ronda_puntos_auditoria_punto
  on public.ronda_puntos_auditoria (ronda_punto_id, created_at desc);
create index if not exists idx_ronda_puntos_auditoria_base
  on public.ronda_puntos_auditoria (ronda_base_id, created_at desc);
create index if not exists idx_ronda_puntos_auditoria_firma
  on public.ronda_puntos_auditoria (firma) where firma is not null;

alter table public.ronda_puntos_auditoria enable row level security;

revoke all on table public.ronda_puntos_auditoria from public;
revoke all on table public.ronda_puntos_auditoria from anon;
revoke all on table public.ronda_puntos_auditoria from authenticated;

grant select on table public.ronda_puntos_auditoria to authenticated;

drop policy if exists "Admin supervisor lee auditoria de puntos de su alcance"
  on public.ronda_puntos_auditoria;

create policy "Admin supervisor lee auditoria de puntos de su alcance"
on public.ronda_puntos_auditoria
for select
to authenticated
using (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_puntos_auditoria.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

-- ── Trigger de auditoría ────────────────────────────────────────────────────

create or replace function public.ronda_puntos_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_origen  text;
  v_firma   text;
  v_usuario uuid;
begin
  -- 1) Consumir el contexto y limpiarlo SIEMPRE, haya o no algo que auditar.
  v_origen := nullif(btrim(coalesce(new.ctx_cambio_origen, '')), '');
  v_firma  := nullif(btrim(coalesce(new.ctx_cambio_firma,  '')), '');

  new.ctx_cambio_origen := null;
  new.ctx_cambio_firma  := null;

  -- Ausencia de contexto = modificación manual.
  v_origen := coalesce(v_origen, 'manual');

  if v_origen not in ('manual', 'diagnostico_gps') then
    raise exception
      'ronda_punto_ctx_origen_invalido: origen de cambio no reconocido (%)', v_origen
      using errcode = 'check_violation';
  end if;

  if v_origen = 'manual' then
    if v_firma is not null then
      raise exception
        'ronda_punto_ctx_firma_sin_origen: una modificacion manual no lleva firma'
        using errcode = 'check_violation';
    end if;
  elsif v_firma is null then
    raise exception
      'ronda_punto_ctx_firma_faltante: el origen % exige firma del diagnostico', v_origen
      using errcode = 'check_violation';
  elsif length(v_firma) > 120 then
    raise exception
      'ronda_punto_ctx_firma_invalida: firma fuera de formato'
      using errcode = 'check_violation';
  end if;

  -- 2) Sin cambios sensibles no hay auditoría. El contexto ya quedó descartado.
  if new.radio_metros   is not distinct from old.radio_metros
     and new.latitud    is not distinct from old.latitud
     and new.longitud   is not distinct from old.longitud
     and new.gps_requerido is not distinct from old.gps_requerido then
    return new;
  end if;

  v_usuario := public.rondas_usuario_actual_id();

  -- 3) Una fila por campo sensible efectivamente modificado.
  insert into public.ronda_puntos_auditoria (
    ronda_punto_id, ronda_base_id, campo, valor_anterior, valor_nuevo,
    origen, firma, modificado_por
  )
  select
    new.id, new.ronda_base_id, c.campo, c.anterior, c.nuevo,
    v_origen, v_firma, v_usuario
  from (values
    ('radio_metros',  old.radio_metros::text,   new.radio_metros::text),
    ('latitud',       old.latitud::text,        new.latitud::text),
    ('longitud',      old.longitud::text,       new.longitud::text),
    ('gps_requerido', old.gps_requerido::text,  new.gps_requerido::text)
  ) as c(campo, anterior, nuevo)
  where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

revoke all on function public.ronda_puntos_auditar_cambio() from public;
revoke all on function public.ronda_puntos_auditar_cambio() from anon;
revoke all on function public.ronda_puntos_auditar_cambio() from authenticated;

-- `zz_` fuerza el último lugar entre los BEFORE UPDATE. No renombrar.
drop trigger if exists trg_ronda_puntos_zz_auditoria on public.ronda_puntos;
create trigger trg_ronda_puntos_zz_auditoria
  before update on public.ronda_puntos
  for each row execute function public.ronda_puntos_auditar_cambio();

notify pgrst, 'reload schema';

commit;
