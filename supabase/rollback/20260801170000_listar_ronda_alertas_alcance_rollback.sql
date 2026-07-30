-- ============================================================================
-- ROLLBACK de 20260801170000_listar_ronda_alertas_alcance
-- ============================================================================
--
-- Restituye `listar_ronda_alertas_objetivo()` exactamente como la dejó
-- 20260801100000_ronda_alertas_suspendida.sql: `p_objetivo_id` obligatorio, sin
-- `objetivo_nombre` en el payload, orden por `detectada_at desc`.
--
-- CONSECUENCIA CONOCIDA de volver atrás: el panel principal y la pestaña Rondas
-- del supervisor se quedan sin fuente de datos —vuelven a exigir un objetivo por
-- llamada—. Revertir también el frontend.

begin;

-- Mismo criterio que la migración: DROP + CREATE, porque se le quita el default
-- a p_objetivo_id.
drop function if exists public.listar_ronda_alertas_objetivo(uuid, text);

create function public.listar_ronda_alertas_objetivo(
  p_objetivo_id uuid,
  p_estado      text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'alertas', jsonb_build_array());
  end if;
  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'alertas', jsonb_build_array());
  end if;
  if p_estado is not null and p_estado not in ('pendiente', 'resuelta') then
    return jsonb_build_object('contexto', 'parametro_invalido', 'alertas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'alertas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',              a.id,
          'tipo',            a.tipo,
          'estado',          a.estado,
          'objetivo_id',     a.objetivo_id,
          'puesto_id',       a.puesto_id,
          'puesto_nombre',   pu.nombre,
          'ronda_base_id',   a.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'turno_id',        a.turno_id,
          'guardia_id',      a.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ejecucion_id',    a.ejecucion_id,
          'ventana_inicio',  a.ventana_inicio,
          'ventana_fin',     a.ventana_fin,
          'vencimiento_at',  a.vencimiento_at,
          'detectada_at',    a.detectada_at,
          'resuelta_por',    a.resuelta_por,
          'resuelta_por_nombre', case when a.resuelta_por is null then null
                                      else rp.apellido || ', ' || rp.nombre end,
          'resuelta_at',     a.resuelta_at,
          'accion',          a.accion,
          'comentario',      a.comentario,
          'motivo_vigilador',a.motivo_vigilador,
          'intervenciones',  (select count(*) from public.ronda_alerta_intervenciones i
                                where i.ronda_alerta_id = a.id)
        )
        order by a.detectada_at desc
      )
      from public.ronda_alertas a
      join public.rondas_base rb on rb.id = a.ronda_base_id
      join public.puestos    pu on pu.id = a.puesto_id
      join public.usuarios    g on  g.id = a.guardia_id
      left join public.usuarios rp on rp.id = a.resuelta_por
      where a.objetivo_id = p_objetivo_id
        and (p_estado is null or a.estado = p_estado)
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from public;
revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from anon;
grant execute on function public.listar_ronda_alertas_objetivo(uuid, text) to authenticated;

drop index if exists public.idx_ronda_alertas_estado_objetivo;

notify pgrst, 'reload schema';

commit;
