-- Rollback de 20261010130000: vuelve a las versiones de 20261009150000
-- (bandeja sin paginado ni DNI; búsqueda sin DNI) y quita la pista de la matriz.
-- No toca propuestas ni eventos.
begin;
drop function if exists public.legajo_historico_matriz();
drop function if exists public.legajo_historico_bandeja(text, integer, text, integer);

create or replace function public.legajo_historico_bandeja(p_estado text default 'pendiente', p_limite integer default 200, p_texto text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();
  return jsonb_build_object(
    'conteo', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
               from (select estado, count(*) n from public.legajo_historico_propuestas group by estado) x),
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
          'sugerido', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'nombre', s.nombre, 'apellido', s.apellido, 'legajo', s.legajo, 'estado', s.estado) end,
          'empleado_id', p.empleado_id, 'tipo', p.tipo, 'motivo', p.motivo, 'revisado_at', p.revisado_at
        ) order by p.confianza, p.creado_at), '[]'::jsonb)
      from (
        select * from public.legajo_historico_propuestas x
        where (p_estado is null or x.estado = p_estado)
          -- Búsqueda: archivo o persona (sugerida o asignada); con texto, todos los estados.
          and (char_length(btrim(coalesce(p_texto, ''))) < 3
               or x.id in (select (jsonb_array_elements_text(public.legajo_historico_buscar(p_texto)))::uuid))
        order by x.creado_at
        limit greatest(1, least(coalesce(p_limite, 200), 500))
      ) p
      left join public.usuarios s on s.id = p.empleado_id_sugerido
    )
  );
end;
$fn$;

revoke all on function public.legajo_historico_bandeja(text, integer, text) from public, anon;
grant execute on function public.legajo_historico_bandeja(text, integer, text) to authenticated;

create or replace function public.legajo_historico_buscar(p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t text := lower(btrim(coalesce(p_texto, '')));
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  if char_length(v_t) < 3 then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(x.id), '[]'::jsonb)
    from (
      select p.id from public.legajo_historico_propuestas p
      left join public.usuarios s on s.id = coalesce(p.empleado_id, p.empleado_id_sugerido)
      where lower(p.ruta_origen) like '%' || v_t || '%'
         or lower(coalesce(s.apellido, '') || ' ' || coalesce(s.nombre, '')) like '%' || v_t || '%'
         or lower(coalesce(s.legajo, '')) = v_t
      order by p.creado_at
      limit 200
    ) x
  );
end;
$fn$;

revoke all on function public.legajo_historico_buscar(text) from public, anon;
grant execute on function public.legajo_historico_buscar(text) to authenticated;

notify pgrst, 'reload schema';
commit;
