-- Protocolos: la última versión guardada rige (decisión de Gerencia, 15/10).
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
-- Antes: borrador → enviar a aprobación → Gerencia publica, con un registro de
-- diferencias a validar. En la práctica las diferencias eran de redacción y el
-- circuito trababa el uso. Ahora:
--   · Guardar un protocolo desde la ficha del objetivo lo deja VIGENTE en el
--     acto: es lo que ve el vigilador desde ese momento.
--   · La vigente anterior pasa a «reemplazado» y queda en el historial (nada
--     se borra ni se reescribe; volver atrás = guardar de nuevo aquel texto).
--   · Guardar en la ficha de un objetivo confirma que el texto es de ese
--     objetivo (la «asociación» deja de ser un paso aparte).
--   · Lo pueden hacer quienes preparan protocolos: Administración, Gerencia,
--     jefatura de supervisores y dirección operativa (protocolo_puede_preparar).
--   · Los borradores que ya existen (la carga de Aldo) siguen siendo borradores
--     hasta que alguien, desde la ficha, los haga regir o guarde otra versión.
--     Esta migración NO publica nada.
--
-- Se mantiene: versiones inmutables, apertura y confirmación de lectura por
-- versión (el vigilador confirma de nuevo cuando cambia), permisos por zona.
-- Las tablas de diferencias quedan como están (la pantalla deja de usarlas).
-- Rollback: supabase/rollback/20261025120000_protocolos_ultima_rige_rollback.sql

begin;

-- Hace regir una versión existente (borrador o pendiente).
create or replace function public.protocolo_hacer_vigente(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver      public.protocolo_versiones%rowtype;
  v_quien    uuid;
  v_anterior uuid;
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
    return jsonb_build_object('ok', true, 'ya_vigente', true, 'id', v_ver.id);
  end if;
  if v_ver.estado not in ('borrador', 'pendiente_aprobacion') then
    raise exception 'Esta version esta % : para volver a ella, guardarla de nuevo', v_ver.estado using errcode = '22023';
  end if;
  v_quien := public.rondas_usuario_actual_id();

  perform pg_advisory_xact_lock(hashtext('protocolo:' || v_ver.objetivo_id::text));

  -- Guardarlo en la ficha de este objetivo confirma que es de este objetivo.
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

  v_anterior := (
    select v.id from public.protocolo_versiones v
    where v.objetivo_id = v_ver.objetivo_id
      and v.puesto_id is not distinct from v_ver.puesto_id
      and v.estado = 'vigente'
  );
  if v_anterior is not null then
    update public.protocolo_versiones
       set estado = 'reemplazado', reemplazado_at = now(), reemplazado_por_version = v_ver.id
     where id = v_anterior;
  end if;

  update public.protocolo_versiones
     set estado = 'vigente', aprobado_por = v_quien, aprobado_at = now()
   where id = v_ver.id;

  return jsonb_build_object('ok', true, 'ya_vigente', false, 'id', v_ver.id, 'reemplazo', v_anterior);
end;
$fn$;

-- Guarda un texto como versión nueva y la deja vigente, en una sola operación.
-- p_base_version_id: la versión que se editó (queda registrada en la fuente).
create or replace function public.protocolo_guardar(
  p_objetivo_id uuid,
  p_puesto_id uuid,
  p_titulo text,
  p_texto text,
  p_base_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_base   public.protocolo_versiones%rowtype;
  v_fuente text;
  v_nueva  jsonb;
  v_id     uuid;
  v_res    jsonb;
begin
  if not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para cambiar protocolos' using errcode = '42501';
  end if;
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;

  if p_base_version_id is not null then
    v_base := (select v from public.protocolo_versiones v where v.id = p_base_version_id);
    if v_base.id is null or v_base.objetivo_id <> p_objetivo_id
       or v_base.puesto_id is distinct from p_puesto_id then
      raise exception 'La version de origen no es de este objetivo' using errcode = '22023';
    end if;
    -- Sin cambios: se hace regir la misma versión en lugar de duplicarla.
    if v_base.texto = p_texto and v_base.titulo = btrim(p_titulo)
       and v_base.estado in ('borrador', 'pendiente_aprobacion', 'vigente') then
      return public.protocolo_hacer_vigente(v_base.id);
    end if;
    v_fuente := 'Editado en la app sobre la version ' || v_base.numero || '. Fuente de esa version: ' || v_base.fuente_descripcion;
  else
    v_fuente := 'Escrito en la app';
  end if;

  v_nueva := public.protocolo_crear_borrador(p_objetivo_id, p_puesto_id, p_titulo, p_texto, 'manual', v_fuente, null, null);
  v_id := (v_nueva->>'id')::uuid;
  v_res := public.protocolo_hacer_vigente(v_id);
  return v_res || jsonb_build_object('numero', (v_nueva->>'numero')::integer);
end;
$fn$;

revoke all on function public.protocolo_hacer_vigente(uuid) from public, anon;
revoke all on function public.protocolo_guardar(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.protocolo_hacer_vigente(uuid) to authenticated;
grant execute on function public.protocolo_guardar(uuid, uuid, text, text, uuid) to authenticated;

comment on function public.protocolo_guardar(uuid, uuid, text, text, uuid) is
  'Guarda una version nueva del protocolo y la deja vigente (la anterior queda '
  'reemplazada en el historial). Quien prepara protocolos, dentro de su alcance.';

notify pgrst, 'reload schema';

commit;
