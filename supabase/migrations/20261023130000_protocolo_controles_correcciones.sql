-- Protocolos — Etapa 2, correcciones (sobre 20261023120000, ya aplicada).
--
-- ── Por qué una migración nueva ─────────────────────────────────────────────
-- 20261023120000 ya corre en producción (tablas vacías, nada activado). Las
-- correcciones van encima, sin reescribir lo aplicado.
--
-- ── 1. Instrucciones completas, no renglones ────────────────────────────────
-- Antes, protocolo_instrucciones_segmentar dividía el texto por líneas: una
-- instrucción que ocupa dos renglones quedaba partida y un renglón con tres
-- obligaciones quedaba como una. Ahora la IA identifica cada instrucción
-- completa citándola LITERALMENTE; la aplicación ubica esa cita en el texto
-- original y manda el rango. protocolo_instrucciones_registrar verifica en la
-- base que cada rango esté dentro del texto, en orden y sin superponerse, y
-- guarda el hash del fragmento: la referencia al texto original sigue siendo
-- exacta y el texto del protocolo no se copia ni se toca.
-- La división por renglones deja de estar disponible para los usuarios.
--
-- ── 2. Supervisiones en curso ───────────────────────────────────────────────
-- validar_supervision_plantilla exigía que plantilla_id coincidiera con la
-- plantilla ACTUAL del objetivo en cada INSERT y UPDATE. Al activar el
-- checklist del protocolo, el objetivo pasa a una plantilla propia: una
-- supervisión que el supervisor empezó con la anterior no se podía guardar, y
-- tampoco se podía actualizar ninguna supervisión vieja. Ahora:
--   · UPDATE: sólo se valida si cambia la plantilla o el objetivo.
--   · INSERT: se acepta la plantilla actual o, durante 24 h desde el cambio,
--     la plantilla de la que se copió la propia del objetivo.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No activa nada, no toca rondas, alertas, calificaciones ni liquidación.
-- Rollback: supabase/rollback/20261023130000_protocolo_controles_correcciones_rollback.sql

begin;

-- ============================================================================
-- 1. REGISTRAR INSTRUCCIONES DESDE CITAS DE LA IA
-- ============================================================================
-- p_rangos: arreglo [{inicio, fin}] en caracteres (0-based, fin exclusivo),
-- en el orden del texto. Si la versión ya tiene instrucciones vigentes e
-- intactas, no hace nada (devuelve ya_segmentada). Si las que tiene quedaron
-- desactualizadas (se editó el borrador), las marca obsoletas, rechaza sus
-- controles en curso y registra las nuevas.
create or replace function public.protocolo_instrucciones_registrar(p_version_id uuid, p_rangos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver       public.protocolo_versiones%rowtype;
  v_usuario   uuid;
  v_largo     integer;
  v_r         jsonb;
  v_inicio    integer;
  v_fin       integer;
  v_prev_fin  integer := 0;
  v_orden     integer := 0;
  v_obsoletas integer := 0;
  v_ids       uuid[] := '{}';
  v_id        uuid;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_usuario := public.rondas_usuario_actual_id();
  v_largo := char_length(v_ver.texto);

  if p_rangos is null or jsonb_typeof(p_rangos) <> 'array' or jsonb_array_length(p_rangos) = 0 then
    raise exception 'No llegaron instrucciones para registrar' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rangos) > 200 then
    raise exception 'Demasiadas instrucciones (maximo 200)' using errcode = '22023';
  end if;

  if exists (select 1 from public.protocolo_instrucciones i where i.version_id = v_ver.id and i.obsoleta_at is null) then
    if not exists (
      select 1 from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null
        and (i.fin > v_largo
             or i.texto_sha256 <> encode(sha256(convert_to(public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin), 'UTF8')), 'hex'))
    ) then
      return jsonb_build_object('ok', true, 'ya_segmentada', true, 'creadas', 0, 'ids', '[]'::jsonb);
    end if;
    update public.protocolo_instrucciones i set obsoleta_at = now()
    where i.version_id = v_ver.id and i.obsoleta_at is null;
    get diagnostics v_obsoletas = row_count;
    update public.protocolo_controles_propuestos c
       set estado = 'rechazado', rechazado_por = v_usuario, rechazado_at = now(),
           motivo_rechazo = 'El texto del borrador cambio: la instruccion quedo obsoleta'
    where c.version_id = v_ver.id and c.estado in ('propuesto', 'aprobado');
  end if;

  for v_r in select * from jsonb_array_elements(p_rangos) loop
    if jsonb_typeof(v_r->'inicio') <> 'number' or jsonb_typeof(v_r->'fin') <> 'number' then
      raise exception 'Rango invalido' using errcode = '22023';
    end if;
    v_inicio := (v_r->>'inicio')::integer;
    v_fin := (v_r->>'fin')::integer;
    if v_inicio < v_prev_fin or v_fin <= v_inicio or v_fin > v_largo then
      raise exception 'Rango fuera del texto o superpuesto (% - %)', v_inicio, v_fin using errcode = '22023';
    end if;
    if btrim(public.protocolo_fragmento(v_ver.texto, v_inicio, v_fin), E' \t\r\n') = '' then
      raise exception 'Rango sin texto (% - %)', v_inicio, v_fin using errcode = '22023';
    end if;
    v_orden := v_orden + 1;
    insert into public.protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256, creado_por)
    values (v_ver.id, v_ver.objetivo_id, v_orden, v_inicio, v_fin, repeat('0', 64), v_usuario)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_prev_fin := v_fin;
  end loop;

  return jsonb_build_object('ok', true, 'ya_segmentada', false, 'creadas', v_orden,
                            'obsoletas', v_obsoletas, 'ids', to_jsonb(v_ids));
