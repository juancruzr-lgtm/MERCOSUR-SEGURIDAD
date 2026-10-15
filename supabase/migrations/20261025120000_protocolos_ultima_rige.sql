-- Protocolos: la última versión guardada rige (decisión de Gerencia, 15/10).
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
-- Antes: borrador → enviar a aprobación → Gerencia publica, con un registro de
-- diferencias a validar. Ahora:
--   · Guardar un protocolo desde la ficha del objetivo lo deja VIGENTE en el
--     acto (protocolo_guardar). La vigente anterior pasa a «reemplazado» y
--     queda en el historial con quién la puso en vigencia y cuándo; volver
--     atrás = guardar de nuevo aquel texto (otra versión, otra marca).
--   · Un borrador existente (la carga de Aldo) rige con protocolo_hacer_vigente.
--   · Lo pueden hacer quienes preparan protocolos: Administración, Gerencia,
--     jefatura de supervisores (Aldo) y dirección operativa, dentro de su
--     alcance (protocolo_puede_preparar + protocolo_puede_ver).
--
-- ── Único control que queda: el objetivo de los textos dudosos ──────────────
-- Siete textos de Aldo tienen la correspondencia con el objetivo sin
-- confirmar. Para ellos, la PRIMERA vez que se hacen regir (o se guarda una
-- edición sobre ellos) hay que pasar p_confirmar_objetivo = true; si no, la
-- base lo rechaza con «requiere_confirmar_objetivo». Queda registrado quién
-- y cuándo (asociacion_confirmada_por / _at). Después no se vuelve a pedir:
-- toda versión nueva nace con el objetivo confirmado.
--
-- ── Edición simultánea ───────────────────────────────────────────────────────
-- p_vigente_esperada: la versión vigente que la persona tenía en pantalla al
-- empezar a editar (NULL si no había). Si mientras tanto otra persona guardó
-- otra, se rechaza con «conflicto_version» y no se pisa nada.
--
-- ── Controles que salen de la versión anterior ──────────────────────────────
-- Guardar NO toca checklist, rondas, tareas ni alertas. Devuelve cuántos
-- controles activos salían de la versión reemplazada, para que la pantalla
-- avise que conviene revisarlos.
--
-- ── Aviso al vigilador ───────────────────────────────────────────────────────
-- protocolo_mis_documentos suma «cambio»: true si la persona había confirmado
-- una versión anterior del mismo protocolo y la vigente es otra. La app lo
-- muestra como «tu protocolo cambió: leelo y confirmá».
--
-- Esta migración NO publica nada ni borra datos. Las tablas de diferencias
-- quedan como están (la pantalla deja de usarlas).
-- Rollback: supabase/rollback/20261025120000_protocolos_ultima_rige_rollback.sql

begin;

