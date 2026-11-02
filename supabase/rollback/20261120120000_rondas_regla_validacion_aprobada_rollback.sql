-- Rollback de 20261120120000_rondas_regla_validacion_aprobada.sql
--
-- Vuelve a la regla anterior (controles juzgados por separado, con Y lógico):
--  1. Re-juzga con la regla anterior los puntos que la nueva regla tocó
--     (validado_por no nulo o estado 'pendiente_validacion'):
--       incumplido si GPS requerido y no dentro del radio, o QR obligatorio con
--       credencial activa y sin verificar; si no, cumplido.
--  2. Recalcula el resultado de esas rondas finalizadas (completa / incompleta).
--  3. Restaura registrar_punto_ronda, ia_registrar_revision y
--     listar_rondas_programadas_objetivo a la definición viva del 02/11/2026,
--     borra las funciones nuevas, los CHECK y las columnas validado_por/_at.
-- Los análisis de IA y las revisiones humanas no se tocan.

begin;

with afectados as (
  select ep.id, ep.ronda_ejecucion_id,
         case
           when (ep.snap_gps_requerido and ep.dentro_radio is distinct from true)
             or (ep.snap_qr_modo = 'obligatorio'
                 and ep.qr_verificado_at is null
                 and exists (select 1 from public.ronda_punto_qr q
                              where q.ronda_punto_id = ep.ronda_punto_id and q.activo))
           then 'incumplido' else 'cumplido'
         end as estado_anterior_regla
    from public.ronda_ejecucion_puntos ep
   where ep.estado = 'pendiente_validacion'
      or ep.validado_por is not null
), upd as (
  update public.ronda_ejecucion_puntos ep
     set estado = a.estado_anterior_regla,
         validado_por = null,
         validado_at  = null
    from afectados a
   where ep.id = a.id
  returning ep.ronda_ejecucion_id
)
update public.ronda_ejecuciones e
   set resultado = case
                     when e.cerrada_por is not null then 'incompleta'
                     when (select bool_and(p.estado = 'cumplido') from public.ronda_ejecucion_puntos p
                            where p.ronda_ejecucion_id = e.id) then 'completa'
                     else 'incompleta'
                   end
 where e.estado = 'finalizada'
   and (e.id in (select ronda_ejecucion_id from upd) or e.resultado = 'pendiente_validacion');

drop function if exists public.reevaluar_puntos_ronda_pendientes(timestamptz, integer);
drop function if exists public.reevaluar_punto_ronda(uuid);

