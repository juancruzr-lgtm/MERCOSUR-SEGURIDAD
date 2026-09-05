-- ============================================================================
-- RONDAS · Validación física por QR por punto de control
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- Hay puntos donde el GPS del teléfono es estructuralmente poco confiable
-- (radios de ~10 m con precisiones reales de 30-90 m). Esta migración agrega
-- una evidencia física: un QR propio por punto, pegado en el lugar, que el
-- vigilador escanea desde la app durante la ejecución. El servidor valida que
-- el QR corresponda exactamente al punto en curso.
--
-- El QR NO reemplaza nada: GPS, foto, IA, radio y auditoría siguen igual.
--   QR      = evidencia de presencia ante el marcador físico
--   GPS     = evidencia geográfica complementaria (se sigue capturando SIEMPRE)
--   Foto/IA = evidencia visual/contextual (reglas intactas)
--
-- CONFIGURACIÓN POR PUNTO (ronda_puntos.qr_modo)
--   desactivado   comportamiento actual, sin QR.        ← default
--   opcional      escanearlo suma evidencia; no escanearlo no cambia el
--                 veredicto.
--   obligatorio   sin QR verificado el punto se registra como 'incumplido'
--                 (misma semántica que GPS requerido sin ubicación: registra,
--                 no acredita). Los demás controles (foto, GPS) siguen
--                 exigiéndose según su propia configuración.
--
-- REGLA DE NO-BLOQUEO: si el punto está en 'obligatorio' pero NO tiene ninguna
-- credencial QR activa (error de configuración), la exigencia no aplica: no se
-- puede pedir escanear un cartel que no existe, y un punto imposible bloquearía
-- la ronda entera por la regla de secuencia. La UI de administración empuja a
-- generar el QR antes de exigirlo.
--
-- IDENTIDAD DEL QR (ronda_punto_qr)
--
-- El QR es una CREDENCIAL, no información: contiene un token aleatorio de 256
-- bits (64 hex) con prefijo de formato "MSQR1." — nada de nombres, IDs internos
-- ni coordenadas. El servidor resuelve a qué punto corresponde; jamás se confía
-- en un punto declarado por el cliente.
--
-- El token se guarda en texto plano en una tabla SIN ningún grant a
-- authenticated (ni SELECT): sólo las RPC SECURITY DEFINER lo tocan. Se evaluó
-- guardar sólo el hash, pero la administración necesita "Ver / imprimir" el QR
-- después de generarlo sin invalidar el cartel ya pegado; un hash lo haría
-- imposible. El plano de amenaza real (alguien fotografía el cartel físico) es
-- idéntico en ambos esquemas, y está documentado abajo.
--
-- REGENERACIÓN: revoca la credencial activa (activo=false + revocado_por/at,
-- la fila no se borra) y crea una nueva. El QR viejo deja de validar. Cada
-- generación/regeneración queda en ronda_puntos_auditoria (campo
-- 'qr_credencial'), y el cambio de modo queda auditado como los campos GPS.
--
-- ANTI-REPLAY BÁSICO: la verificación se escribe en la fila de
-- ronda_ejecucion_puntos del punto EN CURSO, bajo el mismo lock y las mismas
-- guardas de secuencia que registrar_punto_ronda. Un escaneo válido queda
-- ligado a UNA ejecución y UN punto con timestamp de servidor; no existe ningún
-- parámetro cliente tipo "qr_ok". El mismo QR sí sirve en ejecuciones futuras:
-- es un cartel estático, esa es su naturaleza.
--
-- LIMITACIÓN DOCUMENTADA: un QR fijo puede ser fotografiado o copiado. Por sí
-- solo no es prueba criptográfica de presencia física; la evidencia real es la
-- combinación QR + usuario + ejecución + timestamp de servidor + GPS + foto.
-- QR dinámicos / NFC / rotación / challenge-response quedan explícitamente
-- fuera de esta etapa; se evalúan sólo si aparecen abusos.
--
-- GPS AL ESCANEAR: el scan guarda su propia lectura (qr_latitud/longitud/
-- precision/distancia) además de la del registro. Un QR válido con GPS malo NO
-- se rechaza: el GPS queda registrado como evidencia/anomalía, visible para
-- supervisión (qr_distancia_metros). precision_metros conserva su contrato: se
-- guarda y no participa del veredicto.
--
-- INTENTOS INVÁLIDOS (QR ajeno, vencido o irreconocible) incrementan
-- qr_intentos_invalidos en la fila del punto en curso: quedan auditables sin
-- crear tipos nuevos de alerta ni saturar supervisores. Si la operación lo
-- pide, una etapa posterior puede agregarlos al evaluador de alertas.
--
-- QUÉ NO TOCA: políticas de foto e IA, control por reincidencia GPS,
-- ronda_alertas, pausas, ventanas, cumplimiento, asistencia, liquidación,
-- RLS/F1 global. Ninguna migración histórica se modifica.
--
-- ROLLBACK      supabase/rollback/20260905100000_rondas_qr_puntos_rollback.sql
-- VERIFICACIÓN  supabase/verificacion/20260905100000_rondas_qr_pre_post.sql
-- ============================================================================

begin;

-- ── 1. Modo QR por punto (configuración) ────────────────────────────────────

alter table public.ronda_puntos
  add column qr_modo text not null default 'desactivado';

alter table public.ronda_puntos
  add constraint ronda_puntos_qr_modo_valido
  check (qr_modo in ('desactivado', 'opcional', 'obligatorio'));

