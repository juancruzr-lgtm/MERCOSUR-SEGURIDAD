-- ============================================================================
-- OBJETIVOS · Auditoría de cambios de ubicación y radio
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- El radio de un objetivo decide dónde puede fichar la gente. Moverlo 200
-- metros puede convertir un turno entero en "fuera de radio", o habilitar
-- fichajes desde la vereda de enfrente. Hoy ese cambio no deja ningún rastro:
-- `objetivos` no tiene un solo trigger, y su política RLS sigue siendo la
-- permisiva original, así que cualquier usuario con sesión puede escribirlo.
--
-- Esta migración no cambia quién puede escribir —eso es otra discusión— pero
-- sí garantiza que, escriba quien escriba, quede registrado qué cambió, de
-- cuánto a cuánto, quién lo hizo y desde dónde vino el cambio.
--
-- Es la migración simétrica a 20260813100000 (auditoría de ronda_puntos), con
-- las mismas decisiones y por los mismos motivos.
--
-- CAMPOS SENSIBLES AUDITADOS
--   lat · lng · radio_metros
--
-- Cambiar nombre, cliente, dirección, zona o estado NO genera auditoría: no
-- alteran el veredicto GPS de ningún fichaje.
--
-- CONTEXTO DEL CAMBIO
--
-- Igual que en ronda_puntos: dos columnas de TRANSPORTE que el cliente manda
-- en el mismo UPDATE y que el trigger consume y deja en NULL antes de
-- persistir. Ausencia de contexto = modificación manual, que es el caso normal
-- y no exige nada a los escritores que ya existen.
--
-- Se dejan preparadas para cuando exista el diagnóstico de objetivos a partir
-- de los fichajes reales. Hoy sólo se usa 'manual'.
--
-- ORDEN DE TRIGGERS
--
-- `objetivos` no tiene ningún otro trigger. Se conserva igual el prefijo `zz_`
-- por consistencia con ronda_puntos: si mañana alguien agrega un BEFORE que
-- normalice algo, la auditoría tiene que seguir corriendo última para registrar
-- el NEW definitivo.
--
-- QUÉ NO TOCA
--   * Ninguna política RLS de objetivos.
--   * Ningún camino de escritura existente: los cuatro siguen funcionando
--     igual y ahora quedan auditados sin cambiarles una línea.
--   * Ningún objetivo existente.
-- ============================================================================

begin;

-- ── Columnas de transporte ──────────────────────────────────────────────────

alter table public.objetivos
  add column if not exists ctx_cambio_origen text,
  add column if not exists ctx_cambio_firma  text;

comment on column public.objetivos.ctx_cambio_origen is
  'COLUMNA DE TRANSPORTE, no es estado del objetivo. Viaja en el UPDATE para '
  'declarar el origen del cambio (manual | diagnostico_gps). El trigger '
  'trg_objetivos_zz_auditoria la consume y la deja en NULL antes de persistir. '
  'En reposo siempre es NULL (garantizado por CHECK).';

comment on column public.objetivos.ctx_cambio_firma is
  'COLUMNA DE TRANSPORTE, no es estado del objetivo. Firma del diagnóstico que '
  'originó la sugerencia aplicada. El trigger la consume y la deja en NULL '
  'antes de persistir. En reposo siempre es NULL (garantizado por CHECK).';

alter table public.objetivos
  add constraint objetivos_ctx_cambio_en_reposo
  check (ctx_cambio_origen is null and ctx_cambio_firma is null);

-- ── Tabla de auditoría ──────────────────────────────────────────────────────

create table public.objetivos_auditoria (
  id              uuid primary key default gen_random_uuid(),
  objetivo_id     uuid not null references public.objetivos(id) on delete cascade,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  origen          text not null,
  firma           text,
  -- Nullable a propósito: un UPDATE hecho por una función SECURITY DEFINER,
  -- por un job o desde el editor SQL no tiene auth.uid(). Preferimos auditar
  -- sin autor a no auditar.
  modificado_por  uuid references public.usuarios(id),
  created_at      timestamptz not null default now(),

  constraint objetivos_auditoria_campo_no_vacio
    check (length(btrim(campo)) > 0),

  constraint objetivos_auditoria_origen_valido
    check (origen in ('manual', 'diagnostico_gps')),

  constraint objetivos_auditoria_firma_coherente
    check (
      (origen =  'manual' and firma is null)
      or
      (origen <> 'manual' and firma is not null)
    ),

  constraint objetivos_auditoria_cambio_real
    check (valor_anterior is distinct from valor_nuevo)
);

