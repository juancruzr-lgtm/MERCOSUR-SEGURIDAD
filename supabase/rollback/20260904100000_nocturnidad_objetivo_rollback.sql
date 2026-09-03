-- ============================================================================
-- ROLLBACK · 20260904100000_nocturnidad_objetivo
-- ============================================================================
-- Restaura el trigger de auditoría a su versión previa (la de
-- 20260814100000_objetivos_auditoria_gps.sql, sólo lat/lng/radio_metros) y
-- elimina la configuración de nocturnidad. Las filas ya escritas en
-- objetivos_auditoria por los campos de nocturnidad se CONSERVAN: la
-- auditoría no se borra ("las anulaciones conservan el registro").
-- ============================================================================

begin;

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

alter table public.objetivos
  drop constraint if exists objetivos_nocturnidad_completa;

alter table public.objetivos
  drop column if exists nocturnidad_activa,
  drop column if exists nocturnidad_desde,
  drop column if exists nocturnidad_hasta;

notify pgrst, 'reload schema';

commit;
