-- ============================================================================
-- OBJETIVOS · Nocturnidad configurable por servicio
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- La nocturnidad es una condición contractual del servicio: en algunos
-- clientes las horas trabajadas dentro de una franja (hoy 22:00–06:00 donde
-- aplica) generan un adicional. Hasta ahora esa discriminación se contaba a
-- mano; el Resumen Guardia necesita leerla de una configuración del objetivo,
-- no de nombres hardcodeados.
--
-- La configuración vive en el objetivo porque describe el servicio, no una
-- preferencia de reporte. El Resumen Guardia sólo la consume.
--
-- QUÉ AGREGA
--   * objetivos.nocturnidad_activa  boolean, default false — nadie queda
--     activado automáticamente; la activación es una decisión por objetivo.
--   * objetivos.nocturnidad_desde / nocturnidad_hasta  time — franja horaria.
--     CHECK: si está activa, la franja tiene que estar completa.
--   * Auditoría: el trigger existente trg_objetivos_zz_auditoria (migración
--     20260814100000) pasa a auditar también estos tres campos, con el mismo
--     formato (una fila por campo modificado, quién, cuándo, antes/después).
--     No se crea ningún sistema de auditoría paralelo.
--
-- QUÉ NO HACE
--   * No calcula dinero ni altera horas liquidables: la franja sólo permite
--     DISCRIMINAR un subconjunto de las mismas horas reconocidas.
--   * No activa la nocturnidad de ningún objetivo: eso se configura desde la
--     pantalla de Objetivos (queda auditado por el trigger).
--   * No toca políticas RLS de objetivos (el saneamiento de permisos es F1 y
--     viaja por su propia serie de migraciones).
-- ============================================================================

begin;

-- ── Columnas de configuración ───────────────────────────────────────────────

alter table public.objetivos
  add column if not exists nocturnidad_activa boolean not null default false,
  add column if not exists nocturnidad_desde  time,
  add column if not exists nocturnidad_hasta  time;

comment on column public.objetivos.nocturnidad_activa is
  'El servicio discrimina nocturnidad: las horas reconocidas dentro de la '
  'franja [nocturnidad_desde, nocturnidad_hasta) se informan como subconjunto '
  'nocturno en el Resumen Guardia. No modifica horas liquidables.';

comment on column public.objetivos.nocturnidad_desde is
  'Inicio de la franja nocturna del servicio (ej. 22:00). Sólo tiene sentido '
  'con nocturnidad_activa = true.';

comment on column public.objetivos.nocturnidad_hasta is
  'Fin de la franja nocturna del servicio (ej. 06:00). Puede cruzar la '
  'medianoche: hasta <= desde significa que la franja termina al día siguiente.';

alter table public.objetivos
  add constraint objetivos_nocturnidad_completa
  check (
    not nocturnidad_activa
    or (nocturnidad_desde is not null and nocturnidad_hasta is not null)
  );

-- ── Auditoría: extender el trigger existente a los campos nuevos ────────────
-- Misma función de 20260814100000_objetivos_auditoria_gps.sql, con los tres
-- campos de nocturnidad sumados a la detección de cambios y al volcado.
-- El resto (contexto de transporte, validaciones, autor) queda idéntico.

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
     and new.radio_metros is not distinct from old.radio_metros
     and new.nocturnidad_activa is not distinct from old.nocturnidad_activa
     and new.nocturnidad_desde  is not distinct from old.nocturnidad_desde
     and new.nocturnidad_hasta  is not distinct from old.nocturnidad_hasta then
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
    ('lat',                old.lat::text,                new.lat::text),
    ('lng',                old.lng::text,                new.lng::text),
    ('radio_metros',       old.radio_metros::text,       new.radio_metros::text),
    ('nocturnidad_activa', old.nocturnidad_activa::text, new.nocturnidad_activa::text),
    ('nocturnidad_desde',  old.nocturnidad_desde::text,  new.nocturnidad_desde::text),
    ('nocturnidad_hasta',  old.nocturnidad_hasta::text,  new.nocturnidad_hasta::text)
  ) as c(campo, anterior, nuevo)
  where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

revoke all on function public.objetivos_auditar_cambio() from public;
revoke all on function public.objetivos_auditar_cambio() from anon;
revoke all on function public.objetivos_auditar_cambio() from authenticated;

notify pgrst, 'reload schema';

commit;
