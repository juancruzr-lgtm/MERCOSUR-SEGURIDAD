-- Rollback de 20261014120000_legajo_historico_revision.sql: vuelve a las versiones
-- anteriores (resolver y visor de 20261013120000, bandeja de 20261010130000).
-- Las marcas 'investigar' que hayan quedado en senales no molestan (se ignoran).

begin;

create or replace function public.legajo_historico_resolver(
  p_id uuid, p_decision text, p_empleado_id uuid default null, p_tipo text default null,
  p_fecha_emision date default null, p_vence_el date default null, p_detalle text default null,
  p_motivo text default null, p_rangos jsonb default null, p_confirmo_dni_distinto boolean default false,
  p_verificacion text default null, p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p       public.legajo_historico_propuestas%rowtype;
  v_tipo    public.documentacion_tipos%rowtype;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_dni_emp text;
  v_repetido boolean;
  v_rango   jsonb;
  v_hijas   integer := 0;
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_vio     boolean;
  v_nuevo   text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_id);
  if v_p.id is null then
    raise exception 'Propuesta inexistente';
  end if;

  if p_decision = 'reabrir' then
    if v_p.estado not in ('aceptada','descartada') then
      raise exception 'Sólo se reabre una propuesta aceptada o descartada (no importada)';
    end if;
    update public.legajo_historico_propuestas
       set estado = case when motivo_conflicto is null then 'pendiente' else 'conflicto' end,
           empleado_id = null, tipo = null, revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'reabierta', jsonb_build_object('motivo', v_motivo));
    return jsonb_build_object('estado', 'reabierta');
  end if;

  if v_p.estado not in ('pendiente','conflicto') then
    raise exception 'Esta propuesta ya se resolvió';
  end if;

  if p_decision = 'descartar' then
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Escribí por qué se descarta';
    end if;
    update public.legajo_historico_propuestas
       set estado = 'descartada', motivo = left(v_motivo, 300),
           revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'descartada', jsonb_build_object('motivo', v_motivo));
    return jsonb_build_object('estado', 'descartada');
  end if;

  if p_decision = 'separar' then
    if v_p.padre_id is not null then
      raise exception 'Una parte no se vuelve a separar';
    end if;
    if p_rangos is null or jsonb_typeof(p_rangos) <> 'array' or jsonb_array_length(p_rangos) < 1 then
      raise exception 'Indicá los rangos de páginas';
    end if;
    for v_rango in select value from jsonb_array_elements(p_rangos) loop
      if (v_rango->>'desde')::integer < 1 or (v_rango->>'hasta')::integer < (v_rango->>'desde')::integer
         or (v_p.paginas is not null and (v_rango->>'hasta')::integer > v_p.paginas) then
        raise exception 'Rango de páginas inválido (%–%)', v_rango->>'desde', v_rango->>'hasta';
      end if;
      insert into public.legajo_historico_propuestas (
        padre_id, lote, hash_origen, ruta_origen, repositorio_id, bytes, paginas, pagina_desde, pagina_hasta,
        tipo_sugerido, dni_sugerido, empleado_id_sugerido, confianza, criterio, senales, estado, motivo_conflicto
      ) values (
        v_p.id, v_p.lote, v_p.hash_origen, v_p.ruta_origen, v_p.repositorio_id, v_p.bytes, v_p.paginas,
        (v_rango->>'desde')::integer, (v_rango->>'hasta')::integer,
        coalesce(nullif(v_rango->>'tipo', ''), v_p.tipo_sugerido), v_p.dni_sugerido, v_p.empleado_id_sugerido,
        v_p.confianza, 'parte de un PDF compilado', v_p.senales,
        case when v_p.motivo_conflicto is null then 'pendiente' else 'conflicto' end, v_p.motivo_conflicto
      );
      v_hijas := v_hijas + 1;
    end loop;
    update public.legajo_historico_propuestas
       set estado = 'separada', revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = p_id;
    perform public.legajo_historico_evento(p_id, 'separada', jsonb_build_object('partes', v_hijas));
    return jsonb_build_object('estado', 'separada', 'partes', v_hijas);
  end if;

  if p_decision = 'recategorizar' then
    v_nuevo := nullif(btrim(coalesce(p_tipo, '')), '');
    if v_nuevo is not null and not exists (select 1 from public.documentacion_tipos t where t.codigo = v_nuevo and t.activo) then
      raise exception 'Categoría inexistente o fuera de uso';
    end if;
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Escribí por qué cambia la categoría';
    end if;
    if v_nuevo is not distinct from v_p.tipo_sugerido then
      raise exception 'La categoría es la misma';
    end if;
    update public.legajo_historico_propuestas set tipo_sugerido = v_nuevo where id = p_id;
    perform public.legajo_historico_evento(p_id, 'categoria_corregida', jsonb_build_object(
      'antes', v_p.tipo_sugerido, 'despues', v_nuevo, 'motivo', v_motivo));
    return jsonb_build_object('estado', v_p.estado, 'tipo_sugerido', v_nuevo);
  end if;

  if p_decision <> 'aceptar' then
    raise exception 'Decisión inválida';
  end if;

  -- Verificación del documento original: obligatoria. Si no hay registro de
  -- que esta persona lo abrió en el visor, hace falta una observación.
  if p_verificacion is null or p_verificacion not in ('visor_app','mega_directo','otro') then
    raise exception 'Indicá cómo verificaste el contenido del documento original';
  end if;
  v_vio := exists (select 1 from public.legajo_historico_vista_aperturas a
                     join public.legajo_historico_vistas v on v.id = a.vista_id
                    where a.auth_user_id = auth.uid()
                      and (v.propuesta_id = p_id or (v_p.padre_id is not null and v.propuesta_id = v_p.padre_id)
                           or v.repositorio_id = v_p.repositorio_id));
  if p_verificacion = 'visor_app' and not v_vio then
    raise exception 'No hay registro de que hayas abierto este archivo en el visor de la app: elegí cómo lo verificaste y explicalo';
  end if;
  if not v_vio and (v_obs is null or char_length(v_obs) < 10) then
    raise exception 'No abriste el archivo en el visor: escribí cómo verificaste el documento (al menos 10 caracteres)';
  end if;

  -- Aceptar: persona y tipo elegidos por una persona.
  if p_empleado_id is null or not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Elegí la persona';
  end if;
  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Elegí el tipo de documento';
  end if;
  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  if v_p.repositorio_id is null then
    raise exception 'El archivo todavía no está en el índice del agente: no se puede importar con trazabilidad';
  end if;

  -- Control de DNI: el del documento contra el de la persona elegida.
  v_dni_emp := public.legajo_dni_normalizado((select u.dni from public.usuarios u where u.id = p_empleado_id));
  v_repetido := v_dni_emp is not null
    and (select count(*) from public.usuarios o where public.legajo_dni_normalizado(o.dni) = v_dni_emp) > 1;
  if (v_p.dni_sugerido is not null and v_dni_emp is distinct from v_p.dni_sugerido) or v_repetido or v_p.estado = 'conflicto' then
    if not p_confirmo_dni_distinto or v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'El DNI del documento no coincide con el de la persona, o el DNI está repetido en la app. Confirmá y escribí el motivo';
    end if;
  end if;

  -- Fechas, con las mismas reglas que una carga nueva.
  if v_tipo.campo_fecha = 'obligatoria' and p_fecha_emision is null then
    raise exception 'Falta la fecha (%).', lower(v_tipo.etiqueta_fecha);
  end if;
  if p_fecha_emision is not null and (p_fecha_emision > current_date or p_fecha_emision < date '1950-01-01') then
    raise exception 'La fecha no es válida';
  end if;
  if v_tipo.campo_vencimiento = 'declarado' and p_vence_el is null then
    raise exception 'Falta la fecha de vencimiento que figura en el documento';
  end if;
  if v_tipo.campo_vencimiento <> 'declarado' and p_vence_el is not null then
    raise exception 'Este documento no lleva vencimiento escrito';
  end if;
  if v_tipo.etiqueta_detalle is not null and v_tipo.multiple and nullif(btrim(coalesce(p_detalle, '')), '') is null then
    raise exception 'Falta completar: %', lower(v_tipo.etiqueta_detalle);
  end if;

  update public.legajo_historico_propuestas
     set estado = 'aceptada', empleado_id = p_empleado_id, tipo = p_tipo,
         fecha_emision = p_fecha_emision,
         vence_el = case when v_tipo.campo_vencimiento = 'calculado' and p_fecha_emision is not null
                         then (p_fecha_emision + make_interval(months => v_tipo.vigencia_meses))::date
                         else p_vence_el end,
         detalle = nullif(btrim(coalesce(p_detalle, '')), ''), motivo = left(v_motivo, 300),
         revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
   where id = p_id;
  perform public.legajo_historico_evento(p_id, 'aceptada', jsonb_build_object(
    'empleado_id', p_empleado_id, 'tipo', p_tipo, 'dni_distinto_confirmado', p_confirmo_dni_distinto, 'motivo', v_motivo,
    'verificacion', p_verificacion, 'visto_en_app', v_vio, 'observacion', left(v_obs, 500)));
  return jsonb_build_object('estado', 'aceptada');
