-- ============================================================================
-- RONDAS · listar_ronda_alertas_objetivo — se amplía a todo el alcance
-- ============================================================================
--
-- POR QUÉ AMPLIAR Y NO CREAR UNA RPC NUEVA
--
-- El supervisor tenía que entrar objetivo por objetivo para descubrir qué ronda
-- se incumplió, porque TODAS las lecturas de rondas exigen `p_objetivo_id`. La
-- necesidad nueva —ver los pendientes de todos sus objetivos de una— es la misma
-- consulta con el filtro relajado, no otra consulta: mismo payload, misma
-- autorización, mismo orden. Crear una segunda función habría dejado dos
-- definiciones del mismo listado para mantener en paralelo.
--
-- `p_objetivo_id` pasa a ser NULLABLE:
--   · no nulo → un objetivo, comportamiento idéntico al actual
--   · NULL    → todos los objetivos sobre los que el usuario tiene alcance,
--               excluyendo `objetivos.es_prueba` (regla de
--               20260717_objetivos_es_prueba.sql: los datos de prueba no salen
--               en vistas agregadas)
--
-- Retrocompatible: mismo nombre, mismos nombres y tipos de parámetros, misma
-- aridad. Las llamadas existentes (`RondaAlertasPanel` pasa siempre un objetivo)
-- no cambian de comportamiento.
--
-- Se agrega `objetivo_nombre` al payload —imprescindible cuando las alertas de
-- varios objetivos van mezcladas— y se ordena por vencimiento: lo más atrasado
-- primero, que es el orden en que hay que atender.
--
-- La autorización sigue viviendo en `puede_administrar_rondas_objetivo()`, sin
-- duplicar la regla de zonas: el alcance se arma aplicando esa misma función
-- sobre `objetivos`.
--
-- NO se crea ninguna RPC de resumen/KPI: los indicadores del panel principal
-- (rondas pendientes, incumplidas, objetivos afectados) se derivan en el cliente
-- de este mismo listado, sin una segunda fuente de verdad que pueda discrepar.

begin;

-- Soporta el filtrado por estado sobre el alcance completo.
create index if not exists idx_ronda_alertas_estado_objetivo
  on public.ronda_alertas (estado, objetivo_id, vencimiento_at desc);

-- Se recrea con DROP + CREATE, no con CREATE OR REPLACE: la firma cambia
-- (p_objetivo_id pasa a tener default) y así no se depende de la semántica de
-- reemplazo de defaults. Nada en la base depende de esta función —solo la llama
-- el cliente—, y los grants se rehacen abajo. Todo dentro de la transacción.
drop function if exists public.listar_ronda_alertas_objetivo(uuid, text);

create function public.listar_ronda_alertas_objetivo(
  p_objetivo_id uuid default null,      -- NULL = todo el alcance del usuario
  p_estado      text default null       -- NULL = todas; 'pendiente' | 'resuelta'
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

  -- Objetivo explícito: se valida el permiso sobre ese objetivo, como siempre.
  if p_objetivo_id is not null
     and not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
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
          'objetivo_nombre', ob.nombre,
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
        -- Lo más vencido primero: es el orden en que hay que atenderlas.
        order by a.vencimiento_at asc, a.detectada_at desc
      )
      from public.ronda_alertas a
      join public.rondas_base rb on rb.id = a.ronda_base_id
      join public.puestos    pu on pu.id = a.puesto_id
      join public.objetivos  ob on ob.id = a.objetivo_id
      join public.usuarios    g on  g.id = a.guardia_id
      left join public.usuarios rp on rp.id = a.resuelta_por
      where (p_estado is null or a.estado = p_estado)
        and (
          case
            when p_objetivo_id is not null then a.objetivo_id = p_objetivo_id
            -- Alcance completo: solo objetivos autorizados y nunca de prueba.
            else ob.es_prueba = false
                 and public.puede_administrar_rondas_objetivo(a.objetivo_id)
          end
        )
    ), jsonb_build_array())
  );
end;
$$;

comment on function public.listar_ronda_alertas_objetivo(uuid, text) is
  'Alertas de rondas. p_objetivo_id NULL = todo el alcance del usuario '
  '(excluye objetivos es_prueba); no nulo = ese objetivo. Ordena por vencimiento.';

revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from public;
revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from anon;
grant execute on function public.listar_ronda_alertas_objetivo(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
