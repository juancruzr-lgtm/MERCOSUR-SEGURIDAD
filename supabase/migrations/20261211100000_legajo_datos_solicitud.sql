-- ============================================================================
-- Legajo: datos de la SOLICITUD DE EMPLEO (pedido de JC, 11/11/2026)
-- ============================================================================
-- PROBLEMA: lo que la solicitud trae además de los datos del alta (estado civil,
-- hijos y edades, estudios, si conduce, movilidad, horario, trabajos anteriores,
-- cursos, talles, DNI en buen estado, observaciones de la entrevista) quedaba
-- guardado sólo en la postulación y no se veía desde el legajo del empleado.
--
-- QUÉ HACE (sólo lectura; NO copia ni modifica datos):
--   public.legajo_datos_solicitud(p_empleado_id) devuelve, para el empleado que
--   ingresó por Postulantes, los datos de su solicitud y las páginas de la foto
--   original. Los datos siguen viviendo en public.postulaciones (una sola copia,
--   el historial queda donde está).
--
-- QUIÉN: sólo Administración y Gerencia (legajo_puede_gestionar). Para
-- cualquier otro devuelve null: ni el propio empleado ni supervisores.
-- La foto se sigue abriendo por /api/postulaciones/archivo, que vuelve a
-- autorizar y registra cada apertura.
--
-- Rollback: supabase/rollback/20261211100000_legajo_datos_solicitud_rollback.sql
-- ============================================================================

begin;

create or replace function public.legajo_datos_solicitud(p_empleado_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when not coalesce(public.legajo_puede_gestionar(), false) then null else (
    select jsonb_build_object(
      'postulacion_id', p.id,
      'fecha_entrevista', p.fecha_entrevista,
      'alta_at', p.alta_at,
      'datos', coalesce(p.datos_seleccion, '{}'::jsonb),
      'observaciones', p.observaciones,
      'archivos', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'orden', a.orden, 'mime', a.mime) order by a.orden)
          from public.postulacion_archivos a
         where a.postulacion_id = p.id), '[]'::jsonb))
      from public.postulaciones p
     where p.usuario_id = p_empleado_id
       and p.estado = 'alta_efectiva'
     order by p.alta_at desc nulls last
     limit 1)
  end
$$;

revoke all on function public.legajo_datos_solicitud(uuid) from public, anon;
grant execute on function public.legajo_datos_solicitud(uuid) to authenticated;

comment on function public.legajo_datos_solicitud(uuid) is
  'Datos de la solicitud de empleo de un empleado que ingresó por Postulantes. Sólo Administración/Gerencia (20261211100000).';

commit;