end;
$fn$;

create or replace function public.legajo_historico_bandeja(
  p_estado text default 'pendiente', p_limite integer default 200, p_texto text default null, p_desde integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
  v_ids      uuid[];
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();
  if char_length(btrim(coalesce(p_texto, ''))) >= 3 then
    v_ids := (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(public.legajo_historico_buscar(p_texto)) x);
  end if;
  return jsonb_build_object(
    'conteo', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
               from (select estado, count(*) n from public.legajo_historico_propuestas group by estado) x),
    'total', (select count(*) from public.legajo_historico_propuestas x
              where (v_ids is not null or p_estado is null or x.estado = p_estado)
                and (v_ids is null or x.id = any(v_ids))),
    'tipos', (select coalesce(jsonb_agg(jsonb_build_object('codigo', t.codigo, 'nombre', t.nombre,
                'campo_fecha', t.campo_fecha, 'campo_vencimiento', t.campo_vencimiento, 'etiqueta_detalle', t.etiqueta_detalle,
                'multiple', t.multiple) order by t.orden), '[]'::jsonb)
              from public.documentacion_tipos t where t.activo and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)),
    'propuestas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'padre_id', p.padre_id, 'lote', p.lote, 'ruta_origen', p.ruta_origen,
          'indexado', p.repositorio_id is not null, 'bytes', p.bytes, 'paginas', p.paginas,
          'pagina_desde', p.pagina_desde, 'pagina_hasta', p.pagina_hasta,
          'tipo_sugerido', p.tipo_sugerido, 'confianza', p.confianza, 'criterio', p.criterio,
          'senales', p.senales, 'estado', p.estado, 'motivo_conflicto', p.motivo_conflicto,
          'dni_sugerido', p.dni_sugerido,
          'sugerido', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'nombre', s.nombre, 'apellido', s.apellido, 'legajo', s.legajo, 'estado', s.estado) end,
          'empleado_id', p.empleado_id, 'tipo', p.tipo, 'motivo', p.motivo, 'revisado_at', p.revisado_at,
          'documento_id', p.documento_id, 'documento_estado', d.estado
        ) order by p.creado_at, p.id), '[]'::jsonb)
      from (
        select * from public.legajo_historico_propuestas x
        -- Con búsqueda: todos los estados (como antes).
        where (v_ids is not null or p_estado is null or x.estado = p_estado)
          and (v_ids is null or x.id = any(v_ids))
        order by x.creado_at, x.id
        offset greatest(0, coalesce(p_desde, 0))
        limit greatest(1, least(coalesce(p_limite, 200), 500))
      ) p
      left join public.usuarios s on s.id = p.empleado_id_sugerido
      left join public.documentacion_documentos d on d.id = p.documento_id
    )
  );
