-- Archivo histórico en el legajo individual: cuántas referencias de MEGA tiene
-- cada persona, separadas por situación, y búsqueda de la bandeja por persona.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
--   * legajo_historico_resumen_empleado(p_empleado_id): para Documentación del
--     legajo individual (sólo Administración/Gerencia):
--       pendientes   detectadas, con la persona sugerida, sin revisar
--       conflictos   con conflicto, cuyo DNI leído es el de ESTA persona (y de
--                    nadie más): detectadas pero sin persona asociada
--       asociadas    aceptadas por Administración: referencia sin validar
--       copiadas     copiadas al legajo (siguen en revisión en Documentación)
--     Ninguna cuenta para el cumplimiento: eso sólo lo dan los documentos
--     validados en Documentación.
--   * legajo_historico_buscar: si el texto es el id de una persona, devuelve
--     sus referencias (las mismas del resumen). Así el legajo enlaza a la
--     bandeja sin poner nombre ni DNI en la dirección.
--   * Corrección de 4 categorías sugeridas que contradicen el nombre del
--     archivo (p. ej. una solicitud de empleo sugerida como «Embargos»): quedan
--     SIN categoría para que una persona la elija al revisar. No se acepta ni
--     se descarta nada; cada cambio queda en el historial de la referencia.
--
-- Rollback: supabase/rollback/20261012120000_legajo_historico_por_empleado_rollback.sql

begin;

create or replace function public.legajo_historico_resumen_empleado(p_empleado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_dni text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_dni := public.legajo_dni_normalizado((select u.dni from public.usuarios u where u.id = p_empleado_id));
  if v_dni is not null and (select count(*) from public.usuarios o where public.legajo_dni_normalizado(o.dni) = v_dni) <> 1 then
    v_dni := null;  -- DNI repetido en la app: no se atribuye a nadie
  end if;
  return (
    select jsonb_build_object(
      'pendientes', count(*) filter (where p.estado = 'pendiente' and coalesce(p.empleado_id, p.empleado_id_sugerido) = p_empleado_id),
      'conflictos', count(*) filter (where p.estado = 'conflicto' and v_dni is not null and p.dni_sugerido = v_dni),
      'asociadas',  count(*) filter (where p.estado = 'aceptada' and p.empleado_id = p_empleado_id),
      'copiadas',   count(*) filter (where p.estado = 'importada' and p.empleado_id = p_empleado_id)
    )
    from public.legajo_historico_propuestas p
    where coalesce(p.empleado_id, p.empleado_id_sugerido) = p_empleado_id
       or (p.estado = 'conflicto' and v_dni is not null and p.dni_sugerido = v_dni)
  );
end;
$fn$;

revoke all on function public.legajo_historico_resumen_empleado(uuid) from public, anon;
grant execute on function public.legajo_historico_resumen_empleado(uuid) to authenticated;

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
  v_emp uuid;
  v_dni_emp text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  -- Por persona (id): sus referencias y los conflictos con SU DNI (si es único).
  if v_t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_emp := v_t::uuid;
    v_dni_emp := public.legajo_dni_normalizado((select u.dni from public.usuarios u where u.id = v_emp));
    if v_dni_emp is not null and (select count(*) from public.usuarios o where public.legajo_dni_normalizado(o.dni) = v_dni_emp) <> 1 then
      v_dni_emp := null;
    end if;
    return (
      select coalesce(jsonb_agg(x.id), '[]'::jsonb)
      from (
        select p.id from public.legajo_historico_propuestas p
        where coalesce(p.empleado_id, p.empleado_id_sugerido) = v_emp
           or (p.estado = 'conflicto' and v_dni_emp is not null and p.dni_sugerido = v_dni_emp)
        order by p.creado_at
        limit 500
      ) x
    );
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

-- Categorías sugeridas que contradicen el nombre del archivo: sin categoría.
-- Sólo si siguen sin revisar y con la misma sugerencia (idempotente).
with corregir(id, antes) as (values
  ('29a2df65-7694-4888-b03b-f6d929ef4216'::uuid, 'embargos'),            -- es una solicitud de empleo
  ('df7ba560-c6d8-4651-bd13-17a89861a793'::uuid, 'sindicato'),           -- es un recibo de sueldo
  ('5e751c91-a226-42fe-83ce-d50c32114244'::uuid, 'actuaciones_legales'), -- es DNI y CUIL
  ('3e54df1c-e4df-4f75-88a9-e3077833cbb2'::uuid, 'antecedentes_rnr')     -- es una carta documento
),
hechas as (
  update public.legajo_historico_propuestas p
     set tipo_sugerido = null
    from corregir c
   where p.id = c.id and p.tipo_sugerido = c.antes and p.tipo is null and p.estado in ('pendiente','conflicto')
  returning p.id, c.antes
)
insert into public.legajo_historico_eventos (propuesta_id, evento, usuario_id, detalle)
select h.id, 'categoria_corregida', null,
       jsonb_build_object('antes', h.antes, 'despues', null,
                          'motivo', 'La categoría sugerida contradecía el nombre del archivo: queda sin categoría para revisión')
from hechas h;

notify pgrst, 'reload schema';

commit;