comment on column public.ronda_puntos.qr_modo is
  'Validación por QR físico del punto: desactivado (default) | opcional | '
  'obligatorio. Con obligatorio, un punto sin QR verificado se registra como '
  'incumplido — salvo que el punto no tenga credencial activa, en cuyo caso la '
  'exigencia no aplica (regla de no-bloqueo).';

-- Grants por columna, igual que el resto de la configuración editable.
grant update (qr_modo) on table public.ronda_puntos to authenticated;

-- ── 2. Credenciales QR por punto ────────────────────────────────────────────
-- Una fila por credencial emitida. La activa valida; las revocadas quedan como
-- historial (nunca se borran: las ejecuciones las referencian).

create table public.ronda_punto_qr (
  id              uuid primary key default gen_random_uuid(),
  ronda_punto_id  uuid not null references public.ronda_puntos(id) on delete cascade,
  -- Token aleatorio de 256 bits en hex. Es LA credencial: el QR impreso
  -- contiene "MSQR1.<token>". Ver nota de cabecera sobre texto plano vs hash.
  token           text not null,
  -- Código humano corto para identificar el cartel impreso ("qué cartel es
  -- este"). No es secreto ni credencial; no alcanza para validar nada.
  codigo_corto    text not null,
  activo          boolean not null default true,
  creado_por      uuid references public.usuarios(id),
  created_at      timestamptz not null default now(),
  revocado_por    uuid references public.usuarios(id),
  revocado_at     timestamptz,

  constraint ronda_punto_qr_token_unique unique (token),

  constraint ronda_punto_qr_token_formato
    check (token ~ '^[0-9a-f]{64}$'),

  constraint ronda_punto_qr_codigo_formato
    check (codigo_corto ~ '^[0-9A-F]{6}$'),

  -- Una credencial activa no tiene revocación; una revocada la tiene completa.
  constraint ronda_punto_qr_revocacion_coherente
    check (
      (activo and revocado_at is null and revocado_por is null)
      or
      (not activo and revocado_at is not null)
    )
);

comment on table public.ronda_punto_qr is
  'Credenciales QR físicas por punto de ronda. A lo sumo una activa por punto. '
  'SIN ningún grant a authenticated (ni SELECT): emisión, lectura y validación '
  'pasan exclusivamente por RPC SECURITY DEFINER con control de rol/alcance.';

-- A lo sumo una credencial activa por punto.
create unique index ronda_punto_qr_una_activa
  on public.ronda_punto_qr (ronda_punto_id)
  where activo;

create index idx_ronda_punto_qr_punto
  on public.ronda_punto_qr (ronda_punto_id, created_at desc);

-- Cerrada por completo al cliente. Los DEFAULT PRIVILEGES de Supabase conceden
-- solos (ver 20260725_m1bis): el revoke no es decorativo. Sin policies: nadie
-- pasa por RLS porque nadie tiene grants.
alter table public.ronda_punto_qr enable row level security;

revoke all on table public.ronda_punto_qr from public;
revoke all on table public.ronda_punto_qr from anon;
revoke all on table public.ronda_punto_qr from authenticated;

-- ── 3. Snapshot y hechos del QR en la ejecución ─────────────────────────────
-- Defaults compatibles: ejecuciones históricas y en curso quedan como
-- 'desactivado', que es el comportamiento previo.

alter table public.ronda_ejecucion_puntos
  add column snap_qr_modo          text not null default 'desactivado',
  add column qr_verificado_at      timestamptz,
  add column qr_credencial_id      uuid references public.ronda_punto_qr(id),
  add column qr_latitud            double precision,
  add column qr_longitud           double precision,
  add column qr_precision_metros   double precision,
  add column qr_distancia_metros   double precision,
  add column qr_intentos_invalidos integer not null default 0;

alter table public.ronda_ejecucion_puntos
  add constraint ronda_ejecucion_puntos_snap_qr_modo_valido
  check (snap_qr_modo in ('desactivado', 'opcional', 'obligatorio')),

  add constraint ronda_ejecucion_puntos_qr_verificacion_coherente
  check ((qr_verificado_at is null) = (qr_credencial_id is null)),

  add constraint ronda_ejecucion_puntos_qr_coordenadas_completas
  check ((qr_latitud is null) = (qr_longitud is null)),

  add constraint ronda_ejecucion_puntos_qr_intentos_valido
  check (qr_intentos_invalidos >= 0);

comment on column public.ronda_ejecucion_puntos.snap_qr_modo is
  'Modo QR del punto congelado por iniciar_ronda, igual que snap_politica_foto: '
  'las reglas de esta ejecución no cambian a mitad de ronda.';

comment on column public.ronda_ejecucion_puntos.qr_verificado_at is
  'Timestamp de SERVIDOR de la verificación del QR en esta visita. Hecho, no '
  'veredicto: junto con qr_credencial_id responde "¿cómo se acreditó este '
  'punto?". null = no se escaneó (o el punto no usaba QR).';

comment on column public.ronda_ejecucion_puntos.qr_distancia_metros is
  'Distancia al punto según el GPS capturado EN EL MOMENTO del escaneo. Un QR '
  'válido con GPS absurdamente lejano no se oculta: queda acá para revisión.';

comment on column public.ronda_ejecucion_puntos.qr_intentos_invalidos is
  'Cantidad de escaneos rechazados en esta visita (QR de otro punto, vencido o '
  'irreconocible). Auditoría liviana sin tipos nuevos de alerta.';

-- ── 4. iniciar_ronda: congelar el modo QR en el snapshot ────────────────────
-- Idéntica a 20260802100000 salvo la columna snap_qr_modo en el INSERT del
-- snapshot (señalada con [QR]).

create or replace function public.iniciar_ronda(p_ronda_base_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx                     record;
  v_ronda                   record;
  v_turno                   record;
  v_ejecucion_id            uuid;
  v_ejecucion_ronda_base_id uuid;
  v_inicio_previsto         timestamp;
  v_fuera                   boolean := false;
  v_total                   integer;
  v_insertados              integer;
  v_constraint              text;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'ejecucion', null);
  end if;
  if v_ctx.puesto_id is null then
    return jsonb_build_object('contexto', 'turno_sin_puesto', 'ejecucion', null);
  end if;

  -- Idempotencia por lectura: si ya hay una ejecución abierta de ESTE guardia en
  -- ESTE turno, se devuelve. Nunca se toca la de otro guardia (reemplazo).
  select e.id, e.ronda_base_id
    into v_ejecucion_id, v_ejecucion_ronda_base_id
    from public.ronda_ejecuciones e
   where e.turno_id  = v_ctx.turno_id
     and e.guardia_id = v_ctx.usuario_id
     and e.estado    = 'en_curso'
   limit 1;

  if v_ejecucion_id is not null then
    return jsonb_build_object(
      'contexto',
        case
          when v_ejecucion_ronda_base_id = p_ronda_base_id then 'recuperada'
          else 'otra_ronda_en_curso'
        end,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- La ronda debe existir, estar activa y pertenecer al puesto del turno vigente.
  -- `for update` serializa el inicio contra una edición concurrente de puntos.
  select rb.* into v_ronda
    from public.rondas_base rb
   where rb.id = p_ronda_base_id
     and rb.activo = true
     and rb.puesto_id = v_ctx.puesto_id
     for update;

  if not found then
    return jsonb_build_object('contexto', 'ronda_no_disponible', 'ejecucion', null);
  end if;

  select count(*) into v_total
    from public.ronda_puntos rp
   where rp.ronda_base_id = v_ronda.id
     and rp.activo = true;

  if v_total = 0 then
    return jsonb_build_object('contexto', 'ronda_sin_puntos', 'ejecucion', null);
  end if;

  -- Marca de inicio fuera de horario, anclada al turno y no al reloj del día.
  if v_ronda.hora_inicio is not null then
    select t.hora_inicio into v_turno from public.turnos t where t.id = v_ctx.turno_id;
    v_inicio_previsto := v_ctx.fecha_operativa + v_ronda.hora_inicio;
    if v_inicio_previsto < (v_ctx.fecha_operativa + v_turno.hora_inicio) then
      v_inicio_previsto := v_inicio_previsto + interval '1 day';
    end if;
    v_fuera := v_ctx.ahora_local < v_inicio_previsto;
  end if;

  begin
    insert into public.ronda_ejecuciones (
      ronda_base_id, turno_id, guardia_id, objetivo_id, puesto_id,
      fecha_operativa, estado, iniciada_fuera_horario, puntos_total,
      snap_ronda_nombre, snap_intervalo_minutos, snap_hora_inicio
    ) values (
      v_ronda.id, v_ctx.turno_id, v_ctx.usuario_id, v_ctx.objetivo_id, v_ctx.puesto_id,
      v_ctx.fecha_operativa, 'en_curso', v_fuera, v_total,
      v_ronda.nombre, v_ronda.intervalo_minutos, v_ronda.hora_inicio
    )
    returning id into v_ejecucion_id;
  exception when unique_violation then
    -- Dos toques concurrentes: el índice parcial rechaza el segundo. Se relee y
    -- se devuelve la que ganó. Sólo se absorbe LA violación esperada.
    get stacked diagnostics v_constraint = constraint_name;

    if v_constraint is distinct from 'ronda_ejecuciones_turno_guardia_en_curso_unique' then
      raise;
    end if;

    select e.id, e.ronda_base_id
      into v_ejecucion_id, v_ejecucion_ronda_base_id
      from public.ronda_ejecuciones e
     where e.turno_id  = v_ctx.turno_id
       and e.guardia_id = v_ctx.usuario_id
       and e.estado    = 'en_curso'
     limit 1;

    if v_ejecucion_id is null then
      raise;
    end if;

    return jsonb_build_object(
      'contexto',
        case
          when v_ejecucion_ronda_base_id = p_ronda_base_id then 'recuperada'
          else 'otra_ronda_en_curso'
        end,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end;

  -- Snapshot de los puntos ACTIVOS al momento de iniciar.
  -- [QR] El modo QR vigente del punto se congela acá, igual que la política de
  -- foto y la exigencia por reincidencia GPS. Si la administración cambia el
  -- modo después de iniciada la ronda, rige recién en la ejecución siguiente.
  insert into public.ronda_ejecucion_puntos (
    ronda_ejecucion_id, ronda_punto_id, orden, snap_nombre,
    snap_latitud, snap_longitud, snap_radio_metros,
    snap_foto_requerida, snap_gps_requerido, snap_politica_foto,
    snap_foto_control_gps,
    snap_qr_modo
  )
  select
    v_ejecucion_id, rp.id,
    row_number() over (order by rp.orden, rp.id),
    rp.nombre, rp.latitud, rp.longitud, rp.radio_metros,
    rp.foto_requerida, rp.gps_requerido, rp.politica_foto,
    coalesce(cg.foto_requerida_proxima_visita, false),
    rp.qr_modo
  from public.ronda_puntos rp
  left join public.ronda_punto_control_gps cg on cg.ronda_punto_id = rp.id
  where rp.ronda_base_id = v_ronda.id
    and rp.activo = true;

  get diagnostics v_insertados = row_count;

  if v_insertados <> v_total then
    update public.ronda_ejecuciones
       set puntos_total = v_insertados
     where id = v_ejecucion_id;
  end if;

  return jsonb_build_object(
    'contexto',  'iniciada',
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.iniciar_ronda(uuid) from public;
revoke all on function public.iniciar_ronda(uuid) from anon;
grant execute on function public.iniciar_ronda(uuid) to authenticated;

-- ── 5. rondas_ejecucion_json: exponer el estado QR al vigilador ─────────────
-- Idéntica a 20260802100000 más tres claves por punto:
--   qr_modo        modo congelado en el snapshot
--   qr_verificado  el escaneo de esta visita ya fue validado por el servidor
--   qr_disponible  el punto tiene una credencial activa (regla de no-bloqueo:
--                  sin credencial la exigencia no aplica y la UI no pide scan)

create or replace function public.rondas_ejecucion_json(p_ejecucion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'id',                 e.id,
    'estado',             e.estado,
    'hora_inicio',        e.iniciada_at,
    'hora_fin',           e.finalizada_at,
    'porcentaje',         case when e.puntos_total = 0 then 0
                            else round((count(*) filter (where p.estado <> 'pendiente')) * 100.0 / e.puntos_total)
                          end,
    'puntos_completados', count(*) filter (where p.estado <> 'pendiente'),
    'puntos_total',       e.puntos_total,
    'punto_actual_id',    (select p2.ronda_punto_id
                             from public.ronda_ejecucion_puntos p2
                            where p2.ronda_ejecucion_id = e.id
                              and p2.estado = 'pendiente'
                            order by p2.orden limit 1),
    'puede_continuar',    e.estado = 'en_curso',
    'resultado',          e.resultado,
    'ronda_base_id',      e.ronda_base_id,
    'ronda_nombre',       e.snap_ronda_nombre,
    'fecha_operativa',    e.fecha_operativa,
    'fuera_horario',      e.iniciada_fuera_horario,
    'puntos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ronda_punto_id',    p.ronda_punto_id,
          'ejecucion_punto_id', p.id,
          'orden',             p.orden,
          'nombre',            p.snap_nombre,
          'estado',            p.estado,
          'completado_at',     p.registrado_at,
          'requiere_foto',     p.snap_foto_requerida,
          'politica_foto',     p.snap_politica_foto,
          'hay_novedad',       p.hay_novedad,
          'foto_control_gps',  p.snap_foto_control_gps,
          'requiere_gps',      p.snap_gps_requerido,
          'latitud',           p.snap_latitud,
          'longitud',          p.snap_longitud,
          'radio_metros',      p.snap_radio_metros,
          'qr_modo',           p.snap_qr_modo,
          'qr_verificado',     (p.qr_verificado_at is not null),
          'qr_disponible',     exists (
                                 select 1 from public.ronda_punto_qr q
                                  where q.ronda_punto_id = p.ronda_punto_id
                                    and q.activo
                               )
        ) order by p.orden
      ) filter (where p.id is not null),
      jsonb_build_array()
    )
  )
  from public.ronda_ejecuciones e
  left join public.ronda_ejecucion_puntos p on p.ronda_ejecucion_id = e.id
  where e.id = p_ejecucion_id
  group by e.id;
$$;

revoke all on function public.rondas_ejecucion_json(uuid) from public;
revoke all on function public.rondas_ejecucion_json(uuid) from anon;

-- ── 6. validar_qr_ronda_punto: el escaneo del vigilador ─────────────────────
-- Server-side por completo: el cliente manda el token leído de la cámara y el
-- GPS disponible; el servidor decide a qué punto corresponde. Mismas guardas de
-- identidad, secuencia y lock que registrar_punto_ronda: la verificación queda
-- ligada a UNA ejecución y UN punto, con timestamp de servidor.
--
-- Contextos:
--   qr_verificado        credencial activa del punto en curso; queda escrito.
--   qr_ya_verificado     reintento sobre una visita ya verificada; idempotente,
--                        conserva la PRIMERA verificación.
--   qr_vencido           credencial de ESTE punto pero revocada (regenerada).
--   qr_no_corresponde    credencial de OTRO punto (activa o no). No se revela
--                        nada del otro punto.
--   qr_invalido          token irreconocible o inexistente.
--   + los de siempre: sin_turno_vigente, punto_no_disponible, ya_registrado,
--     ejecucion_cerrada, fuera_de_secuencia, gps_invalido.
--
-- Los tres rechazos de credencial incrementan qr_intentos_invalidos de la
-- visita en curso.

create function public.validar_qr_ronda_punto(
  p_ejecucion_punto_id uuid,
  p_token              text,
  p_latitud            double precision default null,
  p_longitud           double precision default null,
  p_precision_metros   double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx                  record;
  v_ejecucion_id         uuid;
  v_ejecucion_estado     text;
  v_punto_estado         text;
  v_ronda_punto_id       uuid;
  v_snap_latitud         double precision;
  v_snap_longitud        double precision;
  v_snap_radio_metros    integer;
  v_qr_verificado_at     timestamptz;
  v_primero_pendiente_id uuid;
  v_token                text;
  v_cred                 record;
  v_distancia_metros     double precision;
  v_ahora                timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  if p_ejecucion_punto_id is null then
    return jsonb_build_object('contexto', 'punto_no_disponible', 'qr', null, 'ejecucion', null);
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'qr', null, 'ejecucion', null);
  end if;

  -- Mismo lock que registrar_punto_ronda: serializa contra el registro y contra
  -- otro escaneo en paralelo. El WHERE es toda la autorización: sólo el guardia
  -- dueño de la ejecución en su turno vigente.
  select
    e.id, e.estado, ep.estado, ep.ronda_punto_id,
    ep.snap_latitud, ep.snap_longitud, ep.snap_radio_metros,
    ep.qr_verificado_at
  into
    v_ejecucion_id, v_ejecucion_estado, v_punto_estado, v_ronda_punto_id,
    v_snap_latitud, v_snap_longitud, v_snap_radio_metros,
    v_qr_verificado_at
  from public.ronda_ejecucion_puntos ep
  join public.ronda_ejecuciones e on e.id = ep.ronda_ejecucion_id
  where ep.id        = p_ejecucion_punto_id
    and e.turno_id   = v_ctx.turno_id
    and e.guardia_id = v_ctx.usuario_id
  for update of e, ep;

  if v_ejecucion_id is null then
    return jsonb_build_object('contexto', 'punto_no_disponible', 'qr', null, 'ejecucion', null);
  end if;

  if v_punto_estado <> 'pendiente' then
    return jsonb_build_object(
      'contexto', 'ya_registrado', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  if v_ejecucion_estado <> 'en_curso' then
    return jsonb_build_object(
      'contexto', 'ejecucion_cerrada', 'qr', null,
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
      'contexto', 'fuera_de_secuencia', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Misma validación de coordenadas que registrar_punto_ronda.
  if (p_latitud is null) <> (p_longitud is null)
     or (p_latitud is not null and (p_latitud < -90 or p_latitud > 90))
     or (p_longitud is not null and (p_longitud < -180 or p_longitud > 180))
     or (p_precision_metros is not null and p_precision_metros < 0)
     or (p_precision_metros is not null and p_latitud is null) then
    return jsonb_build_object(
      'contexto', 'gps_invalido', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Idempotencia: la primera verificación manda; un segundo escaneo no la pisa.
  if v_qr_verificado_at is not null then
    return jsonb_build_object(
      'contexto', 'qr_ya_verificado',
      'qr', jsonb_build_object('verificado_at', v_qr_verificado_at),
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  v_token := lower(btrim(coalesce(p_token, '')));

  if v_token !~ '^[0-9a-f]{64}$' then
    update public.ronda_ejecucion_puntos
       set qr_intentos_invalidos = qr_intentos_invalidos + 1
     where id = p_ejecucion_punto_id;
    return jsonb_build_object(
      'contexto', 'qr_invalido', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  select q.id, q.ronda_punto_id, q.activo
    into v_cred
    from public.ronda_punto_qr q
   where q.token = v_token;

  if not found then
    update public.ronda_ejecucion_puntos
       set qr_intentos_invalidos = qr_intentos_invalidos + 1
     where id = p_ejecucion_punto_id;
    return jsonb_build_object(
      'contexto', 'qr_invalido', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  if v_cred.ronda_punto_id is distinct from v_ronda_punto_id then
    update public.ronda_ejecucion_puntos
       set qr_intentos_invalidos = qr_intentos_invalidos + 1
     where id = p_ejecucion_punto_id;
    return jsonb_build_object(
      'contexto', 'qr_no_corresponde', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  if not v_cred.activo then
    update public.ronda_ejecucion_puntos
       set qr_intentos_invalidos = qr_intentos_invalidos + 1
     where id = p_ejecucion_punto_id;
    return jsonb_build_object(
      'contexto', 'qr_vencido', 'qr', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Credencial activa del punto en curso: verificación con timestamp de
  -- servidor. El GPS del momento del scan se conserva aunque el registro
  -- posterior capture otro; un QR válido con GPS lejano no se oculta.
  if p_latitud is not null
     and v_snap_latitud is not null
     and v_snap_longitud is not null then
    v_distancia_metros := public.rondas_distancia_metros(
      p_latitud, p_longitud, v_snap_latitud, v_snap_longitud
    );
  end if;

  update public.ronda_ejecucion_puntos
     set qr_verificado_at    = v_ahora,
         qr_credencial_id    = v_cred.id,
         qr_latitud          = p_latitud,
         qr_longitud         = p_longitud,
         qr_precision_metros = p_precision_metros,
         qr_distancia_metros = v_distancia_metros
   where id = p_ejecucion_punto_id
     and estado = 'pendiente'
     and qr_verificado_at is null;

  return jsonb_build_object(
    'contexto', 'qr_verificado',
    'qr', jsonb_build_object(
      'verificado_at',     v_ahora,
      'distancia_metros',  v_distancia_metros
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.validar_qr_ronda_punto(
  uuid, text, double precision, double precision, double precision
) from public;
revoke all on function public.validar_qr_ronda_punto(
  uuid, text, double precision, double precision, double precision
) from anon;
grant execute on function public.validar_qr_ronda_punto(
  uuid, text, double precision, double precision, double precision
) to authenticated;

-- ── 7. registrar_punto_ronda: el QR obligatorio entra al veredicto ──────────
-- Idéntica a 20260802100000 salvo los agregados señalados con [QR]: lectura del
-- snapshot QR, la regla de veredicto y las claves nuevas en la respuesta.
--
-- Regla: con snap_qr_modo = 'obligatorio' y credencial activa existente, un
-- punto sin QR verificado se registra como 'incumplido' — misma semántica que
-- GPS requerido sin ubicación: registra, no acredita, no bloquea la secuencia.
-- 'opcional' y 'desactivado' no tocan el veredicto. La verificación en sí es un
-- hecho previo escrito por validar_qr_ronda_punto; acá sólo se juzga.

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
  -- [CONTROL GPS]
  v_ronda_punto_id       uuid;
  v_ronda_base_id        uuid;
  v_snap_foto_control    boolean;
  v_umbral               integer := greatest(1, coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_control_gps_umbral'), 2));
  -- [QR]
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
    ep.ronda_punto_id,          -- [CONTROL GPS]
    e.ronda_base_id,            -- [CONTROL GPS]
    ep.snap_foto_control_gps,   -- [CONTROL GPS]
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
    v_ronda_base_id,
    v_snap_foto_control,
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
                        or (v_politica_foto = 'solo_novedad' and v_novedad)
                        or v_snap_foto_control;

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

  -- ── [CONTROL GPS] Transiciones de la racha ────────────────────────────────
  if v_snap_foto_control then
    insert into public.ronda_punto_control_gps as cg (
      ronda_punto_id, ronda_base_id, incumplimientos_consecutivos,
      foto_requerida_proxima_visita, ultimo_ejecucion_punto_id
    ) values (
      v_ronda_punto_id, v_ronda_base_id, 0, false, p_ejecucion_punto_id
    )
    on conflict (ronda_punto_id) do update
      set incumplimientos_consecutivos  = 0,
          foto_requerida_proxima_visita = false,
          ultimo_ejecucion_punto_id     = excluded.ultimo_ejecucion_punto_id,
          updated_at                    = now();

  elsif v_dentro_radio is true then
    insert into public.ronda_punto_control_gps as cg (
      ronda_punto_id, ronda_base_id, incumplimientos_consecutivos,
      foto_requerida_proxima_visita, ultimo_ejecucion_punto_id
    ) values (
      v_ronda_punto_id, v_ronda_base_id, 0, false, p_ejecucion_punto_id
    )
    on conflict (ronda_punto_id) do update
      set incumplimientos_consecutivos  = 0,
          foto_requerida_proxima_visita = false,
          ultimo_ejecucion_punto_id     = excluded.ultimo_ejecucion_punto_id,
          updated_at                    = now();

  elsif v_tiene_gps and v_dentro_radio is false then
    insert into public.ronda_punto_control_gps as cg (
      ronda_punto_id, ronda_base_id, incumplimientos_consecutivos,
      foto_requerida_proxima_visita, ultimo_ejecucion_punto_id
    ) values (
      v_ronda_punto_id, v_ronda_base_id, 1, 1 >= v_umbral, p_ejecucion_punto_id
    )
    on conflict (ronda_punto_id) do update
      set incumplimientos_consecutivos  = cg.incumplimientos_consecutivos + 1,
          foto_requerida_proxima_visita = (cg.incumplimientos_consecutivos + 1) >= v_umbral,
          ultimo_ejecucion_punto_id     = excluded.ultimo_ejecucion_punto_id,
          updated_at                    = now()
      where cg.ultimo_ejecucion_punto_id is distinct from excluded.ultimo_ejecucion_punto_id;
  end if;

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
      'foto_control_gps',   v_snap_foto_control,
      'distancia_metros',   v_distancia_metros,
      'qr_modo',            v_qr_modo,
      'qr_verificado',      (v_qr_verificado_at is not null),
      'qr_exigible',        v_qr_exigible
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

-- ── 8. Detalle de supervisor: cómo se acreditó el punto ─────────────────────
-- Idéntica a 20260802100000 más los hechos QR por punto: modo congelado,
-- verificación, GPS del momento del scan e intentos inválidos. Con esto la
-- pregunta "¿cómo se acreditó este punto?" se responde completa:
-- QR válido + foto correcta + GPS precisión 74 m / fuera de radio.

create or replace function public.rondas_ejecucion_detalle_supervisor(p_ejecucion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_total       integer;
  v_completados integer;
  v_ejecucion   jsonb;
  v_puntos      jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select e.objetivo_id, e.puntos_total
    into v_objetivo_id, v_total
  from public.ronda_ejecuciones e
  where e.id = p_ejecucion_id;

  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  select count(*)
    into v_completados
  from public.ronda_ejecucion_puntos ep
  where ep.ronda_ejecucion_id = p_ejecucion_id
    and ep.estado <> 'pendiente';

  select jsonb_build_object(
    'id',                      e.id,
    'estado',                  e.estado,
    'resultado',               e.resultado,
    'iniciada_at',             e.iniciada_at,
    'finalizada_at',           e.finalizada_at,
    'fecha_operativa',         e.fecha_operativa,
    'iniciada_fuera_horario',  e.iniciada_fuera_horario,
    'puntos_total',            e.puntos_total,
    'puntos_completados',      v_completados,
    'porcentaje',              case when e.puntos_total = 0 then 0
                                    else round(v_completados * 100.0 / e.puntos_total)
                               end,
    'ronda_base_id',           e.ronda_base_id,
    'ronda_nombre',            e.snap_ronda_nombre,
    'snap_intervalo_minutos',  e.snap_intervalo_minutos,
    'snap_hora_inicio',        e.snap_hora_inicio,
    'objetivo_id',             e.objetivo_id,
    'objetivo_nombre',         o.nombre,
    'puesto_id',               e.puesto_id,
    'puesto_nombre',           pu.nombre,
    'guardia_id',              e.guardia_id,
    'guardia_nombre',          g.apellido || ', ' || g.nombre,
    'cerrada_por',             e.cerrada_por,
    'cerrada_por_nombre',      case when e.cerrada_por is null then null
                                    else cp.apellido || ', ' || cp.nombre end,
    'cerrada_at',              e.cerrada_at,
    'cerrada_motivo',          e.cerrada_motivo,
    'es_cierre_administrativo',(e.cerrada_por is not null)
  )
  into v_ejecucion
  from public.ronda_ejecuciones e
  join public.objetivos o  on o.id  = e.objetivo_id
  join public.puestos   pu on pu.id = e.puesto_id
  join public.usuarios  g  on g.id  = e.guardia_id
  left join public.usuarios cp on cp.id = e.cerrada_por
  where e.id = p_ejecucion_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ejecucion_punto_id',  ep.id,
        'ronda_punto_id',      ep.ronda_punto_id,
        'orden',               ep.orden,
        'nombre',              ep.snap_nombre,
        'estado',              ep.estado,
        'registrado_at',       ep.registrado_at,
        'comentario',          ep.comentario,
        'hay_novedad',         ep.hay_novedad,
        'requiere_foto',       ep.snap_foto_requerida,
        'politica_foto',       ep.snap_politica_foto,
        'foto_control_gps',    ep.snap_foto_control_gps,
        'requiere_gps',        ep.snap_gps_requerido,
        'config_latitud',      ep.snap_latitud,
        'config_longitud',     ep.snap_longitud,
        'config_radio_metros', ep.snap_radio_metros,
        'latitud',             ep.latitud,
        'longitud',            ep.longitud,
        'precision_metros',    ep.precision_metros,
        'distancia_metros',    ep.distancia_metros,
        'gps_ok',              ep.gps_ok,
        'dentro_radio',        ep.dentro_radio,
        'foto_ok',             ep.foto_ok,
        -- [QR] Hechos de la verificación física de esta visita.
        'qr_modo',              ep.snap_qr_modo,
        'qr_verificado_at',     ep.qr_verificado_at,
        'qr_distancia_metros',  ep.qr_distancia_metros,
        'qr_precision_metros',  ep.qr_precision_metros,
        'qr_intentos_invalidos',ep.qr_intentos_invalidos,
        'evidencias',          coalesce(ev.evidencias, jsonb_build_array())
      )
      order by ep.orden
    ),
    jsonb_build_array()
  )
  into v_puntos
  from public.ronda_ejecucion_puntos ep
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'id',             x.id,
               'tipo_evidencia', x.tipo_evidencia,
               'bucket',         x.bucket,
               'storage_path',   x.storage_path,
               'created_at',     x.created_at
             )
             order by x.created_at
           ) as evidencias
    from public.evidencias x
    where x.proceso_tipo = 'ronda'
      and x.proceso_id   = ep.id
  ) ev on true
  where ep.ronda_ejecucion_id = p_ejecucion_id;

  return jsonb_build_object(
    'contexto',  'ok',
    'ejecucion', v_ejecucion,
    'puntos',    v_puntos
  );
end;
$$;

-- ── 9. generar_qr_ronda_punto: emisión y regeneración (administración) ──────
-- La activación es deliberada, punto por punto: nada se genera masivamente.
-- Regenerar revoca la credencial anterior en la misma transacción; el QR viejo
-- deja de validar en el instante en que esta función retorna.

create function public.generar_qr_ronda_punto(
  p_ronda_punto_id uuid,
  p_regenerar      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_punto   record;
  v_activa  record;
  v_usuario uuid;
  v_token   text;
  v_codigo  text;
  v_id      uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  -- Lock del punto: serializa dos generaciones concurrentes (además del índice
  -- parcial único, que es la garantía dura).
  select rp.id, rp.ronda_base_id, rb.objetivo_id
    into v_punto
    from public.ronda_puntos rp
    join public.rondas_base rb on rb.id = rp.ronda_base_id
   where rp.id = p_ronda_punto_id
   for update of rp;

  if not found then
    return jsonb_build_object('contexto', 'punto_no_encontrado');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_punto.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  v_usuario := public.rondas_usuario_actual_id();

  select q.id, q.codigo_corto
    into v_activa
    from public.ronda_punto_qr q
   where q.ronda_punto_id = p_ronda_punto_id
     and q.activo;

  if found and not coalesce(p_regenerar, false) then
    -- Ya hay credencial activa y no se pidió regenerar: no se pisa nada. El
    -- cliente confirma con el usuario y reintenta con p_regenerar = true.
    return jsonb_build_object(
      'contexto', 'qr_ya_activo',
      'qr', jsonb_build_object('codigo_corto', v_activa.codigo_corto)
    );
  end if;

  if found then
    update public.ronda_punto_qr
       set activo       = false,
           revocado_por = v_usuario,
           revocado_at  = now()
     where id = v_activa.id;
  end if;

  -- Token de 256 bits: hex de sha256 sobre entropía criptográfica
  -- (gen_random_uuid usa pg_strong_random). Sin pgcrypto: sha256 y
  -- gen_random_uuid son nativos.
  v_token := encode(sha256(convert_to(
    gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text,
    'UTF8')), 'hex');
  v_codigo := upper(substr(encode(sha256(convert_to(
    gen_random_uuid()::text || clock_timestamp()::text,
    'UTF8')), 'hex'), 1, 6));

  insert into public.ronda_punto_qr (ronda_punto_id, token, codigo_corto, creado_por)
  values (p_ronda_punto_id, v_token, v_codigo, v_usuario)
  returning id into v_id;

  -- Auditoría en la tabla existente del dominio. El sufijo con el id de la
  -- credencial garantiza valor_anterior <> valor_nuevo aun si dos códigos
  -- cortos coincidieran.
  insert into public.ronda_puntos_auditoria (
    ronda_punto_id, ronda_base_id, campo, valor_anterior, valor_nuevo,
    origen, firma, modificado_por
  ) values (
    p_ronda_punto_id, v_punto.ronda_base_id, 'qr_credencial',
    case when v_activa.id is null then null
         else 'activo:' || v_activa.codigo_corto || ':' || substr(v_activa.id::text, 1, 8) end,
    'activo:' || v_codigo || ':' || substr(v_id::text, 1, 8),
    'manual', null, v_usuario
  );

  return jsonb_build_object(
    'contexto', case when v_activa.id is null then 'generado' else 'regenerado' end,
    'qr', jsonb_build_object(
      'id',           v_id,
      'token',        v_token,
      'codigo_corto', v_codigo,
      'created_at',   now()
    )
  );
end;
$$;

revoke all on function public.generar_qr_ronda_punto(uuid, boolean) from public;
revoke all on function public.generar_qr_ronda_punto(uuid, boolean) from anon;
grant execute on function public.generar_qr_ronda_punto(uuid, boolean) to authenticated;

-- ── 10. obtener_qr_ronda_punto: estado + datos de impresión ─────────────────
-- Devuelve el token SÓLO a quien puede administrar el punto: es lo que permite
-- "Ver / imprimir" sin regenerar (sin invalidar el cartel ya pegado). El texto
-- visible del cartel (objetivo/punto) sale de acá; el contenido del QR no
-- depende de ningún nombre.

create function public.obtener_qr_ronda_punto(p_ronda_punto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_punto record;
  v_qr    jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select rp.id, rp.nombre as punto_nombre, rp.qr_modo,
         rb.nombre as ronda_nombre, rb.objetivo_id,
         o.nombre as objetivo_nombre
    into v_punto
    from public.ronda_puntos rp
    join public.rondas_base rb on rb.id = rp.ronda_base_id
    join public.objetivos o    on o.id  = rb.objetivo_id
   where rp.id = p_ronda_punto_id;

  if not found then
    return jsonb_build_object('contexto', 'punto_no_encontrado');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_punto.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  select jsonb_build_object(
           'token',            q.token,
           'codigo_corto',     q.codigo_corto,
           'created_at',       q.created_at,
           'creado_por_nombre', case when u.id is null then null
                                     else u.apellido || ', ' || u.nombre end
         )
    into v_qr
    from public.ronda_punto_qr q
    left join public.usuarios u on u.id = q.creado_por
   where q.ronda_punto_id = p_ronda_punto_id
     and q.activo;

  return jsonb_build_object(
    'contexto',        'ok',
    'modo',            v_punto.qr_modo,
    'punto_nombre',    v_punto.punto_nombre,
    'ronda_nombre',    v_punto.ronda_nombre,
    'objetivo_nombre', v_punto.objetivo_nombre,
    'qr',              v_qr
  );
end;
$$;

revoke all on function public.obtener_qr_ronda_punto(uuid) from public;
revoke all on function public.obtener_qr_ronda_punto(uuid) from anon;
grant execute on function public.obtener_qr_ronda_punto(uuid) to authenticated;

-- ── 11. Auditoría: qr_modo se suma a los campos sensibles del trigger ───────
-- Idéntica a 20260813100000 más qr_modo en el early-return y en la lista de
-- campos: cambiar el modo cambia la vara del veredicto, igual que el radio.

create or replace function public.ronda_puntos_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_origen  text;
  v_firma   text;
  v_usuario uuid;
begin
  -- 1) Consumir el contexto y limpiarlo SIEMPRE, haya o no algo que auditar.
  v_origen := nullif(btrim(coalesce(new.ctx_cambio_origen, '')), '');
  v_firma  := nullif(btrim(coalesce(new.ctx_cambio_firma,  '')), '');

  new.ctx_cambio_origen := null;
  new.ctx_cambio_firma  := null;

  v_origen := coalesce(v_origen, 'manual');

  if v_origen not in ('manual', 'diagnostico_gps') then
    raise exception
      'ronda_punto_ctx_origen_invalido: origen de cambio no reconocido (%)', v_origen
      using errcode = 'check_violation';
  end if;

  if v_origen = 'manual' then
    if v_firma is not null then
      raise exception
        'ronda_punto_ctx_firma_sin_origen: una modificacion manual no lleva firma'
        using errcode = 'check_violation';
    end if;
  elsif v_firma is null then
    raise exception
      'ronda_punto_ctx_firma_faltante: el origen % exige firma del diagnostico', v_origen
      using errcode = 'check_violation';
  elsif length(v_firma) > 120 then
    raise exception
      'ronda_punto_ctx_firma_invalida: firma fuera de formato'
      using errcode = 'check_violation';
  end if;

  -- 2) Sin cambios sensibles no hay auditoría. [QR] qr_modo entra a la lista.
  if new.radio_metros   is not distinct from old.radio_metros
     and new.latitud    is not distinct from old.latitud
     and new.longitud   is not distinct from old.longitud
     and new.gps_requerido is not distinct from old.gps_requerido
     and new.qr_modo    is not distinct from old.qr_modo then
    return new;
  end if;

  v_usuario := public.rondas_usuario_actual_id();

  -- 3) Una fila por campo sensible efectivamente modificado.
  insert into public.ronda_puntos_auditoria (
    ronda_punto_id, ronda_base_id, campo, valor_anterior, valor_nuevo,
    origen, firma, modificado_por
  )
  select
    new.id, new.ronda_base_id, c.campo, c.anterior, c.nuevo,
    v_origen, v_firma, v_usuario
  from (values
    ('radio_metros',  old.radio_metros::text,   new.radio_metros::text),
    ('latitud',       old.latitud::text,        new.latitud::text),
    ('longitud',      old.longitud::text,       new.longitud::text),
    ('gps_requerido', old.gps_requerido::text,  new.gps_requerido::text),
    ('qr_modo',       old.qr_modo,              new.qr_modo)
  ) as c(campo, anterior, nuevo)
  where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
