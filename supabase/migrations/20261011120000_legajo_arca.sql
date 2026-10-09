-- Corroboración ARCA dentro del Legajo Digital.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
--   * legajo_arca_de_empleado(p_empleado_id): lo registrado en MERCOSUR (CUIL,
--     nombre, apellido) junto a la última foto del Padrón A13
--     (afip_padron_snapshot) y las últimas consultas individuales de esa
--     persona (afip_corroboracion_corrida con detalle.tipo = 'individual').
--     Sólo lectura. Misma regla que el legajo: legajo_puede_gestionar()
--     (puesto Administración/Gerencia o delegación de Gerencia). Supervisión y
--     Dirección Operativa no acceden aunque tengan gestionar_personal.
--   * La corrida DIARIA se retira aparte (20261011120100), recién cuando la
--     corroboración individual esté probada con una sesión real.
--
-- No modifica usuarios ni el legajo.
--
-- Rollback: supabase/rollback/20261011120000_legajo_arca_rollback.sql

begin;

create or replace function public.legajo_arca_de_empleado(p_empleado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if not public.legajo_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'registrado', jsonb_build_object('cuil', u.cuil, 'nombre', u.nombre, 'apellido', u.apellido),
      'arca', (select jsonb_build_object(
                 'cuil', s.cuil, 'existe', s.existe, 'estado', s.estado_clave, 'tipo_persona', s.tipo_persona,
                 'nombre', s.nombre, 'apellido', s.apellido, 'direccion', s.direccion, 'localidad', s.localidad,
                 'cod_postal', s.cod_postal, 'provincia', s.provincia, 'novedades', to_jsonb(s.novedades),
                 'error', s.error, 'consultado_at', s.consultado_at)
               from public.afip_padron_snapshot s where s.usuario_id = u.id),
      'consultas', (select coalesce(jsonb_agg(jsonb_build_object(
                      'at', c.iniciada_at, 'ok', c.ok, 'origen', c.detalle->>'origen',
                      'quien', nullif(btrim(coalesce(q.nombre, '') || ' ' || coalesce(q.apellido, '')), ''))
                      order by c.iniciada_at desc), '[]'::jsonb)
                    from (select * from public.afip_corroboracion_corrida c
                          where c.detalle->>'tipo' = 'individual' and c.detalle->>'usuario_id' = u.id::text
                          order by c.iniciada_at desc limit 5) c
                    left join public.usuarios q on q.id::text = c.detalle->>'solicitado_por')
    )
    from public.usuarios u where u.id = p_empleado_id
  );
end;
$fn$;

revoke all on function public.legajo_arca_de_empleado(uuid) from public, anon;
grant execute on function public.legajo_arca_de_empleado(uuid) to authenticated;

-- Para buscar rápido las consultas individuales de una persona.
create index if not exists ix_afip_corrida_individual
  on public.afip_corroboracion_corrida ((detalle->>'usuario_id'), iniciada_at desc)
  where detalle->>'tipo' = 'individual';

notify pgrst, 'reload schema';

commit;
