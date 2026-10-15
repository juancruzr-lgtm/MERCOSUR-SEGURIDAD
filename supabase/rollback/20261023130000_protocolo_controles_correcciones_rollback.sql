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

-- protocolo_controles_panel como en 20261023120000.
create or replace function public.protocolo_controles_panel(p_objetivo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_plantilla uuid;
begin
  if auth.uid() is null or not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = p_objetivo_id);

  return jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'permisos', jsonb_build_object(
      'preparar', public.protocolo_puede_preparar(),
      'activar', public.protocolo_puede_publicar()
    ),
    'plantilla', (
      select jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'propia', p.objetivo_id is not distinct from p_objetivo_id,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', ci.id, 'texto', ci.texto, 'orden', ci.orden, 'criticidad', ci.criticidad,
                     'foto_obligatoria', ci.foto_obligatoria, 'origen_instruccion_id', ci.origen_instruccion_id
                   ) order by ci.orden), '[]'::jsonb)
                  from public.checklist_items ci where ci.plantilla_id = p.id and ci.activo))
      from public.checklist_plantillas p where p.id = v_plantilla),
    'versiones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.id, 'numero', v.numero, 'titulo', v.titulo, 'estado', v.estado,
          'puesto_id', v.puesto_id, 'puesto_nombre', pu.nombre,
          'instrucciones', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'orden', i.orden, 'inicio', i.inicio, 'fin', i.fin,
                'texto', public.protocolo_fragmento(v.texto, i.inicio, i.fin),
                'coincide', i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex'),
                'clasificacion_ia', i.clasificacion_ia, 'quien_ia', i.quien_ia, 'cuando_ia', i.cuando_ia,
                'clasificacion', i.clasificacion, 'quien', i.quien, 'cuando', i.cuando,
                'validada_at', i.validada_at,
                'validada_por_nombre', nullif(btrim(coalesce(uv.nombre, '') || ' ' || coalesce(uv.apellido, '')), '')
              ) order by i.orden), '[]'::jsonb)
            from public.protocolo_instrucciones i
            left join public.usuarios uv on uv.id = i.validada_por
            where i.version_id = v.id and i.obsoleta_at is null)
        ) order by v.puesto_id nulls first, v.numero desc), '[]'::jsonb)
      from public.protocolo_versiones v
      left join public.puestos pu on pu.id = v.puesto_id
      where v.objetivo_id = p_objetivo_id
        and v.estado in ('borrador', 'pendiente_aprobacion', 'vigente')),
    'controles', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'instruccion_id', c.instruccion_id, 'version_id', c.version_id,
          'origen', c.origen, 'destino', c.destino, 'texto_original', c.texto_original,
          'texto_item', c.texto_item, 'criticidad', c.criticidad, 'foto_obligatoria', c.foto_obligatoria,
          'quien', c.quien, 'cuando', c.cuando, 'motivo', c.motivo,
          'existente_tipo', c.existente_tipo, 'existente_id', c.existente_id, 'existente_texto', c.existente_texto,
          'estado', c.estado, 'aprobado_at', c.aprobado_at,
          'aprobado_por_nombre', nullif(btrim(coalesce(ua.nombre, '') || ' ' || coalesce(ua.apellido, '')), ''),
          'rechazado_at', c.rechazado_at, 'motivo_rechazo', c.motivo_rechazo,
          'activado_at', c.activado_at,
          'activado_por_nombre', nullif(btrim(coalesce(uc.nombre, '') || ' ' || coalesce(uc.apellido, '')), ''),
          'checklist_item_id', c.checklist_item_id, 'creado_at', c.creado_at
        ) order by c.creado_at), '[]'::jsonb)
      from public.protocolo_controles_propuestos c
      left join public.usuarios ua on ua.id = c.aprobado_por
      left join public.usuarios uc on uc.id = c.activado_por
      where c.objetivo_id = p_objetivo_id),
    'corridas', (
      select coalesce(jsonb_agg(x.fila order by x.creado_at desc), '[]'::jsonb)
      from (
        select r.creado_at, jsonb_build_object(
          'id', r.id, 'version_id', r.version_id, 'modelo', r.modelo,
          'tokens_entrada', r.tokens_entrada, 'tokens_salida', r.tokens_salida,
          'instrucciones_enviadas', r.instrucciones_enviadas,
          'propuestas', (select count(*) from public.protocolo_controles_propuestos c where c.ia_corrida_id = r.id),
          'estado', r.estado, 'error', r.error, 'creado_at', r.creado_at
        ) as fila
        from public.protocolo_ia_corridas r
        where r.objetivo_id = p_objetivo_id
        order by r.creado_at desc
        limit 10
      ) x)
  );
end;
$fn$;

revoke all on function public.protocolo_controles_panel(uuid) from public, anon;
grant execute on function public.protocolo_controles_panel(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
