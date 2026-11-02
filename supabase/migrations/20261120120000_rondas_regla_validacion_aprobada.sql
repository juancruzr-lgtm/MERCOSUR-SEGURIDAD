-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- Rondas: regla de validación de puntos aprobada por Gerencia (noviembre 2026)
-- ============================================================================
--
-- ── Problema (auditoría de rondas de octubre 2026) ──────────────────────────
-- registrar_punto_ronda juzgaba cada control por separado y con Y lógico: con
-- GPS requerido y fuera de radio el punto quedaba 'incumplido' aunque el QR
-- estuviera verificado; con QR obligatorio sin escanear quedaba 'incumplido'
-- aunque el GPS diera bien. La foto sólo contaba como presencia y el resultado
-- de la IA (lib/ia/procesar.ts) nunca volvía al punto. En octubre: 2.094 puntos
-- incumplidos tenían QR verificado o foto aceptada por la IA.
--
-- ── Regla aprobada ──────────────────────────────────────────────────────────
-- Un punto está CUMPLIDO cuando existe al menos UNA evidencia válida:
--   1. GPS dentro del radio                         → validado_por = 'gps'
--   2. QR verificado (credencial válida)            → validado_por = 'qr'
--   3. Foto aceptada por la IA (SIN_OBSERVACIONES)  → validado_por = 'foto_ia'
--      o aprobada por una persona (CORRECTO)        → validado_por = 'revision'
-- El GPS tiene prioridad pero nunca invalida un QR válido ni una foto aceptada.
-- Una foto todavía sin analizar NO es aceptación ni falla: el punto queda
-- 'pendiente_validacion' hasta que la IA (o una persona) se pronuncie.
--   · IA acepta                       → cumplido
--   · IA rechaza / insuficiente y no hay otra evidencia → incumplido
--   · persona marca CORRECTO          → cumplido (aunque la IA hubiera observado)
--   · persona marca INCORRECTO        → la foto no vale; decide el resto
-- Un punto sin ningún control exigido (sin GPS requerido, sin QR obligatorio
-- con credencial activa, sin foto obligatoria) queda cumplido al registrarse,
-- igual que antes (validado_por NULL).
--
-- ── Representación (lo menos disruptiva compatible con los CHECK) ───────────
--  · ronda_ejecucion_puntos.estado admite 'pendiente_validacion'. Ya está
--    registrado (registrado_at NOT NULL), así que no bloquea la secuencia:
--    todo lo que busca "el próximo punto" mira estado = 'pendiente'.
--  · ronda_ejecucion_puntos.validado_por / validado_at: qué evidencia validó.
--  · ronda_ejecuciones.resultado admite 'pendiente_validacion': la ronda se
--    terminó de recorrer pero algún punto espera la IA. No es 'incompleta'
--    (no se le imputa nada) ni 'completa' (todavía no se sabe).
--      completa             todos los puntos cumplidos
--      incompleta           algún punto incumplido u omitido
--      pendiente_validacion sin incumplidos/omitidos y alguno esperando la IA
--    Quien lea `= 'completa'` o `= 'incompleta'` sigue funcionando: la ronda
--    en espera no cuenta como ninguna de las dos hasta resolverse.
--
-- ── Qué agrega ──────────────────────────────────────────────────────────────
--  · rondas_estado_foto_punto(punto)   veredicto de la foto según análisis.
--  · rondas_veredicto_punto(...)       regla pura (inmutable), sin consultas.
--  · rondas_resultado_ejecucion(ej)    resultado de la ronda desde sus puntos.
--  · reevaluar_punto_ronda(punto)      re-juzga un punto ya registrado y, si la
--    ronda está finalizada, su resultado. Idempotente. La llama el pipeline de
--    IA después de cada análisis de 'punto_control' (service_role) y
--    ia_registrar_revision después de una revisión humana.
--  · reevaluar_puntos_ronda_pendientes(desde, limite)  barrido de respaldo que
--    corre el cron de IA: recupera una re-evaluación perdida (respuesta
--    cortada, saneamiento masivo, etc.).
--  · registrar_punto_ronda con la regla O. Mismo contrato de respuesta; se
--    agregan las claves 'validado_por' y 'pendiente_validacion'.
--  · listar_rondas_programadas_objetivo: estado 'pendiente_validacion' y el
--    contador 'puntos_pendientes_validacion'.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No re-evalúa el historial. El barrido del cron mira sólo los últimos días;
-- recalcular octubre (o antes) es una decisión aparte (ver
-- docs/auditoria-2026-10/regla_validacion.md, «Recalcular historial»).
-- No toca alertas, Mi Desempeño (que se calcula por alertas) ni evaluaciones
-- publicadas. Nunca degrada un punto cumplido por GPS/QR ni uno cumplido con
-- la regla anterior (validado_por NULL).
--
-- Base: definiciones VIVAS de producción leídas con pg_get_functiondef el
-- 02/11/2026 (registrar_punto_ronda, ia_registrar_revision,
-- listar_rondas_programadas_objetivo). Reglas SQL del proyecto: nada de
-- `select col into variable` en código nuevo; se asigna con `v := (select ...)`.
--
-- Rollback: supabase/rollback/20261120120000_rondas_regla_validacion_aprobada_rollback.sql
-- ============================================================================