comment on table public.objetivos_auditoria is
  'Historial de modificaciones de la ubicación y el radio de los objetivos '
  '(lat, lng, radio_metros). Una fila por campo realmente modificado. Se '
  'escribe únicamente desde el trigger trg_objetivos_zz_auditoria: no hay '
  'grants de INSERT/UPDATE/DELETE.';

create index idx_objetivos_auditoria_objetivo
  on public.objetivos_auditoria (objetivo_id, created_at desc);

create index idx_objetivos_auditoria_firma
  on public.objetivos_auditoria (firma)
  where firma is not null;

-- ── RLS y grants ────────────────────────────────────────────────────────────
-- `authenticated` conserva los DEFAULT PRIVILEGES de Supabase (ver M1-bis), así
-- que una tabla nueva nace con todos los privilegios para ese rol. El REVOKE
-- de abajo no es decorativo.

alter table public.objetivos_auditoria enable row level security;

revoke all on table public.objetivos_auditoria from public;
revoke all on table public.objetivos_auditoria from anon;
revoke all on table public.objetivos_auditoria from authenticated;

grant select on table public.objetivos_auditoria to authenticated;

-- Mismo alcance que se usa para administrar un objetivo: admin siempre,
-- supervisor sólo sobre los objetivos de sus zonas. El helper se llama
-- `..._rondas_objetivo` por dónde nació, pero lo que resuelve es alcance sobre
-- el objetivo, que es exactamente lo que hace falta acá.
create policy "Admin supervisor lee auditoria de objetivos de su alcance"
on public.objetivos_auditoria
for select
to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

-- ── Trigger de auditoría ────────────────────────────────────────────────────

create or replace function public.objetivos_auditar_cambio()
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

  v_origen := coalesce(v_origen, 'manual');

  if v_origen not in ('manual', 'diagnostico_gps') then
    raise exception
      'objetivo_ctx_origen_invalido: origen de cambio no reconocido (%)', v_origen
      using errcode = 'check_violation';
  end if;

  if v_origen = 'manual' then
    if v_firma is not null then
      raise exception
        'objetivo_ctx_firma_sin_origen: una modificacion manual no lleva firma'
        using errcode = 'check_violation';
    end if;
  elsif v_firma is null then
    raise exception
      'objetivo_ctx_firma_faltante: el origen % exige firma del diagnostico', v_origen
      using errcode = 'check_violation';
  elsif length(v_firma) > 120 then
    raise exception
      'objetivo_ctx_firma_invalida: firma fuera de formato'
      using errcode = 'check_violation';
  end if;

  -- 2) Sin cambios sensibles no hay auditoría.
  if new.lat is not distinct from old.lat
     and new.lng is not distinct from old.lng
     and new.radio_metros is not distinct from old.radio_metros then
    return new;
  end if;

  select u.id into v_usuario
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  -- 3) Una fila por campo sensible efectivamente modificado.
  insert into public.objetivos_auditoria (
    objetivo_id, campo, valor_anterior, valor_nuevo, origen, firma, modificado_por
  )
  select
    new.id, c.campo, c.anterior, c.nuevo, v_origen, v_firma, v_usuario
  from (values
    ('lat',          old.lat::text,          new.lat::text),
    ('lng',          old.lng::text,          new.lng::text),
    ('radio_metros', old.radio_metros::text, new.radio_metros::text)
  ) as c(campo, anterior, nuevo)
  where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

revoke all on function public.objetivos_auditar_cambio() from public;
revoke all on function public.objetivos_auditar_cambio() from anon;
revoke all on function public.objetivos_auditar_cambio() from authenticated;

drop trigger if exists trg_objetivos_zz_auditoria on public.objetivos;
create trigger trg_objetivos_zz_auditoria
  before update on public.objetivos
  for each row execute function public.objetivos_auditar_cambio();

notify pgrst, 'reload schema';

commit;
