-- ============================================================================
-- Trazabilidad de cambios de estado de objetivos (activo <-> inactivo)
-- ============================================================================
--
-- JC (05/10): la auditoría post-ausencia detectó que `objetivos_auditoria` sólo
-- registraba GPS/nocturnidad, NUNCA `estado`. Se EXTIENDE el sistema existente
-- (trigger BEFORE UPDATE `objetivos_auditar_cambio`) para registrar también los
-- cambios de `estado`, a nivel BASE (vale para UI/RPC/API/SQL/service_role).
--
-- Identidad:
--   · usuario autenticado  -> modificado_por = su usuarios.id, origen = 'manual'.
--   · service_role/sistema (auth.uid() NULL) -> modificado_por = NULL,
--     origen = 'service_role' (nunca se inventa responsable).
--
-- NO backfillea histórico: sólo audita cambios DESDE esta migración. No cambia
-- permisos de activar/inactivar. La tabla sigue sin policy de escritura (sólo la
-- escribe el trigger SECURITY DEFINER); RLS intacta.
--
-- Extensión mínima: se amplía el CHECK de `origen` para admitir 'service_role' y
-- se ajusta el CHECK de coherencia de firma (firma sólo para 'diagnostico_gps').
--
-- ROLLBACK: supabase/rollback/20261005120000_objetivos_auditar_estado_rollback.sql
-- ============================================================================

begin;

-- 1) Ampliar origen válido + coherencia de firma (compatible con filas existentes).
alter table public.objetivos_auditoria drop constraint objetivos_auditoria_origen_valido;
alter table public.objetivos_auditoria add constraint objetivos_auditoria_origen_valido
  check (origen = any (array['manual'::text, 'diagnostico_gps'::text, 'service_role'::text]));

alter table public.objetivos_auditoria drop constraint objetivos_auditoria_firma_coherente;
alter table public.objetivos_auditoria add constraint objetivos_auditoria_firma_coherente
  check (
    (origen = 'diagnostico_gps' and firma is not null)
    or (origen in ('manual','service_role') and firma is null)
  );

-- 2) Extender la función de auditoría para incluir `estado`.
create or replace function public.objetivos_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_origen        text;
  v_firma         text;
  v_usuario       uuid;
  v_estado_cambio boolean;
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

  v_estado_cambio := new.estado is distinct from old.estado;

  -- 2) Sin cambios sensibles NI de estado no hay auditoría.
  if new.lat is not distinct from old.lat
     and new.lng is not distinct from old.lng
     and new.radio_metros is not distinct from old.radio_metros
     and new.nocturnidad_activa is not distinct from old.nocturnidad_activa
     and new.nocturnidad_desde  is not distinct from old.nocturnidad_desde
     and new.nocturnidad_hasta  is not distinct from old.nocturnidad_hasta
     and not v_estado_cambio then
    return new;
  end if;

  select u.id into v_usuario
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  -- 3) Una fila por campo GPS/nocturnidad efectivamente modificado (igual que antes).
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

  -- 4) ESTADO (nuevo): traza activo <-> inactivo. Usuario autenticado => su id y
  --    origen 'manual'; service_role/sistema (sin auth.uid) => modificado_por NULL
  --    y origen 'service_role'. Nunca se inventa responsable.
  if v_estado_cambio then
    insert into public.objetivos_auditoria (
      objetivo_id, campo, valor_anterior, valor_nuevo, origen, firma, modificado_por
    ) values (
      new.id, 'estado', old.estado, new.estado,
      case when auth.uid() is null then 'service_role' else 'manual' end,
      null,
      v_usuario
    );
  end if;

  return new;
end;
$function$;

commit;

notify pgrst, 'reload schema';