end;
$fn$;

create or replace function public.legajo_historico_solicitar_vista(p_propuesta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p     public.legajo_historico_propuestas%rowtype;
  v_r     record;
  v_ext   text;
  v_tipo  text;
  v_area  public.documental_areas;
  v_id    uuid;
  v_est   text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_propuesta_id);
  if v_p.id is null then raise exception 'Propuesta inexistente'; end if;
  if v_p.repositorio_id is null then
    raise exception 'El archivo no está en el índice del agente: no se puede abrir con verificación';
  end if;
  v_tipo := coalesce(v_p.tipo, v_p.tipo_sugerido);
  if v_tipo is not null and exists (select 1 from public.documentacion_tipos t where t.codigo = v_tipo and t.sensibilidad = 'reservado_gerencia')
     and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  select r.id, r.ruta_relativa, r.hash_sha256, lower(coalesce(r.extension, '')) ext, r.tamano_bytes, r.disponible
    into v_r from public.repositorio_documental r where r.id = v_p.repositorio_id;
  if v_r.id is null or not v_r.disponible then raise exception 'El archivo ya no está disponible en MEGA'; end if;

  -- Área documental: habilitada, con este módulo y con permiso de quien pide.
  v_area := public.documental_area_de_ruta(v_r.ruta_relativa);
  if v_area.codigo is null or not v_area.habilitada then
    raise exception 'El archivo está en un área documental de MEGA que no está habilitada para verse desde la app' using errcode = '42501';
  end if;
  if not public.documental_puede_area(v_area, 'legajo_empleados') then
    raise exception 'No tenés permiso para ver documentos de esta área' using errcode = '42501';
  end if;

  v_ext := v_r.ext;
  if v_ext not in ('.pdf','.jpg','.jpeg','.png','.webp') then
    raise exception 'Sólo se pueden ver PDF e imágenes';
  end if;
  if coalesce(v_r.tamano_bytes, 0) > 26214400 then raise exception 'El archivo supera los 25 MB'; end if;

  -- Reusar un pedido propio en curso o vigente.
  select v.id, v.estado into v_id, v_est from public.legajo_historico_vistas v
   where v.solicitado_auth = auth.uid() and v.repositorio_id = v_r.id
     and ((v.estado in ('pendiente','tomada') and v.creado_at > now() - interval '5 minutes')
          or (v.estado = 'lista' and v.expira_at > now() + interval '1 minute'))
   order by v.creado_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'estado', v_est, 'reusado', true);
  end if;

  if not public.documental_lector_activo() then
    raise exception 'El lector de SRV02 no está funcionando en este momento: el archivo no se puede traer. Probá más tarde.';
  end if;
  if (select count(*) from public.legajo_historico_vistas v
       where v.solicitado_auth = auth.uid() and v.creado_at > now() - interval '1 hour') >= 30 then
    raise exception 'Llegaste al máximo de 30 archivos por hora';
  end if;
  if (select count(*) from public.legajo_historico_vistas v
       where v.estado in ('pendiente','tomada') and v.creado_at > now() - interval '5 minutes') >= 20 then
    raise exception 'Hay muchos pedidos en curso: probá en un minuto';
  end if;

  insert into public.legajo_historico_vistas (repositorio_id, propuesta_id, ruta_relativa, hash_esperado, extension,
                                              solicitado_por, solicitado_auth, area_codigo, modulo)
  values (v_r.id, v_p.id, v_r.ruta_relativa, lower(v_r.hash_sha256), v_ext,
          public.documentacion_usuario_actual(), auth.uid(), v_area.codigo, 'legajo_empleados')
  returning id into v_id;
  perform public.legajo_historico_evento(v_p.id, 'vista_solicitada', jsonb_build_object('vista_id', v_id, 'area', v_area.codigo));
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'reusado', false);
end;
$fn$;

revoke all on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean, text, text) to authenticated;
revoke all on function public.legajo_historico_bandeja(text, integer, text, integer) from public, anon;
grant execute on function public.legajo_historico_bandeja(text, integer, text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
