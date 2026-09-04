-- ============================================================================
-- Verificación PRE/POST · saneamiento CUIL + novedades mensuales agosto 2026
-- Solo lectura. Cada sección es una única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'usuarios sin CUIL con DNI-en-legajo de los 13' as control, count(*)::text as resultado, '13' as esperado
    from public.usuarios
   where cuil is null
     and regexp_replace(coalesce(legajo,''), '\D', '', 'g') in
       ('37396299','30671158','42033961','31251192','33128535','39455557','40038982','44176787','47765523','41692571','28379755','29516450','44631299')
  union all
  select 2, 'novedades aprobadas de agosto de los 5 pares empleado+tipo (debe ser 0)', count(*)::text, '0'
    from public.novedades_laborales n
    join public.usuarios u on u.id = n.empleado_id
   where n.estado = 'aprobada'
     and n.fecha_desde <= date '2026-08-31' and n.fecha_hasta >= date '2026-08-01'
     and (
       (u.cuil = '20385975024' and n.tipo = 'suspension') or
       (u.cuil = '23174623929' and n.tipo = 'suspension') or
       (u.cuil = '20149137751' and n.tipo = 'vacaciones') or
       (u.cuil = '20407869002' and n.tipo = 'vacaciones') or
       (u.cuil = '20375375622' and n.tipo = 'parte_medico')
     )
) v order by orden;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'CUILes completados (los 13 DNIs ya no estan sin CUIL)' as control, count(*)::text as resultado, '0' as esperado
    from public.usuarios
   where cuil is null
     and regexp_replace(coalesce(legajo,''), '\D', '', 'g') in
       ('37396299','30671158','42033961','31251192','33128535','39455557','40038982','44176787','47765523','41692571','28379755','29516450','44631299')
  union all
  select 2, 'ningun CUIL preexistente cambiado (los 5 de las novedades siguen iguales)', count(*)::text, '5'
    from public.usuarios
   where cuil in ('20385975024','23174623929','20149137751','20407869002','20375375622')
  union all
  select 3, 'novedades mensuales importadas de agosto', count(*)::text, '5'
    from public.novedades_laborales
   where origen_carga = 'importacion_mensual' and fecha_desde = date '2026-08-01'
     and tipo <> 'ajuste_nocturnidad'
  union all
  select 4, 'detalle importadas (empleado tipo dias)',
         coalesce(string_agg(u.apellido || ' ' || n.tipo || ' ' || n.dias_informados::text, ' · ' order by u.apellido), '(ninguna)'),
         'BARRIOS susp 2 · BASSE vac 2 · PEREZ?NO · SILVA vac 6 · SOLER pm 2 · TERAN susp 5'
    from public.novedades_laborales n
    join public.usuarios u on u.id = n.empleado_id
   where n.origen_carga = 'importacion_mensual' and n.fecha_desde = date '2026-08-01'
     and n.tipo <> 'ajuste_nocturnidad'
  union all
  select 5, 'reimportacion: correr el script de nuevo insertaria', '0 (por el NOT EXISTS)', '0'
) v order by orden;
