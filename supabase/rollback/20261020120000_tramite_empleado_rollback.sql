-- Rollback de 20261020120000_tramite_empleado.
begin;
drop function if exists public.habilitacion_mis_pendientes();

-- documentacion_preparar tal como en 20261018120000
create or replace function public.documentacion_preparar(
  p_empleado_id   uuid,
  p_tipo          text,
  p_fecha_emision date,
  p_vence_el      date,
  p_detalle       text,
  p_archivos      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_actor     uuid;
  v_gestiona  boolean;
  v_origen    text;
  v_tipo      public.documentacion_tipos%rowtype;
  v_cant      integer;
  v_doc       uuid;
  v_detalle   text;
  v_vence     date;
  v_res       jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_orden     integer := 0;
  v_mime      text;
  v_bytes     bigint;
  v_sha       text;
  v_shas      text[] := array[]::text[];
  v_repetida  text;
  v_cara      text;
  v_ext       text;
  v_ruta      text;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_actor := public.documentacion_usuario_actual();
  if v_actor is null then
    raise exception 'Usuario inactivo' using errcode = '42501';
  end if;
  v_gestiona := public.documentacion_puede_gestionar();

  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Tipo de documento inexistente';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Empleado inexistente';
  end if;

  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo carga Gerencia' using errcode = '42501';
  end if;
  if v_gestiona then
    v_origen := 'administracion';
  elsif p_empleado_id = v_actor then
    if not v_tipo.sube_vigilador then
      raise exception 'Este documento lo carga Administración' using errcode = '42501';
    end if;
    -- El pedido de credencial abre sólo la credencial; el resto sigue con el módulo Documentación.
    if not (p_tipo = 'credencial'
            and coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'pedido_credencial'), false)) then
      perform public.legajo_exigir_habilitado('documentacion');
    end if;
    -- La credencial aceptada no se reemplaza desde la app mientras esté vigente (sí la renovada, 60 días antes).
    if p_tipo = 'credencial' and exists (select 1 from public.documentacion_documentos d where d.empleado_id = v_actor and d.tipo = 'credencial'
                                           and d.estado in ('aprobado','aceptado') and d.vence_el > current_date + 60) then
      raise exception 'Tu credencial ya fue aceptada. Cuando la renueves vas a poder subir la nueva.' using errcode = '42501';
    end if;
    v_origen := 'vigilador';
  else
    raise exception 'Sólo podés cargar tu propia documentación' using errcode = '42501';
  end if;

  -- Fecha de emisión
  if v_tipo.campo_fecha = 'obligatoria' and p_fecha_emision is null then
    raise exception 'Falta la fecha (%).', lower(v_tipo.etiqueta_fecha);
  end if;
  if v_tipo.campo_fecha = 'no' and p_fecha_emision is not null then
    raise exception 'Este documento no lleva fecha';
  end if;
  if p_fecha_emision is not null
     and (p_fecha_emision > current_date or p_fecha_emision < date '1950-01-01') then
    raise exception 'La fecha no es válida';
  end if;

  -- Vencimiento
  if v_tipo.campo_vencimiento = 'calculado' then
    if p_vence_el is not null then
      raise exception 'El vencimiento de este documento se calcula solo';
    end if;
    if p_fecha_emision is not null then
      v_vence := (p_fecha_emision + make_interval(months => v_tipo.vigencia_meses))::date;
    end if;
  elsif v_tipo.campo_vencimiento = 'declarado' then
    if p_vence_el is null then
      raise exception 'Falta la fecha de vencimiento que figura en el documento';
    end if;
    if p_vence_el < date '2000-01-01' or p_vence_el > current_date + interval '20 years'
       or (p_fecha_emision is not null and p_vence_el <= p_fecha_emision) then
      raise exception 'La fecha de vencimiento no es válida';
    end if;
    v_vence := p_vence_el;
  elsif p_vence_el is not null then
    raise exception 'Este documento no lleva vencimiento';
  end if;

  -- Detalle
  v_detalle := nullif(btrim(coalesce(p_detalle, '')), '');
  if v_tipo.etiqueta_detalle is not null and v_tipo.multiple and v_detalle is null then
    raise exception 'Falta completar: %', lower(v_tipo.etiqueta_detalle);
  end if;
  if v_detalle is not null and char_length(v_detalle) > 200 then
    raise exception 'El texto es demasiado largo (máximo 200 caracteres)';
  end if;

  -- Archivos
  if p_archivos is null or jsonb_typeof(p_archivos) <> 'array' then
    raise exception 'Faltan los archivos';
  end if;
  v_cant := jsonb_array_length(p_archivos);
  if v_cant < 1 or v_cant > 10 then
    raise exception 'Se pueden subir entre 1 y 10 archivos';
  end if;
  if v_tipo.caras is not null and v_cant <> coalesce(array_length(v_tipo.caras, 1), 0) then
    raise exception 'Faltan fotos: se necesitan % (%).',
      array_length(v_tipo.caras, 1), array_to_string(v_tipo.caras, ' y ');
  end if;
  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_sha := lower(coalesce(v_item->>'sha256', ''));
    if v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'Falta la huella del archivo. Actualizá la app y probá de nuevo';
    end if;
    if v_sha = any (v_shas) then
      raise exception 'Subiste dos veces el mismo archivo';
    end if;
    v_repetida := public.documentacion_huella_repetida(v_sha, p_empleado_id, null);
    if v_repetida is not null then
      raise exception '%', v_repetida;
    end if;
    v_shas := v_shas || v_sha;
  end loop;

  v_doc := gen_random_uuid();
  insert into public.documentacion_documentos (
    id, empleado_id, tipo, sensibilidad, detalle, fecha_emision, vence_el, origen, estado,
    subido_por, subido_por_auth
  ) values (
    v_doc, p_empleado_id, p_tipo, v_tipo.sensibilidad, v_detalle, p_fecha_emision, v_vence, v_origen, 'subiendo',
    v_actor, v_uid
  );

  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_orden := v_orden + 1;
    v_mime  := v_item->>'mime';
    v_bytes := (v_item->>'bytes')::bigint;
    if v_mime is null or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception 'Formato no admitido: subí una foto (JPG/PNG) o un PDF';
    end if;
    if v_bytes is null or v_bytes <= 0 or v_bytes > 15728640 then
      raise exception 'Cada archivo puede pesar hasta 15 MB';
    end if;
    v_cara := case when v_tipo.caras is not null then v_tipo.caras[v_orden] end;
    v_ext := case v_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png'
                         when 'image/webp' then 'webp' else 'jpg' end;
    -- Sin nombres de persona ni de documento en la ruta.
    v_ruta := p_empleado_id::text || '/' || v_doc::text || '/' || v_orden::text || '.' || v_ext;
    insert into public.documentacion_archivos (documento_id, orden, cara, ruta, mime, bytes, sha256)
    values (v_doc, v_orden, v_cara, v_ruta, v_mime, v_bytes::integer, v_shas[v_orden]);
    v_res := v_res || jsonb_build_object('orden', v_orden, 'cara', v_cara, 'ruta', v_ruta);
  end loop;

  perform public.documentacion_registrar_evento(v_doc, 'preparado',
    jsonb_build_object('origen', v_origen, 'archivos', v_cant));

  return jsonb_build_object('documento_id', v_doc, 'archivos', v_res);
end;
$fn$;

notify pgrst, 'reload schema';
commit;