begin;

-- ============================================================================
-- 1. ESTRUCTURA
-- ============================================================================

alter table public.ronda_ejecucion_puntos
  add column if not exists validado_por text,
  add column if not exists validado_at  timestamptz;

alter table public.ronda_ejecucion_puntos
  drop constraint if exists ronda_ejecucion_puntos_validado_por_valido;
alter table public.ronda_ejecucion_puntos
  add constraint ronda_ejecucion_puntos_validado_por_valido
  check (validado_por is null or validado_por in ('gps', 'qr', 'foto_ia', 'revision'));

-- validado_por sólo tiene sentido en un punto cumplido.
alter table public.ronda_ejecucion_puntos
  drop constraint if exists ronda_ejecucion_puntos_validado_por_coherente;
alter table public.ronda_ejecucion_puntos
  add constraint ronda_ejecucion_puntos_validado_por_coherente
  check (validado_por is null or estado = 'cumplido');

alter table public.ronda_ejecucion_puntos
  drop constraint if exists ronda_ejecucion_puntos_estado_valido;
alter table public.ronda_ejecucion_puntos
  add constraint ronda_ejecucion_puntos_estado_valido
  check (estado in ('pendiente', 'cumplido', 'incumplido', 'omitido', 'pendiente_validacion'));

alter table public.ronda_ejecuciones
  drop constraint if exists ronda_ejecuciones_resultado_valido;
alter table public.ronda_ejecuciones
  add constraint ronda_ejecuciones_resultado_valido
  check (resultado is null or resultado in ('completa', 'incompleta', 'pendiente_validacion'));

comment on column public.ronda_ejecucion_puntos.validado_por is
  'Evidencia que validó el punto: gps | qr | foto_ia | revision. NULL en puntos '
  'cumplidos sin control exigido o registrados con la regla anterior (antes de 20261120120000).';

-- Barrido de respaldo: sólo puntos que todavía pueden cambiar.
create index if not exists idx_ronda_ejecucion_puntos_revalidables
  on public.ronda_ejecucion_puntos (registrado_at)
  where estado in ('incumplido', 'pendiente_validacion');

-- ============================================================================
-- 2. VEREDICTO DE LA FOTO
-- ============================================================================
-- Devuelve: 'sin_foto' | 'pendiente' | 'aceptada_ia' | 'aceptada_revision' | 'rechazada'.
--
-- Por foto se toma UN análisis: primero el que tiene decisión humana, después
-- el completado más reciente. Semántica de la revisión humana (la misma de la
-- bandeja de IA y de la memoria visual, lib/ia/memoria.ts): CORRECTO = la foto
-- está bien; INCORRECTO = la foto no sirve. SANEADO no es decisión de nadie:
-- vale lo que dijo la IA. Sin análisis completado (pendiente, procesando,
-- error, error_definitivo) la foto está 'pendiente': no acepta ni condena.

