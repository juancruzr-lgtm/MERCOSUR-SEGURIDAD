-- Checklist desde el protocolo: sólo lo que controla el supervisor, en un paso.
--
-- ── Pedido (JC, 16/10/2026, probando con CIRSE) ─────────────────────────────
-- «Sólo quiero que saque cosas que tenga que supervisar el supervisor cuando
-- haga la visita.» Sin clasificaciones, sin informativas, sin validar, sin
-- aprobar y activar por separado. Las tareas del vigilador ya están en el
-- protocolo que lee; no se proponen acá.
--
-- ── Qué cambia ──────────────────────────────────────────────────────────────
--  1. protocolo_control_agregar_checklist(control, texto): UN paso. Quien
--     puede editar el protocolo (Administración, Gerencia, jefatura de
--     supervisores, dirección operativa) agrega un punto propuesto al
--     checklist del objetivo. Por dentro hace lo mismo que antes —deja
--     registrado quién y cuándo, crea o reutiliza la plantilla propia del
--     objetivo y guarda origen_instruccion_id—, pero sin pasos visibles.
--  2. protocolo_controles_activar: lo puede usar quien edita el protocolo
--     (antes sólo Gerencia), igual que guardar el protocolo.
--  3. Los controles en curso que no son del checklist del supervisor (ronda,
--     tarea del turno, orden, alerta) se cierran como descartados: hoy son 2,
--     ambos de la prueba de CIRSE. No hay tareas del turno activadas.
--
-- Sigue igual: sólo desde la versión que rige, la plantilla general no se toca
-- (se copia), no toca rondas, alertas, calificaciones ni liquidación.
-- Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261026120000_checklist_solo_supervisor_rollback.sql

begin;

-- ============================================================================
-- 1. ACTIVAR: quien edita el protocolo
-- ============================================================================

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
  if auth.uid() is null or not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para cambiar el checklist del objetivo' using errcode = '42501';
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
      raise exception 'Solo se agregan puntos del checklist de supervision («%» es %)', v_c.texto_item, v_c.destino
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.protocolo_versiones v
      join public.protocolo_instrucciones i on i.version_id = v.id
      where v.id = v_c.version_id and i.id = v_c.instruccion_id
        and v.estado = 'vigente' and i.obsoleta_at is null
        and i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex')
    ) then
      raise exception 'El punto «%» no sale del protocolo que rige: guardar el protocolo primero', v_c.texto_item
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
        then 'Plantilla propia del objetivo con los puntos de su protocolo.'
        else 'Copia de «' || v_actual.nombre || '» mas los puntos del protocolo del objetivo.' end,
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

-- ============================================================================
-- 2. AGREGAR AL CHECKLIST EN UN PASO
-- ============================================================================
-- p_texto: el texto corregido (NULL = el propuesto). Si ya hay en el checklist
-- del objetivo (o en otra propuesta) un punto con el mismo texto, no agrega y
-- devuelve {ok: false, motivo: 'ya_existe', existente}.

