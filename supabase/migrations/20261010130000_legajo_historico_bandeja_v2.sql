-- Archivo histórico: bandeja con paginado, búsqueda por DNI y estado del
-- documento; referencias históricas para la matriz documental.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
--   * legajo_historico_bandeja: agrega p_desde (paginado; los parámetros
--     anteriores siguen igual) y devuelve además dni_sugerido, documento_id,
--     documento_estado (el del legajo, si ya se copió) y 'total' del filtro.
--   * legajo_historico_buscar: también encuentra por DNI (de la persona
--     asociada/sugerida o el leído del documento), con 6 dígitos o más.
--   * legajo_historico_matriz: una fila por persona y categoría con la mejor
--     referencia histórica (confirmada > asociación pendiente > localizada).
--     Es una PISTA para Administración: no cambia la situación documental,
--     los indicadores ni el cumplimiento.
--
-- Sólo Administración y Gerencia (documentacion_puede_gestionar), como el
-- resto del archivo histórico. No toca datos ni archivos.
--
-- Rollback: supabase/rollback/20261010130000_legajo_historico_bandeja_v2_rollback.sql

begin;

drop function if exists public.legajo_historico_bandeja(text, integer, text);

create or replace function public.legajo_historico_bandeja(
  p_estado text default 'pendiente', p_limite integer default 200, p_texto text default null, p_desde integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
  v_ids      uuid[];
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();
  if char_length(btrim(coalesce(p_texto, ''))) >= 3 then
    v_ids := (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(public.legajo_historico_buscar(p_texto)) x);
  end if;
  return jsonb_build_object(
    'conteo', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
               from (select estado, count(*) n from public.legajo_historico_propuestas group by estado) x),
    'total', (select count(*) from public.legajo_historico_propuestas x
              where (v_ids is not null or p_estado is null or x.estado = p_estado)
                and (v_ids is null or x.id = any(v_ids))),
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
          'dni_sugerido', p.dni_sugerido,
          'sugerido', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'nombre', s.nombre, 'apellido', s.apellido, 'legajo', s.legajo, 'estado', s.estado) end,
          'empleado_id', p.empleado_id, 'tipo', p.tipo, 'motivo', p.motivo, 'revisado_at', p.revisado_at,
          'documento_id', p.documento_id, 'documento_estado', d.estado
        ) order by p.creado_at, p.id), '[]'::jsonb)
      from (
        select * from public.legajo_historico_propuestas x
        -- Con búsqueda: todos los estados (como antes).
        where (v_ids is not null or p_estado is null or x.estado = p_estado)
          and (v_ids is null or x.id = any(v_ids))
        order by x.creado_at, x.id
        offset greatest(0, coalesce(p_desde, 0))
        limit greatest(1, least(coalesce(p_limite, 200), 500))
      ) p
      left join public.usuarios s on s.id = p.empleado_id_sugerido
      left join public.documentacion_documentos d on d.id = p.documento_id
    )
  );
end;
$fn$;

revoke all on function public.legajo_historico_bandeja(text, integer, text, integer) from public, anon;
grant execute on function public.legajo_historico_bandeja(text, integer, text, integer) to authenticated;

create or replace function public.legajo_historico_buscar(p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_t   text := lower(btrim(coalesce(p_texto, '')));
  v_dni text := public.legajo_dni_normalizado(p_texto);
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  if char_length(v_t) < 3 then
    return '[]'::jsonb;
  end if;
  if v_dni is not null and char_length(v_dni) < 6 then
    v_dni := null;
  end if;
  return (
    select coalesce(jsonb_agg(x.id), '[]'::jsonb)
    from (
      select p.id from public.legajo_historico_propuestas p
      left join public.usuarios s on s.id = coalesce(p.empleado_id, p.empleado_id_sugerido)
      where lower(p.ruta_origen) like '%' || v_t || '%'
         or lower(coalesce(s.apellido, '') || ' ' || coalesce(s.nombre, '')) like '%' || v_t || '%'
         or lower(coalesce(s.legajo, '')) = v_t
         or (v_dni is not null and (p.dni_sugerido = v_dni or public.legajo_dni_normalizado(s.dni) = v_dni))
      order by p.creado_at
      limit 500
    ) x
  );
end;
$fn$;

revoke all on function public.legajo_historico_buscar(text) from public, anon;
grant execute on function public.legajo_historico_buscar(text) to authenticated;

-- Pista para la matriz: mejor referencia histórica por persona y categoría.
--   confirmada            aceptada o copiada al legajo
--   asociacion_pendiente  pendiente con persona sugerida
--   localizada            con conflicto, pero el DNI leído es de UNA sola persona
create or replace function public.legajo_historico_matriz()
returns table (empleado_id uuid, tipo text, nivel text, referencias integer)
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
  return query
  with dnis as (
    select public.legajo_dni_normalizado(u.dni) dni, (array_agg(u.id))[1] id, count(*) n
    from public.usuarios u where public.legajo_dni_normalizado(u.dni) is not null
    group by 1
  ),
  r as (
    select coalesce(p.empleado_id, p.empleado_id_sugerido,
                    case when p.estado = 'conflicto' and d.n = 1 then d.id end) emp,
           coalesce(p.tipo, p.tipo_sugerido) tip,
           case when p.estado in ('aceptada','importada') then 3 when p.estado = 'pendiente' then 2 else 1 end rango
    from public.legajo_historico_propuestas p
    left join dnis d on d.dni = p.dni_sugerido
    where p.estado in ('pendiente','conflicto','aceptada','importada')
  )
  select r.emp, r.tip,
         (array['localizada','asociacion_pendiente','confirmada'])[max(r.rango)],
         count(*)::integer
  from r
  join public.documentacion_tipos t on t.codigo = r.tip
  where r.emp is not null and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
  group by r.emp, r.tip;
end;
$fn$;

revoke all on function public.legajo_historico_matriz() from public, anon;
grant execute on function public.legajo_historico_matriz() to authenticated;

notify pgrst, 'reload schema';

commit;
