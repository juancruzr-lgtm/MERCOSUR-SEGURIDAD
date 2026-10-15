-- Rollback de 20261025120000_protocolos_ultima_rige.sql. Correr por separado.
-- Quita guardar / hacer regir y devuelve protocolo_mis_documentos a su
-- version de 20261022120000 (sin el aviso de cambio). Las versiones que ya
-- quedaron vigentes siguen vigentes (son filas validas).

begin;

drop function if exists public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean);
drop function if exists public.protocolo_hacer_vigente(uuid, uuid, boolean);

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
        'confirmado_at', co.confirmado_at
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

  return jsonb_build_object(
    'ok', true,
    'empleado_id', v_empleado,
    'generado_at', now(),
    'documentos', v_docs
  );
end;
$fn$;

revoke all on function public.protocolo_mis_documentos() from public, anon;
grant execute on function public.protocolo_mis_documentos() to authenticated;

notify pgrst, 'reload schema';

commit;