end;
$fn$;

revoke all on function public.protocolo_instrucciones_registrar(uuid, jsonb) from public, anon;
grant execute on function public.protocolo_instrucciones_registrar(uuid, jsonb) to authenticated;

comment on function public.protocolo_instrucciones_registrar(uuid, jsonb) is
  'Registra las instrucciones completas que identifico la IA (rangos exactos del '
  'texto original, en orden y sin superponerse). Quien prepara protocolos.';

-- La división por renglones queda fuera del alcance de los usuarios.
revoke execute on function public.protocolo_instrucciones_segmentar(uuid) from authenticated;

-- ============================================================================
-- 2. CONTEXTO PARA LA IA: texto completo y si hace falta identificar
-- ============================================================================
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
  v_requiere  boolean;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = v_ver.objetivo_id);
  v_requiere := not exists (
      select 1 from public.protocolo_instrucciones i where i.version_id = v_ver.id and i.obsoleta_at is null)
    or exists (
      select 1 from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null
        and (i.fin > char_length(v_ver.texto)
             or i.texto_sha256 <> encode(sha256(convert_to(public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin), 'UTF8')), 'hex')));

  return jsonb_build_object(
    'version_id', v_ver.id,
    'objetivo_id', v_ver.objetivo_id,
    'objetivo_nombre', (select o.nombre from public.objetivos o where o.id = v_ver.objetivo_id),
    'titulo', v_ver.titulo,
    'texto', v_ver.texto,
    'requiere_identificar', v_requiere,
    'instrucciones', case when v_requiere then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'orden', i.orden,
          'texto', public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin),
          'clasificacion', i.clasificacion,
          'tiene_control', exists (select 1 from public.protocolo_controles_propuestos c
                                   where c.instruccion_id = i.id and c.estado <> 'rechazado')
        ) order by i.orden), '[]'::jsonb)
      from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null) end,
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

-- ============================================================================
-- 3. SUPERVISIONES EN CURSO AL CAMBIAR LA PLANTILLA
-- ============================================================================
create or replace function public.validar_supervision_plantilla()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_plantilla_objetivo uuid;
begin
  -- Actualizar una supervisión (estado, observaciones) no vuelve a exigir la
  -- plantilla vigente del objetivo: se guardó con la que correspondía.
  if tg_op = 'UPDATE'
     and new.plantilla_id is not distinct from old.plantilla_id
     and new.objetivo_id is not distinct from old.objetivo_id then
    return new;
  end if;

  v_plantilla_objetivo := (select o.checklist_plantilla_id from public.objetivos o where o.id = new.objetivo_id);

  if v_plantilla_objetivo is not null then
    if new.plantilla_id is null then
      raise exception 'La supervision requiere plantilla para este objetivo';
    end if;

    if new.plantilla_id <> v_plantilla_objetivo then
      -- Supervisión empezada antes de que Gerencia activara el checklist del
      -- protocolo: vale la plantilla anterior durante 24 h desde el cambio.
      if not exists (
        select 1 from public.checklist_plantillas p
        where p.id = v_plantilla_objetivo
          and p.copiada_de_plantilla_id = new.plantilla_id
          and p.created_at > now() - interval '24 hours'
      ) then
        raise exception 'La plantilla de la supervision no coincide con la plantilla del objetivo';
      end if;
    end if;
  end if;

  return new;
end;
$fn$;

notify pgrst, 'reload schema';

commit;