-- ============================================================================
-- 1. HACER REGIR UNA VERSIÓN EXISTENTE
-- ============================================================================
create or replace function public.protocolo_hacer_vigente(
  p_version_id uuid,
  p_vigente_esperada uuid default null,
  p_confirmar_objetivo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver        public.protocolo_versiones%rowtype;
  v_quien      uuid;
  v_anterior   uuid;
  v_controles  integer := 0;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para cambiar protocolos' using errcode = '42501';
  end if;
  v_ver := (select v from public.protocolo_versiones v where v.id = p_version_id);
  if v_ver.id is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if not public.protocolo_puede_ver(v_ver.objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if v_ver.estado = 'vigente' then
    return jsonb_build_object('ok', true, 'ya_vigente', true, 'id', v_ver.id, 'numero', v_ver.numero, 'controles_version_anterior', 0);
  end if;
  if v_ver.estado not in ('borrador', 'pendiente_aprobacion') then
    raise exception 'Esta version esta % : para volver a ella, guardarla de nuevo', v_ver.estado using errcode = '22023';
  end if;
  if v_ver.asociacion <> 'confirmada' and not coalesce(p_confirmar_objetivo, false) then
    raise exception 'requiere_confirmar_objetivo: confirmar que este protocolo corresponde a este objetivo' using errcode = '22023';
  end if;
  v_quien := public.rondas_usuario_actual_id();

  perform pg_advisory_xact_lock(hashtext('protocolo:' || v_ver.objetivo_id::text));

  v_anterior := (
    select v.id from public.protocolo_versiones v
    where v.objetivo_id = v_ver.objetivo_id
      and v.puesto_id is not distinct from v_ver.puesto_id
      and v.estado = 'vigente'
  );
  if v_anterior is distinct from p_vigente_esperada then
    raise exception 'conflicto_version: otra persona guardo una version mas nueva; actualizar la pantalla' using errcode = '40001';
  end if;

  if v_ver.asociacion <> 'confirmada' then
    update public.protocolo_versiones
       set asociacion = 'confirmada', asociacion_confirmada_por = v_quien, asociacion_confirmada_at = now()
     where id = v_ver.id;
  end if;
  if v_ver.estado = 'borrador' then
    update public.protocolo_versiones
       set estado = 'pendiente_aprobacion', enviado_aprobacion_por = v_quien, enviado_aprobacion_at = now()
     where id = v_ver.id;
  end if;

  if v_anterior is not null then
    update public.protocolo_versiones
       set estado = 'reemplazado', reemplazado_at = now(), reemplazado_por_version = v_ver.id
     where id = v_anterior;
    -- Controles activos que salen de la versión reemplazada (Etapa 2). No se
    -- tocan: sólo se informan para revisarlos.
    -- (IF anidado: la consulta se planifica sólo si la tabla existe.)
    if to_regclass('public.protocolo_controles_propuestos') is not null then
      v_controles := (select count(*)::int from public.protocolo_controles_propuestos c
                      where c.version_id = v_anterior and c.estado = 'activado');
    end if;
  end if;

  update public.protocolo_versiones
     set estado = 'vigente', aprobado_por = v_quien, aprobado_at = now()
   where id = v_ver.id;

  return jsonb_build_object('ok', true, 'ya_vigente', false, 'id', v_ver.id, 'numero', v_ver.numero,
                            'reemplazo', v_anterior, 'controles_version_anterior', v_controles);
end;
$fn$;

-- ============================================================================
-- 2. GUARDAR = VERSIÓN NUEVA VIGENTE
-- ============================================================================
-- p_base_version_id: la versión que se editó (o a la que se vuelve). Sin
-- cambios respecto de una versión viva, no crea otra.
create or replace function public.protocolo_guardar(
  p_objetivo_id uuid,
  p_puesto_id uuid,
  p_titulo text,
  p_texto text,
  p_base_version_id uuid default null,
  p_vigente_esperada uuid default null,
  p_confirmar_objetivo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_base    public.protocolo_versiones%rowtype;
  v_fuente  text;
  v_nueva   jsonb;
  v_actual  uuid;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para cambiar protocolos' using errcode = '42501';
  end if;
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;

  -- Edición simultánea: se valida antes de crear nada.
  perform pg_advisory_xact_lock(hashtext('protocolo:' || p_objetivo_id::text));
  v_actual := (
    select v.id from public.protocolo_versiones v
    where v.objetivo_id = p_objetivo_id and v.puesto_id is not distinct from p_puesto_id and v.estado = 'vigente'
  );
  if v_actual is distinct from p_vigente_esperada then
    raise exception 'conflicto_version: otra persona guardo una version mas nueva; actualizar la pantalla' using errcode = '40001';
  end if;

  if p_base_version_id is not null then
    v_base := (select v from public.protocolo_versiones v where v.id = p_base_version_id);
    if v_base.id is null or v_base.objetivo_id <> p_objetivo_id
       or v_base.puesto_id is distinct from p_puesto_id then
      raise exception 'La version de origen no es de este objetivo' using errcode = '22023';
    end if;
    -- Un texto dudoso no se convierte en vigente por la vía de editarlo.
    if v_base.asociacion <> 'confirmada' and not coalesce(p_confirmar_objetivo, false) then
      raise exception 'requiere_confirmar_objetivo: confirmar que este protocolo corresponde a este objetivo' using errcode = '22023';
    end if;
    -- Sin cambios: se hace regir la misma versión en lugar de duplicarla.
    if v_base.texto = p_texto and v_base.titulo = btrim(p_titulo)
       and v_base.estado in ('borrador', 'pendiente_aprobacion', 'vigente') then
      return public.protocolo_hacer_vigente(v_base.id, p_vigente_esperada, p_confirmar_objetivo);
    end if;
    if v_base.asociacion <> 'confirmada' then
      update public.protocolo_versiones
         set asociacion = 'confirmada', asociacion_confirmada_por = public.rondas_usuario_actual_id(),
             asociacion_confirmada_at = now()
       where id = v_base.id and estado in ('borrador', 'pendiente_aprobacion');
    end if;
    v_fuente := 'Editado en la app sobre la version ' || v_base.numero || '. Fuente de esa version: ' || v_base.fuente_descripcion;
  else
    v_fuente := 'Escrito en la app';
  end if;

  v_nueva := public.protocolo_crear_borrador(p_objetivo_id, p_puesto_id, p_titulo, p_texto, 'manual', v_fuente, null, null);
  return public.protocolo_hacer_vigente((v_nueva->>'id')::uuid, v_actual, true);
end;
$fn$;

revoke all on function public.protocolo_hacer_vigente(uuid, uuid, boolean) from public, anon;
revoke all on function public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.protocolo_hacer_vigente(uuid, uuid, boolean) to authenticated;
grant execute on function public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean) to authenticated;

comment on function public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean) is
  'Guarda una version nueva del protocolo y la deja vigente (la anterior queda '
  'reemplazada en el historial). Rechaza si otra persona guardo antes '
  '(conflicto_version) o si el objetivo de un texto dudoso no se confirmo.';

-- ============================================================================
-- 3. AVISO AL VIGILADOR: «tu protocolo cambió»
-- ============================================================================
create or replace function public.protocolo_mis_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_empleado uuid;
  v_docs     jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado', 'documentos', '[]'::jsonb);
  end if;
  v_empleado := public.rondas_usuario_actual_id();
  if v_empleado is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo', 'documentos', '[]'::jsonb);
  end if;

  v_docs := (
    select coalesce(jsonb_agg(jsonb_build_object(
        'version_id', v.id,
        'objetivo_id', v.objetivo_id,
        'objetivo_nombre', o.nombre,
        'puesto_id', v.puesto_id,
        'puesto_nombre', p.nombre,
        'numero', v.numero,
        'titulo', v.titulo,
        'texto', v.texto,
        'texto_sha256', v.texto_sha256,
        'aprobado_at', v.aprobado_at,
        'turnos', x.turnos,
        'abierto_at', ap.abierto_at,
        'confirmado_at', co.confirmado_at,
        -- Confirmó una versión anterior de este mismo protocolo: cambió.
        'cambio', co.id is null and exists (
          select 1 from public.protocolo_confirmaciones c2
          join public.protocolo_versiones v2 on v2.id = c2.version_id
          where c2.empleado_id = v_empleado and v2.id <> v.id
            and v2.objetivo_id = v.objetivo_id and v2.puesto_id is not distinct from v.puesto_id)
      ) order by o.nombre, v.puesto_id nulls first), '[]'::jsonb)
    from (
      select v2.id as version_id, jsonb_agg(distinct h.turno_id) as turnos
      from public.protocolo_versiones v2
      join public.protocolo_turnos_habilitados() h
        on h.objetivo_id = v2.objetivo_id
       and (v2.puesto_id is null or v2.puesto_id = h.puesto_id)
      where v2.estado = 'vigente'
      group by v2.id
    ) x
    join public.protocolo_versiones v on v.id = x.version_id
    join public.objetivos o on o.id = v.objetivo_id
    left join public.puestos p on p.id = v.puesto_id
    left join public.protocolo_aperturas ap on ap.version_id = v.id and ap.empleado_id = v_empleado
    left join public.protocolo_confirmaciones co on co.version_id = v.id and co.empleado_id = v_empleado
  );

  return jsonb_build_object('ok', true, 'empleado_id', v_empleado, 'generado_at', now(), 'documentos', v_docs);
end;
$fn$;

revoke all on function public.protocolo_mis_documentos() from public, anon;
grant execute on function public.protocolo_mis_documentos() to authenticated;

notify pgrst, 'reload schema';

commit;
