-- Rollback de 20261026120000_checklist_solo_supervisor.sql
--
-- Vuelve protocolo_controles_activar a «sólo Gerencia» (definición de
-- 20261023120000) y quita protocolo_control_agregar_checklist. NO reabre los
-- controles cerrados como descartados en el punto 3 (quedan en el historial)
-- ni saca del checklist los puntos ya agregados.

begin;

drop function if exists public.protocolo_control_agregar_checklist(uuid, text);

create or replace function public.protocolo_controles_activar(p_objetivo_id uuid, p_control_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario   uuid;
  v_obj       public.objetivos%rowtype;
  v_actual    public.checklist_plantillas%rowtype;
  v_plantilla uuid;
  v_creada    boolean := false;
  v_c         public.protocolo_controles_propuestos%rowtype;
  v_item      uuid;
  v_orden     integer;
  v_nuevos    integer := 0;
  v_reusados  integer := 0;
  v_cid       uuid;
begin
  if auth.uid() is null or not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia activa controles del protocolo' using errcode = '42501';
  end if;
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if p_control_ids is null or cardinality(p_control_ids) = 0 then
    raise exception 'No hay controles para activar' using errcode = '22023';
  end if;
  v_usuario := public.rondas_usuario_actual_id();
  v_obj := (select o from public.objetivos o where o.id = p_objetivo_id for update);
  if v_obj.id is null then
    raise exception 'Objetivo inexistente' using errcode = '22023';
  end if;

  -- Validar todo antes de tocar nada.
  foreach v_cid in array p_control_ids loop
    v_c := (select c from public.protocolo_controles_propuestos c where c.id = v_cid for update);
    if v_c.id is null or v_c.objetivo_id <> p_objetivo_id then
      raise exception 'El control % no es de este objetivo', v_cid using errcode = '22023';
    end if;
    if v_c.estado <> 'aprobado' then
      raise exception 'Solo se activa lo aprobado (el control «%» esta %)', v_c.texto_item, v_c.estado using errcode = '22023';
    end if;
    if v_c.destino <> 'checklist_supervision' then
      raise exception 'En esta etapa solo se activan puntos del checklist de supervision («%» es %)', v_c.texto_item, v_c.destino
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.protocolo_versiones v
      join public.protocolo_instrucciones i on i.version_id = v.id
      where v.id = v_c.version_id and i.id = v_c.instruccion_id
        and v.estado = 'vigente' and i.obsoleta_at is null
        and i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex')
    ) then
      raise exception 'El control «%» no sale de una version vigente del protocolo: publicar la version primero', v_c.texto_item
        using errcode = '22023';
    end if;
  end loop;

  -- Plantilla propia del objetivo.
  v_actual := (select p from public.checklist_plantillas p where p.id = v_obj.checklist_plantilla_id);
  if v_actual.id is not null and v_actual.objetivo_id = p_objetivo_id then
    v_plantilla := v_actual.id;
  else
    insert into public.checklist_plantillas (nombre, descripcion, activo, objetivo_id, copiada_de_plantilla_id)
    values (
      left(coalesce(v_obj.nombre, 'Objetivo'), 120) || ' · checklist del protocolo',
      case when v_actual.id is null
        then 'Plantilla propia del objetivo con los puntos aprobados de su protocolo.'
        else 'Copia de «' || v_actual.nombre || '» mas los puntos aprobados del protocolo del objetivo.' end,
      true, p_objetivo_id, v_actual.id
    ) returning id into v_plantilla;
    if v_actual.id is not null then
      insert into public.checklist_items (plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo)
      select v_plantilla, ci.texto, ci.orden, ci.obligatorio, ci.criticidad, ci.foto_obligatoria, true
      from public.checklist_items ci
      where ci.plantilla_id = v_actual.id and ci.activo;
    end if;
    update public.objetivos set checklist_plantilla_id = v_plantilla where id = p_objetivo_id;
    v_creada := true;
  end if;

  foreach v_cid in array p_control_ids loop
    v_c := (select c from public.protocolo_controles_propuestos c where c.id = v_cid);
    v_item := (select ci.id from public.checklist_items ci
               where ci.plantilla_id = v_plantilla and ci.activo
                 and public.protocolo_normalizar(ci.texto) = public.protocolo_normalizar(v_c.texto_item)
               order by ci.orden limit 1);
    if v_item is null then
      v_orden := (select coalesce(max(ci.orden), 0) + 1 from public.checklist_items ci where ci.plantilla_id = v_plantilla);
      insert into public.checklist_items (plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo, origen_instruccion_id)
      values (v_plantilla, v_c.texto_item, v_orden, true, v_c.criticidad, v_c.foto_obligatoria, true, v_c.instruccion_id)
      returning id into v_item;
      v_nuevos := v_nuevos + 1;
    else
      v_reusados := v_reusados + 1;
    end if;
    update public.protocolo_controles_propuestos
       set estado = 'activado', activado_por = v_usuario, activado_at = now(),
           plantilla_id = v_plantilla, checklist_item_id = v_item
     where id = v_c.id;
  end loop;

  return jsonb_build_object('ok', true, 'plantilla_id', v_plantilla, 'plantilla_creada', v_creada,
                            'items_nuevos', v_nuevos, 'items_reutilizados', v_reusados);
end;
$fn$;

revoke all on function public.protocolo_controles_activar(uuid, uuid[]) from public, anon;
grant execute on function public.protocolo_controles_activar(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;
