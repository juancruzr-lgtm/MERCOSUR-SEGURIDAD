-- Rollback de 20261012120000: quita el resumen por persona y vuelve la
-- búsqueda a la versión de 20261010130000. Las categorías corregidas NO se
-- revierten solas: el valor anterior está en legajo_historico_eventos
-- (evento 'categoria_corregida', detalle.antes).
begin;
drop function if exists public.legajo_historico_resumen_empleado(uuid);

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

notify pgrst, 'reload schema';
commit;
