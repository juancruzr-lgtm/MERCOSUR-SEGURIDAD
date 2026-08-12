-- ============================================================================
-- RONDAS · Auditoría de cambios sensibles en ronda_puntos
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- La configuración GPS de un punto (radio, coordenadas, exigencia de GPS) es la
-- vara con la que después se juzga si un vigilador cumplió. Hoy esa vara se
-- puede mover sin dejar rastro: `updated_at` dice que algo cambió, no qué, ni
-- desde dónde, ni quién. Esta migración registra cada modificación de un campo
-- sensible, una fila por campo realmente modificado.
--
-- CAMPOS SENSIBLES AUDITADOS
--   radio_metros · latitud · longitud · gps_requerido
--
-- Cambiar el nombre, la descripción, la política de foto o el orden NO genera
-- auditoría: no alteran el veredicto GPS.
--
-- CONTEXTO DEL CAMBIO (por qué dos columnas de transporte)
--
-- La edición de puntos NO pasa por una RPC: `lib/rondas.ts::actualizarPunto`
-- hace un UPDATE directo por PostgREST. No hay, entonces, un parámetro donde
-- viajar el contexto del evento, y un GUC de sesión (`set_config`) no sobrevive
-- al pool de conexiones de PostgREST.
--
-- Se resuelve con dos columnas de TRANSPORTE en ronda_puntos:
--
--   ctx_cambio_origen   'manual' | 'diagnostico_gps'
--   ctx_cambio_firma    firma del diagnóstico que originó la sugerencia
--
-- El cliente las manda EN EL MISMO UPDATE que el cambio. El trigger BEFORE
-- UPDATE las consume, escribe la auditoría y las deja en NULL antes de que la
-- fila se persista. En reposo siempre valen NULL: el contexto del evento nunca
-- se mezcla con el estado permanente del punto.
--
-- Un CHECK de endurecimiento garantiza esa invariante aunque en el futuro
-- alguien borre o desactive el trigger: si el contexto llegara a intentar
-- persistirse, la fila se rechaza.
--
-- AUSENCIA DE CONTEXTO = MODIFICACIÓN MANUAL. Es el default y no exige nada al
-- editor actual: cualquier UPDATE que ya existe hoy sigue funcionando igual y
-- queda auditado como 'manual'.
--
-- ORDEN DE TRIGGERS
--
-- PostgreSQL dispara los BEFORE ROW en orden alfabético de nombre. Los actuales
-- sobre ronda_puntos son:
--
--   trg_ronda_puntos_no_duplicado    (BEFORE INSERT OR UPDATE OF lat, lon, activo)
--   trg_ronda_puntos_politica_foto   (BEFORE INSERT OR UPDATE)
--   trg_ronda_puntos_updated_at      (BEFORE UPDATE)
--   trg_ronda_puntos_zz_auditoria    (BEFORE UPDATE)   ← esta migración
--
-- El prefijo `zz_` es deliberado: la auditoría debe correr ÚLTIMA para registrar
-- el NEW definitivo, después de que política de foto normalice y de que el
-- anti-duplicado haya podido abortar. Si un CHECK, una policy o un trigger
-- posterior falla, la transacción se revierte entera y la fila de auditoría
-- desaparece con ella: no hay auditoría huérfana.
--
-- QUÉ NO TOCA
--   * No cambia ninguna policy existente de ronda_puntos.
--   * No cambia agregar_ronda_punto ni reordenar_ronda_puntos.
--   * No audita INSERT: el alta del punto ya queda en la fila misma.
--   * No modifica ni un solo punto existente.
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

-- Endurecimiento: el contexto no puede quedar guardado. Se valida DESPUÉS de
-- los BEFORE triggers, así que el trigger de auditoría (que las limpia) siempre
-- gana. Efecto colateral buscado: un INSERT que intente traer contexto también
-- se rechaza, porque en el alta no hay nada que auditar.
alter table public.ronda_puntos
  add constraint ronda_puntos_ctx_cambio_en_reposo
  check (ctx_cambio_origen is null and ctx_cambio_firma is null);

-- Los grants de esta tabla son POR COLUMNA. Sin esto el editor recibe
-- "permission denied for column" al mandar el contexto.
-- Se concede UPDATE y no INSERT, a propósito.
grant update (ctx_cambio_origen) on table public.ronda_puntos to authenticated;
grant update (ctx_cambio_firma)  on table public.ronda_puntos to authenticated;

-- ── Tabla de auditoría ──────────────────────────────────────────────────────
-- Misma forma que turnos_auditoria y registros_asistencia_auditoria
-- (campo / valor_anterior / valor_nuevo / modificado_por), más el contexto.

create table public.ronda_puntos_auditoria (
  id              uuid primary key default gen_random_uuid(),
  ronda_punto_id  uuid not null references public.ronda_puntos(id) on delete cascade,
  -- Desnormalizado a propósito: la policy de lectura resuelve el alcance sin
  -- volver a ronda_puntos, y el índice por ronda sirve la vista de historial.
  ronda_base_id   uuid not null references public.rondas_base(id) on delete restrict,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  origen          text not null,
  firma           text,
  -- Nullable a propósito: un UPDATE hecho por una función SECURITY DEFINER, por
  -- un job o desde el editor SQL no tiene auth.uid(). Preferimos auditar sin
  -- autor a no auditar.
  modificado_por  uuid references public.usuarios(id),
  created_at      timestamptz not null default now(),

  constraint ronda_puntos_auditoria_campo_no_vacio
    check (length(btrim(campo)) > 0),

  constraint ronda_puntos_auditoria_origen_valido
    check (origen in ('manual', 'diagnostico_gps')),

  -- Un cambio manual nunca lleva firma; uno derivado de un diagnóstico siempre.
  constraint ronda_puntos_auditoria_firma_coherente
    check (
      (origen =  'manual' and firma is null)
      or
      (origen <> 'manual' and firma is not null)
    ),

  -- Una fila de auditoría que no registra un cambio no es una fila de auditoría.
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

create index idx_ronda_puntos_auditoria_punto
  on public.ronda_puntos_auditoria (ronda_punto_id, created_at desc);

create index idx_ronda_puntos_auditoria_base
  on public.ronda_puntos_auditoria (ronda_base_id, created_at desc);

create index idx_ronda_puntos_auditoria_firma
  on public.ronda_puntos_auditoria (firma)
  where firma is not null;

-- ── RLS y grants de la tabla de auditoría ───────────────────────────────────
-- IMPORTANTE: `authenticated` conserva los DEFAULT PRIVILEGES de Supabase
-- (ver 20260725_m1bis), así que una tabla nueva nace con TODOS los privilegios
-- para ese rol. El REVOKE de abajo no es decorativo.

alter table public.ronda_puntos_auditoria enable row level security;

revoke all on table public.ronda_puntos_auditoria from public;
revoke all on table public.ronda_puntos_auditoria from anon;
revoke all on table public.ronda_puntos_auditoria from authenticated;

grant select on table public.ronda_puntos_auditoria to authenticated;

-- Mismo alcance que "Admin supervisor lee puntos de su alcance".
-- No hay policy de INSERT/UPDATE/DELETE: la auditoría no se forja ni se borra.
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
-- SECURITY DEFINER porque la tabla tiene RLS y ninguna policy de INSERT: el
-- dueño de la tabla es el único que escribe, y sólo a través de este trigger.

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