-- registrar_punto_ronda: definición viva (= 20260905100000).
create or replace function public.registrar_punto_ronda(
  p_ejecucion_punto_id uuid,
  p_latitud            double precision default null,
  p_longitud           double precision default null,
  p_precision_metros   double precision default null,
  p_hay_novedad        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  v_ctx                  record;
  v_ejecucion_id         uuid;
  v_ejecucion_estado     text;
  v_punto_estado         text;
  v_punto_orden          integer;
  v_snap_latitud         double precision;
  v_snap_longitud        double precision;
  v_snap_radio_metros    integer;
  v_politica_foto        text;
  v_gps_requerido        boolean;
  v_primero_pendiente_id uuid;
  v_novedad              boolean := coalesce(p_hay_novedad, false);
  v_foto_obligatoria     boolean;
  v_foto_presente        boolean;
  v_tiene_gps            boolean;
  v_gps_ok               boolean;
  v_dentro_radio         boolean;
  v_foto_ok              boolean;
  v_distancia_metros     double precision;
  v_estado_nuevo         text := 'cumplido';
  v_pendientes           integer;
  v_todos_cumplidos      boolean;
  -- [QR]
  v_ronda_punto_id       uuid;
  v_qr_modo              text;
  v_qr_verificado_at     timestamptz;
  v_qr_exigible          boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  if p_ejecucion_punto_id is null then
    return jsonb_build_object(
      'contexto', 'punto_no_disponible',
      'punto', null,
      'ejecucion', null
    );
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object(
      'contexto', 'sin_turno_vigente',
      'punto', null,
      'ejecucion', null
    );
  end if;

  -- Bloquea ejecución y punto para serializar doble toque y llamadas paralelas.
  select
    e.id,
    e.estado,
    ep.estado,
    ep.orden,
    ep.snap_latitud,
    ep.snap_longitud,
    ep.snap_radio_metros,
    ep.snap_politica_foto,
    ep.snap_gps_requerido,
    ep.ronda_punto_id,          -- [QR] resuelve la credencial activa del punto
    ep.snap_qr_modo,            -- [QR]
    ep.qr_verificado_at         -- [QR]
  into
    v_ejecucion_id,
    v_ejecucion_estado,
    v_punto_estado,
    v_punto_orden,
    v_snap_latitud,
    v_snap_longitud,
    v_snap_radio_metros,
    v_politica_foto,
    v_gps_requerido,
    v_ronda_punto_id,
    v_qr_modo,
    v_qr_verificado_at
  from public.ronda_ejecucion_puntos ep
  join public.ronda_ejecuciones e on e.id = ep.ronda_ejecucion_id
  where ep.id          = p_ejecucion_punto_id
    and e.turno_id     = v_ctx.turno_id
    and e.guardia_id   = v_ctx.usuario_id
  for update of e, ep;

  if v_ejecucion_id is null then
    return jsonb_build_object(
      'contexto', 'punto_no_disponible',
      'punto', null,
      'ejecucion', null
    );
  end if;

  -- Reintento luego de una respuesta perdida: no vuelve a escribir.
  if v_punto_estado <> 'pendiente' then
    return jsonb_build_object(
      'contexto', 'ya_registrado',
      'punto', jsonb_build_object(
        'ejecucion_punto_id', p_ejecucion_punto_id,
        'estado', v_punto_estado
      ),
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  if v_ejecucion_estado <> 'en_curso' then
    return jsonb_build_object(
      'contexto', 'ejecucion_cerrada',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  select ep.id
    into v_primero_pendiente_id
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion_id
     and ep.estado = 'pendiente'
   order by ep.orden
   limit 1;

  if v_primero_pendiente_id is distinct from p_ejecucion_punto_id then
    return jsonb_build_object(
      'contexto', 'fuera_de_secuencia',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Coordenadas completas o ninguna.
  if (p_latitud is null) <> (p_longitud is null)
     or (p_latitud is not null and (p_latitud < -90 or p_latitud > 90))
     or (p_longitud is not null and (p_longitud < -180 or p_longitud > 180))
     or (p_precision_metros is not null and p_precision_metros < 0)
     or (p_precision_metros is not null and p_latitud is null) then
    return jsonb_build_object(
      'contexto', 'gps_invalido',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Una configuración histórica inválida nunca se interpreta como cumplimiento
  -- ni se consume: se devuelve un contexto estable y no se modifica el punto.
  if v_gps_requerido
     and (
       v_snap_latitud is null
       or v_snap_longitud is null
       or v_snap_radio_metros is null
     ) then
    return jsonb_build_object(
      'contexto', 'configuracion_gps_invalida',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- La política del SNAPSHOT decide, no la configuración actual del punto.
  v_foto_obligatoria := (v_politica_foto = 'obligatoria')
                        or (v_politica_foto = 'solo_novedad' and v_novedad);

  -- La foto se busca siempre: con política `opcional` el vigilador puede
  -- haberla sacado igual, y esa evidencia se registra como cumplida.
  select exists (
    select 1
      from public.evidencias ev
      join storage.objects so
        on so.bucket_id = ev.bucket
       and so.name      = ev.storage_path
     where ev.proceso_tipo   = 'ronda'
       and ev.proceso_id     = p_ejecucion_punto_id
       and ev.tipo_evidencia = 'punto_control'
       and ev.bucket         = 'ronda-evidencias'
  ) into v_foto_presente;

  if v_foto_obligatoria and not v_foto_presente then
    return jsonb_build_object(
      'contexto', 'foto_pendiente',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- null = no correspondía exigirla y no se sacó. Mismo criterio que gps_ok.
  v_foto_ok := case when v_foto_presente then true else null end;

  v_tiene_gps := p_latitud is not null;
  v_gps_ok    := case when v_gps_requerido then v_tiene_gps else null end;

  if v_tiene_gps
     and v_snap_latitud is not null
     and v_snap_longitud is not null then
    v_distancia_metros := public.rondas_distancia_metros(
      p_latitud,
      p_longitud,
      v_snap_latitud,
      v_snap_longitud
    );

    if v_snap_radio_metros is not null then
      v_dentro_radio := v_distancia_metros <= v_snap_radio_metros;
    end if;
  end if;

  -- Para GPS obligatorio sólo `dentro_radio = true` permite cumplimiento.
  -- precision_metros conserva su contrato actual: se valida y almacena, pero no
  -- participa del veredicto.
  if v_gps_requerido
     and (
       not v_tiene_gps
       or v_dentro_radio is distinct from true
     ) then
    v_estado_nuevo := 'incumplido';
  end if;

  -- [QR] La exigencia sólo aplica con modo 'obligatorio' del snapshot Y una
  -- credencial activa existente (regla de no-bloqueo: no se puede exigir
  -- escanear un cartel que no existe). Un QR verificado con GPS malo NO revierte
  -- el veredicto GPS: los controles se juzgan cada uno por su lado y los hechos
  -- quedan todos registrados.
  v_qr_exigible := v_qr_modo = 'obligatorio'
    and exists (
      select 1 from public.ronda_punto_qr q
       where q.ronda_punto_id = v_ronda_punto_id
         and q.activo
    );

  if v_qr_exigible and v_qr_verificado_at is null then
    v_estado_nuevo := 'incumplido';
  end if;

  update public.ronda_ejecucion_puntos
     set registrado_at    = now(),
         latitud          = p_latitud,
         longitud         = p_longitud,
         precision_metros = p_precision_metros,
         distancia_metros = v_distancia_metros,
         gps_ok            = v_gps_ok,
         dentro_radio      = v_dentro_radio,
         foto_ok           = v_foto_ok,
         hay_novedad       = v_novedad,
         estado            = v_estado_nuevo
   where id = p_ejecucion_punto_id
     and estado = 'pendiente';

  select count(*)
    into v_pendientes
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion_id
     and ep.estado = 'pendiente';

  if v_pendientes = 0 then
    select bool_and(ep.estado = 'cumplido')
      into v_todos_cumplidos
      from public.ronda_ejecucion_puntos ep
     where ep.ronda_ejecucion_id = v_ejecucion_id;

    update public.ronda_ejecuciones
       set estado        = 'finalizada',
           resultado     = case when v_todos_cumplidos then 'completa' else 'incompleta' end,
           finalizada_at = now()
     where id = v_ejecucion_id
       and estado = 'en_curso';
  end if;

  return jsonb_build_object(
    'contexto', 'registrado',
    'punto', jsonb_build_object(
      'ejecucion_punto_id', p_ejecucion_punto_id,
      'orden',              v_punto_orden,
      'estado',             v_estado_nuevo,
      'gps_ok',             v_gps_ok,
      'dentro_radio',       v_dentro_radio,
      'foto_ok',            v_foto_ok,
      'hay_novedad',        v_novedad,
      'politica_foto',      v_politica_foto,
      'distancia_metros',   v_distancia_metros,
      'qr_modo',            v_qr_modo,
      'qr_verificado',      (v_qr_verificado_at is not null),
      'qr_exigible',        v_qr_exigible
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;


-- ia_registrar_revision: definición viva del 02/11/2026.
create or replace function public.ia_registrar_revision(
  p_analisis_id uuid,
  p_decision    text,
  p_comentario  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario_id uuid;
  v_analisis   record;
  v_anterior   text;
  v_comentario text;
begin
  if p_decision is null or p_decision not in ('CORRECTO', 'INCORRECTO') then
    raise exception 'Decisión inválida: %', coalesce(p_decision, '(null)');
  end if;

  v_usuario_id := public.rondas_usuario_actual_id();
  if v_usuario_id is null then
    raise exception 'Sesión no válida';
  end if;

  select ea.id, ea.objetivo_id, ea.revision_estado, ea.estado
    into v_analisis
    from public.evidencia_analisis ea
   where ea.id = p_analisis_id
     for update;

  if not found then
    raise exception 'Análisis inexistente';
  end if;

  if not public.puede_administrar_rondas_objetivo(v_analisis.objetivo_id) then
    raise exception 'Sin alcance sobre el objetivo de esta evidencia';
  end if;

  if v_analisis.estado <> 'completado' then
    raise exception 'El análisis no está completado (estado actual: %)', v_analisis.estado;
  end if;

  v_anterior   := v_analisis.revision_estado;
  v_comentario := nullif(btrim(coalesce(p_comentario, '')), '');

  insert into public.evidencia_analisis_revisiones (
    analisis_id, usuario_id, decision, comentario, estado_anterior, estado_nuevo
  ) values (
    p_analisis_id, v_usuario_id, p_decision, v_comentario, v_anterior, p_decision
  );

  -- Sólo columnas de revisión. resultado_json, clasificacion_ia, motivos y
  -- resumen quedan intactos: es el requisito central del pedido.
  update public.evidencia_analisis
     set revision_estado     = p_decision,
         revisado_por        = v_usuario_id,
         revisado_at         = now(),
         revision_comentario = v_comentario
   where id = p_analisis_id;

  return jsonb_build_object(
    'ok',              true,
    'analisis_id',     p_analisis_id,
    'estado_anterior', v_anterior,
    'estado_nuevo',    p_decision,
    'revisado_por',    v_usuario_id
  );
end;
$fn$;

-- listar_rondas_programadas_objetivo: definición viva del 02/11/2026.
create or replace function public.listar_rondas_programadas_objetivo(
  p_objetivo_id uuid,
  p_desde       date,
  p_hasta       date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

  if p_objetivo_id is null or p_desde is null or p_hasta is null or p_desde > p_hasta then
    return jsonb_build_object('contexto', 'rango_invalido', 'rondas', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'rondas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'rondas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ronda_base_id',   v.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'puesto_id',       v.puesto_id,
          'puesto_nombre',   pu.nombre,
          'turno_id',        v.turno_id,
          'guardia_id',      v.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ventana_inicio',  v.ventana_inicio,
          'ventana_fin',     v.ventana_fin,
          'vencimiento_at',  v.vencimiento_at,

          'estado',
            case
              when e.id is not null and e.estado = 'en_curso'    then 'en_curso'
              when e.id is not null and e.resultado = 'completa' then 'completada'
              when e.id is not null                              then 'incompleta'
              -- Solo una pausa VIGENTE define el estado operativo. Una pausa ya
              -- reanudada sigue registrada en los campos pausa_* de abajo.
              when pa.id is not null and pa.vigente              then 'pausada'
              when now() < v.vencimiento_at                      then 'pendiente'
              else                                                    'no_iniciada'
            end,
          'inicio_tardio',
            (e.id is not null and e.iniciada_at >= v.vencimiento_at),

          'ejecucion_id',       e.id,
          'iniciada_at',        e.iniciada_at,
          'finalizada_at',      e.finalizada_at,
          'resultado',          e.resultado,
          'puntos_total',       e.puntos_total,
          'puntos_cumplidos',   coalesce(cnt.cumplidos,   0),
          'puntos_incumplidos', coalesce(cnt.incumplidos, 0),
          'puntos_omitidos',    coalesce(cnt.omitidos,    0),
          'cerrada_por',        e.cerrada_por,
          'cerrada_at',         e.cerrada_at,
          'cerrada_motivo',     e.cerrada_motivo,
          'es_cierre_administrativo', (e.cerrada_por is not null),

          'alerta_id',              al.id,
          'alerta_tipo',            al.tipo,
          'alerta_estado',          al.estado,
          'alerta_suspendida',      (al.tipo = 'suspendida'),
          'alerta_motivo_vigilador',al.motivo_vigilador,
          'alerta_accion',          al.accion,
          'alerta_comentario',      al.comentario,
          'alerta_resuelta_por_nombre',
            case when al.resuelta_por is null then null
                 else rp.apellido || ', ' || rp.nombre end,
          'alerta_resuelta_at',     al.resuelta_at,
          'alerta_intervenciones',  coalesce(iv.total, 0),

          -- Anexo de pausa. NO condiciona estados previos; solo informa.
          -- `pausada` es historial: esta ventana estuvo cubierta por una pausa.
          -- `pausa_vigente` es operativo: esa pausa sigue activa ahora.
          'pausada',              (pa.id is not null),
          'pausa_vigente',        coalesce(pa.vigente, false),
          'pausa_id',             pa.id,
          'pausa_motivo',         pa.motivo,
          'pausa_desde',          pa.pausada_at,
          'pausa_hasta',          pa.hasta_at,
          'pausada_por_nombre',   pa.pausada_por_nombre
        )
        order by v.ventana_inicio desc
      )
      from public.rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta) v
      join public.rondas_base rb on rb.id = v.ronda_base_id
      join public.puestos     pu on pu.id = v.puesto_id
      join public.usuarios     g on  g.id = v.guardia_id

      left join lateral (
        select ex.*
        from public.ronda_ejecuciones ex
        where ex.ronda_base_id = v.ronda_base_id
          and ex.turno_id      = v.turno_id
          and ex.estado in ('en_curso', 'finalizada')
          and ex.iniciada_at  >= v.ventana_inicio
          and ex.iniciada_at  <  v.match_fin
        order by ex.iniciada_at asc
        limit 1
      ) e on true

      left join lateral (
        select
          count(*) filter (where ep.estado = 'cumplido')   as cumplidos,
          count(*) filter (where ep.estado = 'incumplido') as incumplidos,
          count(*) filter (where ep.estado = 'omitido')    as omitidos
        from public.ronda_ejecucion_puntos ep
        where ep.ronda_ejecucion_id = e.id
      ) cnt on true

      left join lateral (
        select a.*
        from public.ronda_alertas a
        where a.ronda_base_id = v.ronda_base_id
          and a.turno_id      = v.turno_id
          and (a.tipo = 'suspendida' or a.ventana_inicio = v.ventana_inicio)
        order by (a.tipo = 'suspendida') desc, a.detectada_at desc
        limit 1
      ) al on true

      left join public.usuarios rp on rp.id = al.resuelta_por
      left join lateral (
        select count(*) as total
        from public.ronda_alerta_intervenciones i
        where i.ronda_alerta_id = al.id
      ) iv on true

      -- Pausa que cubre esta ventana. Mismo criterio temporal que el evaluador:
      -- las tres ramas se mantienen para no perder el historial. Lo que se
      -- agrega es `vigente`, que distingue la pausa todavia en curso de la ya
      -- reanudada. Misma expresion que el campo homonimo de
      -- listar_rondas_pausadas: si cambia una, tiene que cambiar la otra.
      left join lateral (
        select px.*,
               (px.activa and (px.hasta_at is null or px.hasta_at > now())) as vigente,
               upx.apellido || ', ' || upx.nombre as pausada_por_nombre
        from public.ronda_pausas px
        join public.usuarios upx on upx.id = px.pausada_por
        where px.ronda_base_id = v.ronda_base_id
          and px.pausada_at <= v.ventana_inicio
          and (
            (px.activa = true and px.hasta_at is null)
            or (px.activa = true and px.hasta_at is not null and v.ventana_inicio < px.hasta_at)
            or (px.activa = false and px.reactivada_at is not null and v.ventana_inicio < px.reactivada_at)
          )
        order by px.pausada_at desc
        limit 1
      ) pa on true
    ), jsonb_build_array())
  );
end;
$fn$;

drop function if exists public.rondas_resultado_ejecucion(uuid);
drop function if exists public.rondas_veredicto_punto(boolean, boolean, boolean, text);
drop function if exists public.rondas_estado_foto_punto(uuid);

drop index if exists public.idx_ronda_ejecucion_puntos_revalidables;

alter table public.ronda_ejecucion_puntos drop constraint if exists ronda_ejecucion_puntos_validado_por_coherente;
alter table public.ronda_ejecucion_puntos drop constraint if exists ronda_ejecucion_puntos_validado_por_valido;
alter table public.ronda_ejecucion_puntos drop constraint if exists ronda_ejecucion_puntos_estado_valido;
alter table public.ronda_ejecucion_puntos
  add constraint ronda_ejecucion_puntos_estado_valido
  check (estado in ('pendiente', 'cumplido', 'incumplido', 'omitido'));
alter table public.ronda_ejecuciones drop constraint if exists ronda_ejecuciones_resultado_valido;
alter table public.ronda_ejecuciones
  add constraint ronda_ejecuciones_resultado_valido
  check (resultado is null or resultado in ('completa', 'incompleta'));

alter table public.ronda_ejecucion_puntos
  drop column if exists validado_por,
  drop column if exists validado_at;

notify pgrst, 'reload schema';

commit;
