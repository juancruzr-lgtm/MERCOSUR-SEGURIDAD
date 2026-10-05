-- ROLLBACK de 20261005120000_objetivos_auditar_estado.sql
-- Restaura la función de auditoría sin el tramo de `estado` y los constraints
-- originales (origen sólo manual/diagnostico_gps; firma coherente previa).
-- OJO: vuelve a dejar los cambios de estado de objetivos SIN trazabilidad.
-- Nota: las filas de auditoría de estado ya registradas quedan; si se requiere,
-- borrarlas manualmente (no lo hace este rollback para no perder evidencia).

begin;

create or replace function public.objetivos_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
    raise exception 'objetivo_ctx_origen_invalido: origen de cambio no reconocido (%)', v_origen using errcode = 'check_violation';
  end if;

  if v_origen = 'manual' then
    if v_firma is not null then
      raise exception 'objetivo_ctx_firma_sin_origen: una modificacion manual no lleva firma' using errcode = 'check_violation';
    end if;
  elsif v_firma is null then
    raise exception 'objetivo_ctx_firma_faltante: el origen % exige firma del diagnostico', v_origen using errcode = 'check_violation';
  elsif length(v_firma) > 120 then
    raise exception 'objetivo_ctx_firma_invalida: firma fuera de formato' using errcode = 'check_violation';
  end if;

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
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;

  insert into public.objetivos_auditoria (
    objetivo_id, campo, valor_anterior, valor_nuevo, origen, firma, modificado_por
  )
  select new.id, c.campo, c.anterior, c.nuevo, v_origen, v_firma, v_usuario
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
$function$;

-- Constraints originales (service_role deja de ser válido).
alter table public.objetivos_auditoria drop constraint objetivos_auditoria_firma_coherente;
alter table public.objetivos_auditoria add constraint objetivos_auditoria_firma_coherente
  check (((origen = 'manual'::text) and (firma is null)) or ((origen <> 'manual'::text) and (firma is not null)));

alter table public.objetivos_auditoria drop constraint objetivos_auditoria_origen_valido;
alter table public.objetivos_auditoria add constraint objetivos_auditoria_origen_valido
  check (origen = any (array['manual'::text, 'diagnostico_gps'::text]));

commit;

notify pgrst, 'reload schema';