create or replace function public.protocolo_control_agregar_checklist(p_control_id uuid, p_texto text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c       public.protocolo_controles_propuestos%rowtype;
  v_ins     public.protocolo_instrucciones%rowtype;
  v_usuario uuid;
  v_texto   text;
  v_exist   jsonb;
begin
  v_c := (select c from public.protocolo_controles_propuestos c where c.id = p_control_id for update);
  if v_c.id is null then
    raise exception 'Punto inexistente' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.protocolo_puede_preparar() or not public.protocolo_puede_ver(v_c.objetivo_id) then
    raise exception 'No tenes permiso para cambiar el checklist del objetivo' using errcode = '42501';
  end if;
  if v_c.estado = 'activado' then
    return jsonb_build_object('ok', true, 'ya_estaba', true);
  end if;
  if v_c.estado not in ('propuesto', 'aprobado') then
    raise exception 'Ese punto fue descartado' using errcode = '22023';
  end if;
  if v_c.destino <> 'checklist_supervision' then
    raise exception 'Solo se agregan puntos del checklist de supervision' using errcode = '22023';
  end if;
  v_usuario := public.rondas_usuario_actual_id();

  -- Texto corregido.
  v_texto := btrim(coalesce(p_texto, ''));
  if v_texto <> '' and v_texto <> v_c.texto_item then
    if char_length(v_texto) > 500 then
      raise exception 'El texto del punto admite hasta 500 caracteres' using errcode = '22023';
    end if;
    if v_c.estado <> 'propuesto' then
      raise exception 'Ese punto ya no se puede corregir' using errcode = '22023';
    end if;
    update public.protocolo_controles_propuestos set texto_item = v_texto where id = v_c.id;
    v_c.texto_item := v_texto;
  end if;

  -- ¿Ya está?
  v_exist := public.protocolo_control_existente(v_c.objetivo_id, v_c.texto_item, v_c.id);
  if v_exist is not null and v_exist->>'tipo' in ('checklist_item', 'control_propuesto') then
    update public.protocolo_controles_propuestos
       set existente_tipo = v_exist->>'tipo', existente_id = (v_exist->>'id')::uuid, existente_texto = v_exist->>'texto'
     where id = v_c.id;
    -- Sin error: así queda marcado con qué coincide (un raise lo desharía).
    return jsonb_build_object('ok', false, 'motivo', 'ya_existe', 'existente', v_exist->>'texto');
  end if;

  -- La instrucción de origen queda registrada como algo a controlar.
  v_ins := (select i from public.protocolo_instrucciones i where i.id = v_c.instruccion_id);
  if v_ins.obsoleta_at is not null then
    raise exception 'El protocolo cambio: volver a pedir los puntos a la IA' using errcode = '22023';
  end if;
  if v_ins.validada_at is null or v_ins.clasificacion = 'informativa' then
    update public.protocolo_instrucciones
       set clasificacion = case when v_ins.clasificacion_ia in ('obligacion', 'frecuencia', 'excepcion')
                                then v_ins.clasificacion_ia else 'obligacion' end,
           validada_por = v_usuario, validada_at = now()
     where id = v_ins.id;
  end if;

  if v_c.estado = 'propuesto' then
    update public.protocolo_controles_propuestos
       set estado = 'aprobado', aprobado_por = v_usuario, aprobado_at = now(),
           existente_tipo = null, existente_id = null, existente_texto = null
     where id = v_c.id;
  end if;

  return public.protocolo_controles_activar(v_c.objetivo_id, array[v_c.id]) || jsonb_build_object('ya_estaba', false);
end;
$fn$;

revoke all on function public.protocolo_control_agregar_checklist(uuid, text) from public, anon;
grant execute on function public.protocolo_control_agregar_checklist(uuid, text) to authenticated;

comment on function public.protocolo_control_agregar_checklist(uuid, text) is
  'Agrega un punto propuesto desde el protocolo al checklist de supervision del '
  'objetivo, en un paso. Quien edita el protocolo. Solo desde la version que rige.';

-- ============================================================================
-- 3. CERRAR LO QUE NO ES DEL CHECKLIST DEL SUPERVISOR
-- ============================================================================
-- Al 16/10: 2 controles (tarea del turno y punto de ronda) de la prueba de
-- CIRSE. Se cierran como descartados con motivo; quedan en el historial.

update public.protocolo_controles_propuestos c
   set estado = 'rechazado',
       rechazado_por = coalesce(c.aprobado_por, c.creado_por),
       rechazado_at = now(),
       motivo_rechazo = 'Simplificacion 16/10: desde el protocolo solo se proponen puntos del checklist del supervisor'
 where c.estado in ('propuesto', 'aprobado')
   and c.destino <> 'checklist_supervision'
   and coalesce(c.aprobado_por, c.creado_por) is not null;

notify pgrst, 'reload schema';

commit;
