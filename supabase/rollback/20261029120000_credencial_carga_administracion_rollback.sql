-- Rollback de 20261026120000: la credencial cargada por Administración vuelve a esperar la aceptación del vigilador.
-- (Los documentos ya movidos a «para revisar» no se tocan.)

create or replace function public.documentacion_confirmar(p_documento_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_doc       public.documentacion_documentos%rowtype;
  v_falta     integer;
  v_distinto  integer;
  v_repetida  text;
  v_estado    text;
  r           record;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  if v_doc.id is null or v_doc.subido_por_auth is distinct from auth.uid() then
    raise exception 'Documento inexistente' using errcode = '42501';
  end if;
  if v_doc.estado <> 'subiendo' then
    return jsonb_build_object('documento_id', v_doc.id, 'estado', v_doc.estado);
  end if;
  -- Cada archivo tiene que estar en Storage con el tamaño declarado…
  v_falta := (
    select count(*)
    from public.documentacion_archivos a
    where a.documento_id = v_doc.id
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'legajo-documentos'
          and o.name = a.ruta
          and (o.metadata->>'size')::bigint = a.bytes
      )
  );
  if v_falta > 0 then
    raise exception 'No se terminaron de subir % archivo(s). Probá de nuevo.', v_falta;
  end if;
  -- …y verificado por el servidor: misma huella y mismo tipo real.
  v_falta := (
    select count(*) from public.documentacion_archivos a
    where a.documento_id = v_doc.id
      and not exists (select 1 from public.documentacion_verificaciones v where v.archivo_id = a.id)
  );
  if v_falta > 0 then
    raise exception 'Falta verificar % archivo(s)', v_falta using errcode = '42501';
  end if;
  v_distinto := (
    select count(*) from public.documentacion_archivos a
    join public.documentacion_verificaciones v on v.archivo_id = a.id
    where a.documento_id = v_doc.id
      and (v.sha256 <> a.sha256 or v.mime_real <> a.mime or v.bytes <> a.bytes)
  );
  if v_distinto > 0 then
    perform public.documentacion_registrar_evento(v_doc.id, 'verificacion_fallida', null);
    raise exception 'El archivo guardado no coincide con el que se eligió. Probá de nuevo.';
  end if;
  for r in
    select v.sha256 from public.documentacion_archivos a
    join public.documentacion_verificaciones v on v.archivo_id = a.id
    where a.documento_id = v_doc.id
  loop
    v_repetida := public.documentacion_huella_repetida(r.sha256, v_doc.empleado_id, v_doc.id);
    if v_repetida is not null then
      raise exception '%', v_repetida;
    end if;
  end loop;
  v_estado := case v_doc.origen when 'vigilador' then 'pendiente_revision' else 'pendiente_aceptacion' end;
  -- Lo reservado no espera constancia de la persona: queda vigente.
  if v_doc.sensibilidad = 'reservado_gerencia' then
    v_estado := 'aprobado';
  end if;
  update public.documentacion_documentos
     set estado = v_estado, confirmado_at = now(),
         revisado_por = case when v_estado = 'aprobado' then public.documentacion_usuario_actual() end,
         revisado_at  = case when v_estado = 'aprobado' then now() end
   where id = v_doc.id;
  perform public.documentacion_reemplazar_anteriores(v_doc.id,
    array['pendiente_revision','pendiente_aceptacion','rechazado','observado']
    || case when v_estado = 'aprobado' then array['aprobado','aceptado'] else array[]::text[] end);
  perform public.documentacion_registrar_evento(v_doc.id, 'cargado',
    jsonb_build_object('estado', v_estado, 'huellas', public.documentacion_huellas(v_doc.id)));
  return jsonb_build_object('documento_id', v_doc.id, 'estado', v_estado);
end;
$function$;