create or replace function public.rondas_estado_foto_punto(p_ejecucion_punto_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with fotos as (
    select ev.id
      from public.evidencias ev
     where ev.proceso_tipo   = 'ronda'
       and ev.proceso_id     = p_ejecucion_punto_id
       and ev.tipo_evidencia = 'punto_control'
       and ev.bucket         = 'ronda-evidencias'
  ), veredictos as (
    select f.id,
           (select case
                     when a.revision_estado = 'CORRECTO'   then 'aceptada_revision'
                     when a.revision_estado = 'INCORRECTO' then 'rechazada'
                     when a.estado <> 'completado'          then 'pendiente'
                     when coalesce(a.clasificacion_efectiva, a.clasificacion_ia) = 'SIN_OBSERVACIONES'
                                                            then 'aceptada_ia'
                     else 'rechazada'
                   end
              from public.evidencia_analisis a
             where a.evidencia_id  = f.id
               and a.analisis_tipo = 'punto_control'
             order by (a.revision_estado in ('CORRECTO', 'INCORRECTO')) desc,
                      (a.estado = 'completado') desc,
                      a.revisado_at  desc nulls last,
                      a.analizado_at desc nulls last,
                      a.created_at   desc
             limit 1) as v
      from fotos f
  )
  select case
           when not exists (select 1 from fotos)                                   then 'sin_foto'
           when exists (select 1 from veredictos where v = 'aceptada_revision')    then 'aceptada_revision'
           when exists (select 1 from veredictos where v = 'aceptada_ia')          then 'aceptada_ia'
           when exists (select 1 from veredictos where v is null or v = 'pendiente') then 'pendiente'
           else 'rechazada'
         end;
$fn$;

revoke all on function public.rondas_estado_foto_punto(uuid) from public;
revoke all on function public.rondas_estado_foto_punto(uuid) from anon;
revoke all on function public.rondas_estado_foto_punto(uuid) from authenticated;
grant execute on function public.rondas_estado_foto_punto(uuid) to service_role;

-- ============================================================================
-- 3. REGLA PURA
-- ============================================================================
-- Misma regla que lib/rondas-validacion.ts (veredictoPunto), con tests en
-- tests/rondas-validacion.test.ts. Si cambia una, cambia la otra.

create or replace function public.rondas_veredicto_punto(
  p_exige_control boolean,
  p_dentro_radio  boolean,
  p_qr_verificado boolean,
  p_foto          text,
  out estado       text,
  out validado_por text
)
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
begin
  validado_por := null;
  if p_dentro_radio is true then
    estado := 'cumplido'; validado_por := 'gps';
  elsif p_qr_verificado is true then
    estado := 'cumplido'; validado_por := 'qr';
  elsif p_foto = 'aceptada_ia' then
    estado := 'cumplido'; validado_por := 'foto_ia';
  elsif p_foto = 'aceptada_revision' then
    estado := 'cumplido'; validado_por := 'revision';
  elsif not coalesce(p_exige_control, false) then
    -- Nada exigido: el registro alcanza, como con la regla anterior.
    estado := 'cumplido';
  elsif p_foto = 'pendiente' then
    estado := 'pendiente_validacion';
  else
    estado := 'incumplido';
  end if;
end;
$fn$;

revoke all on function public.rondas_veredicto_punto(boolean, boolean, boolean, text) from public;
revoke all on function public.rondas_veredicto_punto(boolean, boolean, boolean, text) from anon;
revoke all on function public.rondas_veredicto_punto(boolean, boolean, boolean, text) from authenticated;
grant execute on function public.rondas_veredicto_punto(boolean, boolean, boolean, text) to service_role;

-- ============================================================================
-- 4. RESULTADO DE LA RONDA DESDE SUS PUNTOS
-- ============================================================================

create or replace function public.rondas_resultado_ejecucion(p_ejecucion_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
           when bool_or(ep.estado in ('incumplido', 'omitido')) then 'incompleta'
           when bool_or(ep.estado = 'pendiente_validacion')     then 'pendiente_validacion'
           else 'completa'
         end
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = p_ejecucion_id;
$fn$;

revoke all on function public.rondas_resultado_ejecucion(uuid) from public;
revoke all on function public.rondas_resultado_ejecucion(uuid) from anon;
revoke all on function public.rondas_resultado_ejecucion(uuid) from authenticated;
grant execute on function public.rondas_resultado_ejecucion(uuid) to service_role;

-- ============================================================================
-- 5. registrar_punto_ronda — regla O
-- ============================================================================
-- Idéntica a la versión VIVA (20260905100000, verificada contra producción el
-- 02/11/2026) salvo lo marcado [REGLA]: el veredicto sale de
-- rondas_veredicto_punto y el resultado de rondas_resultado_ejecucion.

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
  -- [QR]
  v_ronda_punto_id       uuid;
  v_qr_modo              text;
  v_qr_verificado_at     timestamptz;
  v_qr_exigible          boolean := false;
  -- [REGLA]
  v_foto_veredicto       text;
  v_validado_por         text;
  v_veredicto            record;
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

  -- [QR] La exigencia sólo aplica con modo 'obligatorio' del snapshot Y una
  -- credencial activa existente (regla de no-bloqueo: no se puede exigir
  -- escanear un cartel que no existe).
  v_qr_exigible := v_qr_modo = 'obligatorio'
    and exists (
      select 1 from public.ronda_punto_qr q
       where q.ronda_punto_id = v_ronda_punto_id
         and q.activo
    );

  -- [REGLA] Una sola evidencia válida alcanza: GPS dentro del radio, QR
  -- verificado o foto aceptada. El GPS fuera de radio ya NO invalida un QR
  -- verificado ni una foto aceptada. Una foto sin analizar deja el punto en
  -- 'pendiente_validacion': ni cumplido ni incumplido hasta que la IA hable.
  -- precision_metros conserva su contrato: se valida y almacena, no juzga.
  v_foto_veredicto := case
                        when v_foto_presente then public.rondas_estado_foto_punto(p_ejecucion_punto_id)
                        else 'sin_foto'
                      end;

  v_veredicto := public.rondas_veredicto_punto(
    coalesce(v_gps_requerido, false) or coalesce(v_qr_exigible, false) or coalesce(v_foto_obligatoria, false),
    v_dentro_radio,
    v_qr_verificado_at is not null,
    v_foto_veredicto
  );
  v_estado_nuevo := v_veredicto.estado;
  v_validado_por := v_veredicto.validado_por;

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
         estado            = v_estado_nuevo,
         validado_por      = v_validado_por,                                  -- [REGLA]
         validado_at       = case when v_estado_nuevo = 'cumplido' then now() end
   where id = p_ejecucion_punto_id
     and estado = 'pendiente';

  v_pendientes := (
    select count(*)
      from public.ronda_ejecucion_puntos ep
     where ep.ronda_ejecucion_id = v_ejecucion_id
       and ep.estado = 'pendiente'
  );

  if v_pendientes = 0 then
    update public.ronda_ejecuciones
       set estado        = 'finalizada',
           resultado     = public.rondas_resultado_ejecucion(v_ejecucion_id),   -- [REGLA]
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
      'qr_exigible',        v_qr_exigible,
      'validado_por',       v_validado_por,                                     -- [REGLA]
      'pendiente_validacion', (v_estado_nuevo = 'pendiente_validacion')         -- [REGLA]
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

-- ============================================================================
-- 6. reevaluar_punto_ronda — después de la IA o de una revisión humana
-- ============================================================================
-- Re-juzga un punto YA registrado con los hechos guardados (dentro_radio,
-- qr_verificado_at, snapshot de exigencias) y el veredicto actual de su foto.
-- Idempotente: si el veredicto no cambia, no escribe nada.
--
-- Nunca toca:
--   · puntos 'pendiente' (no registrados) ni 'omitido' (cierre administrativo);
--   · puntos cumplidos por GPS o QR: esos hechos no cambian después;
--   · puntos cumplidos con la regla anterior o sin control exigido
--     (validado_por NULL): no se degrada lo que ya se dio por cumplido.
-- Sólo un punto cumplido POR LA FOTO puede volver a incumplido, y sólo porque
-- una persona dijo que la foto no sirve.
--
-- Si la ronda está finalizada recalcula su resultado. Una ronda con cierre
-- administrativo siempre tiene puntos omitidos: sigue 'incompleta'.

create or replace function public.reevaluar_punto_ronda(p_ejecucion_punto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p              record;
  v_qr_exigible    boolean;
  v_foto_oblig     boolean;
  v_foto           text;
  v_ver            record;
  v_resultado_ant  text;
  v_resultado_nvo  text;
begin
  if p_ejecucion_punto_id is null then
    return jsonb_build_object('contexto', 'punto_no_disponible');
  end if;

  -- Mismo orden de bloqueo que registrar_punto_ronda (ejecución y punto).
  select ep.id, ep.estado, ep.validado_por, ep.ronda_punto_id, ep.snap_qr_modo,
         ep.snap_politica_foto, ep.snap_gps_requerido, ep.hay_novedad,
         ep.dentro_radio, ep.qr_verificado_at,
         e.id as ejecucion_id, e.estado as ejecucion_estado, e.resultado
    into v_p
    from public.ronda_ejecucion_puntos ep
    join public.ronda_ejecuciones e on e.id = ep.ronda_ejecucion_id
   where ep.id = p_ejecucion_punto_id
   for update of e, ep;

  if v_p.id is null then
    return jsonb_build_object('contexto', 'punto_no_disponible');
  end if;

  if v_p.estado in ('pendiente', 'omitido')
     or (v_p.estado = 'cumplido' and coalesce(v_p.validado_por, '') not in ('foto_ia', 'revision')) then
    return jsonb_build_object(
      'contexto', 'sin_cambios',
      'estado', v_p.estado,
      'validado_por', v_p.validado_por,
      'resultado', v_p.resultado
    );
  end if;

  v_qr_exigible := v_p.snap_qr_modo = 'obligatorio'
    and exists (
      select 1 from public.ronda_punto_qr q
       where q.ronda_punto_id = v_p.ronda_punto_id
         and q.activo
    );
  v_foto_oblig := (v_p.snap_politica_foto = 'obligatoria')
                  or (v_p.snap_politica_foto = 'solo_novedad' and v_p.hay_novedad);
  v_foto := public.rondas_estado_foto_punto(p_ejecucion_punto_id);

  v_ver := public.rondas_veredicto_punto(
    coalesce(v_p.snap_gps_requerido, false) or coalesce(v_qr_exigible, false) or coalesce(v_foto_oblig, false),
    v_p.dentro_radio,
    v_p.qr_verificado_at is not null,
    v_foto
  );

  if v_ver.estado is not distinct from v_p.estado
     and v_ver.validado_por is not distinct from v_p.validado_por then
    return jsonb_build_object(
      'contexto', 'sin_cambios',
      'estado', v_p.estado,
      'validado_por', v_p.validado_por,
      'foto', v_foto,
      'resultado', v_p.resultado
    );
  end if;

  update public.ronda_ejecucion_puntos
     set estado       = v_ver.estado,
         validado_por = v_ver.validado_por,
         validado_at  = case when v_ver.estado = 'cumplido' then now() end
   where id = p_ejecucion_punto_id;

  v_resultado_ant := v_p.resultado;
  v_resultado_nvo := v_p.resultado;
  if v_p.ejecucion_estado = 'finalizada' then
    v_resultado_nvo := public.rondas_resultado_ejecucion(v_p.ejecucion_id);
    if v_resultado_nvo is distinct from v_resultado_ant then
      update public.ronda_ejecuciones
         set resultado = v_resultado_nvo
       where id = v_p.ejecucion_id
         and estado = 'finalizada';
    end if;
  end if;

  return jsonb_build_object(
    'contexto',        'actualizado',
    'estado_anterior', v_p.estado,
    'estado',          v_ver.estado,
    'validado_por',    v_ver.validado_por,
    'foto',            v_foto,
    'resultado_anterior', v_resultado_ant,
    'resultado',       v_resultado_nvo
  );
end;
$fn$;

revoke all on function public.reevaluar_punto_ronda(uuid) from public;
revoke all on function public.reevaluar_punto_ronda(uuid) from anon;
revoke all on function public.reevaluar_punto_ronda(uuid) from authenticated;
grant execute on function public.reevaluar_punto_ronda(uuid) to service_role;

-- ============================================================================
-- 7. Barrido de respaldo
-- ============================================================================
-- Recorre puntos que todavía pueden cambiar (incumplido / pendiente_validacion
-- / cumplido por foto) registrados desde p_desde y que tienen alguna evidencia
-- que pueda validarlos. Lo llama /api/ia/cron en cada corrida con una ventana
-- corta. Con p_desde viejo sirve para recalcular historial (decisión aparte).

create or replace function public.reevaluar_puntos_ronda_pendientes(
  p_desde  timestamptz default now() - interval '3 days',
  p_limite integer     default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  r            record;
  v_res        jsonb;
  v_revisados  integer := 0;
  v_cambiados  integer := 0;
begin
  for r in
    select ep.id
      from public.ronda_ejecucion_puntos ep
     where ep.registrado_at >= coalesce(p_desde, now() - interval '3 days')
       and (ep.estado in ('incumplido', 'pendiente_validacion')
            or (ep.estado = 'cumplido' and ep.validado_por in ('foto_ia', 'revision')))
       and (ep.dentro_radio is true
            or ep.qr_verificado_at is not null
            or exists (select 1 from public.evidencias ev
                        where ev.proceso_tipo   = 'ronda'
                          and ev.proceso_id     = ep.id
                          and ev.tipo_evidencia = 'punto_control'))
     order by ep.registrado_at
     limit greatest(1, least(coalesce(p_limite, 200), 5000))
  loop
    v_res := public.reevaluar_punto_ronda(r.id);
    v_revisados := v_revisados + 1;
    if v_res ->> 'contexto' = 'actualizado' then
      v_cambiados := v_cambiados + 1;
    end if;
  end loop;

  return jsonb_build_object('revisados', v_revisados, 'actualizados', v_cambiados);
end;
$fn$;

revoke all on function public.reevaluar_puntos_ronda_pendientes(timestamptz, integer) from public;
revoke all on function public.reevaluar_puntos_ronda_pendientes(timestamptz, integer) from anon;
revoke all on function public.reevaluar_puntos_ronda_pendientes(timestamptz, integer) from authenticated;
grant execute on function public.reevaluar_puntos_ronda_pendientes(timestamptz, integer) to service_role;

-- ============================================================================
-- 8. ia_registrar_revision — re-evalúa el punto después de la decisión humana
-- ============================================================================
-- Idéntica a la versión VIVA (verificada el 02/11/2026) salvo [REGLA].

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
  v_punto_id   uuid;   -- [REGLA]
  v_reeval     jsonb;  -- [REGLA]
begin
  if p_decision is null or p_decision not in ('CORRECTO', 'INCORRECTO') then
    raise exception 'Decisión inválida: %', coalesce(p_decision, '(null)');
  end if;

  v_usuario_id := public.rondas_usuario_actual_id();
  if v_usuario_id is null then
    raise exception 'Sesión no válida';
  end if;

  select ea.id, ea.objetivo_id, ea.revision_estado, ea.estado,
         ea.analisis_tipo, ea.evidencia_id                                    -- [REGLA]
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

  -- [REGLA] La decisión humana sobre una foto de punto puede validar (o dejar
  -- de validar) el punto. Misma transacción: o queda todo o nada.
  if v_analisis.analisis_tipo = 'punto_control' then
    v_punto_id := (
      select ev.proceso_id
        from public.evidencias ev
       where ev.id = v_analisis.evidencia_id
         and ev.proceso_tipo = 'ronda'
    );
    if v_punto_id is not null then
      v_reeval := public.reevaluar_punto_ronda(v_punto_id);
    end if;
  end if;

  return jsonb_build_object(
    'ok',              true,
    'analisis_id',     p_analisis_id,
    'estado_anterior', v_anterior,
    'estado_nuevo',    p_decision,
    'revisado_por',    v_usuario_id,
    'punto_ronda',     v_reeval                                               -- [REGLA]
  );
end;
$fn$;

-- ============================================================================
-- 9. listar_rondas_programadas_objetivo — estado y contador nuevos
-- ============================================================================
-- Idéntica a la versión VIVA (verificada el 02/11/2026) salvo [REGLA]:
-- resultado 'pendiente_validacion' → estado 'pendiente_validacion' (antes
-- caía en 'incompleta' por el ELSE) y contador puntos_pendientes_validacion.

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
              when e.id is not null and e.resultado = 'pendiente_validacion'
                                                                 then 'pendiente_validacion'  -- [REGLA]
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
          'puntos_pendientes_validacion', coalesce(cnt.pendientes_validacion, 0),  -- [REGLA]
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
          count(*) filter (where ep.estado = 'omitido')    as omitidos,
          count(*) filter (where ep.estado = 'pendiente_validacion') as pendientes_validacion  -- [REGLA]
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

notify pgrst, 'reload schema';

commit;

-- ── Verificación (después de aplicar) ───────────────────────────────────────
-- 1) Constraints nuevos:
--    select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid in ('public.ronda_ejecucion_puntos'::regclass, 'public.ronda_ejecuciones'::regclass)
--       and conname in ('ronda_ejecucion_puntos_estado_valido', 'ronda_ejecucion_puntos_validado_por_valido',
--                       'ronda_ejecucion_puntos_validado_por_coherente', 'ronda_ejecuciones_resultado_valido');
-- 2) Regla pura (debe devolver cumplido/qr):
--    select * from public.rondas_veredicto_punto(true, false, true, 'pendiente');
-- 3) Puntos esperando validación hace más de 24 h (debería tender a cero):
--    select count(*) from public.ronda_ejecucion_puntos
--     where estado = 'pendiente_validacion' and registrado_at < now() - interval '24 hours';
-- 4) Distribución de validado_por de los últimos 3 días:
--    select validado_por, count(*) from public.ronda_ejecucion_puntos
--     where registrado_at > now() - interval '3 days' group by 1;
