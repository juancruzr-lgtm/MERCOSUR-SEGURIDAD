-- Rollback de 20261023130000_protocolo_controles_correcciones.sql.
-- Vuelve a 20261023120000 tal como quedó aplicada: división por renglones
-- disponible, contexto sin texto completo y el trigger de supervisiones
-- original. Las instrucciones ya registradas desde citas quedan (son filas
-- válidas de protocolo_instrucciones). Correr por separado.

begin;

drop function if exists public.protocolo_instrucciones_registrar(uuid, jsonb);
grant execute on function public.protocolo_instrucciones_segmentar(uuid) to authenticated;

create or replace function public.protocolo_controles_contexto(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver       public.protocolo_versiones%rowtype;
  v_plantilla uuid;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = v_ver.objetivo_id);

  return jsonb_build_object(
    'version_id', v_ver.id,
    'objetivo_id', v_ver.objetivo_id,
    'objetivo_nombre', (select o.nombre from public.objetivos o where o.id = v_ver.objetivo_id),
    'titulo', v_ver.titulo,
    'instrucciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'orden', i.orden,
          'texto', public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin),
          'clasificacion', i.clasificacion,
          'tiene_control', exists (select 1 from public.protocolo_controles_propuestos c
                                   where c.instruccion_id = i.id and c.estado <> 'rechazado')
        ) order by i.orden), '[]'::jsonb)
      from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null),
    'checklist', (
      select coalesce(jsonb_agg(jsonb_build_object('id', ci.id, 'texto', ci.texto) order by ci.orden), '[]'::jsonb)
      from public.checklist_items ci
      where ci.plantilla_id = v_plantilla and ci.activo),
    'rondas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'nombre', r.nombre, 'descripcion', r.descripcion,
          'intervalo_minutos', r.intervalo_minutos,
          'puntos', (select coalesce(jsonb_agg(jsonb_build_object('id', rp.id, 'nombre', rp.nombre, 'descripcion', rp.descripcion)
                                               order by rp.orden), '[]'::jsonb)
                     from public.ronda_puntos rp where rp.ronda_base_id = r.id and rp.activo)
        ) order by r.nombre), '[]'::jsonb)
      from public.rondas_base r
      where r.objetivo_id = v_ver.objetivo_id and r.activo)
  );
end;
$fn$;

revoke all on function public.protocolo_controles_contexto(uuid) from public, anon;
grant execute on function public.protocolo_controles_contexto(uuid) to authenticated;

-- Trigger original de producción (pg_get_functiondef, 15/10/2026).
create or replace function public.validar_supervision_plantilla()
returns trigger
language plpgsql
as $fn$
declare
  objetivo_plantilla uuid;
begin
  objetivo_plantilla := (select checklist_plantilla_id from objetivos where id = new.objetivo_id);

  if objetivo_plantilla is not null then
    if new.plantilla_id is null then
      raise exception 'La supervision requiere plantilla para este objetivo';
    end if;

    if new.plantilla_id <> objetivo_plantilla then
      raise exception 'La plantilla de la supervision no coincide con la plantilla del objetivo';
    end if;
  end if;

  return new;
end;
$fn$;

notify pgrst, 'reload schema';

commit;
