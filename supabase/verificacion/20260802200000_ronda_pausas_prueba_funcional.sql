-- ============================================================================
-- PRUEBA FUNCIONAL CONTROLADA · 20260802200000_ronda_pausas
-- ============================================================================
--
-- Demuestra A, B, C, E y F de punta a punta contra el esquema real, con datos
-- de prueba creados dentro de la transacción y ROLLBACK final: no persiste
-- absolutamente nada. El bloque D verifica el predicado de supresión de push;
-- la comprobación del contador del endpoint está en el instructivo adjunto.
--
-- CÓMO EJECUTAR
--   1. Aplicar antes 20260802200000_ronda_pausas.sql (esta prueba no la aplica).
--   2. Pegar TODO este archivo en el SQL Editor de Supabase y ejecutar de una vez.
--   3. Leer la tabla final: una fila por aserción, columna `resultado`.
--      Si alguna fila dice FALLA, la implementación no cumple ese punto.
--   4. La transacción termina en ROLLBACK. Nada queda escrito.
--
-- QUÉ TOCA
--   · Crea (y descarta) 1 turno y 1 rondas_base sobre un objetivo y un puesto
--     REALES ya existentes, elegidos automáticamente. No modifica ninguna fila
--     preexistente.
--   · Ejecuta evaluar_ronda_alertas(), que recorre TODOS los objetivos. Las
--     alertas que genere para datos reales también se descartan en el ROLLBACK,
--     pero conviene correrlo fuera de horario pico.
--
-- IDENTIDAD
--   No se hace `set role`. Se fija solamente el claim JWT que lee auth.uid(),
--   así las RPCs SECURITY DEFINER resuelven el usuario y su alcance igual que
--   desde la app, mientras el script conserva privilegios para armar el fixture.

begin;

create temp table _res (
  n        int,
  bloque   text,
  paso     text,
  esperado text,
  obtenido text,
  ok       boolean
) on commit drop;

do $prueba$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_n  int := 0;

  -- Fixture
  v_admin_id    uuid;
  v_admin_auth  uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_guardia_id  uuid;
  v_turno_id    uuid := gen_random_uuid();
  v_rb          uuid;
  v_d0          date;

  -- Ventanas de referencia (índices 1..5 = 09:00..13:00)
  v_vi_09 timestamptz;   -- anterior a la pausa    → exigible
  v_vi_10 timestamptz;   -- dentro de la pausa     → pausada
  v_vi_11 timestamptz;   -- dentro de la pausa     → pausada
  v_vi_12 timestamptz;   -- dentro de la pausa     → pausada
  v_vi_13 timestamptz;   -- posterior a hasta_at   → exigible otra vez

  v_pausa_at timestamptz;
  v_hasta_at timestamptz;

  -- Intermedios
  v_json     jsonb;
  v_pausa_id uuid;
  v_rec      record;
  v_int      int;
  v_bool     boolean;
  v_txt      text;
  v_alerta_previa uuid;
begin
  ----------------------------------------------------------------------------
  -- FIXTURE
  ----------------------------------------------------------------------------

  -- Actor: un admin real, activo y con auth_user_id. Admin administra cualquier
  -- objetivo, así que la prueba no depende de supervisor_zonas.
  select u.id, u.auth_user_id into v_admin_id, v_admin_auth
  from public.usuarios u
  where u.rol = 'admin' and u.estado = 'activo' and u.auth_user_id is not null
  order by u.created_at
  limit 1;

  if v_admin_id is null then
    raise exception 'FIXTURE: no hay usuario admin activo con auth_user_id.';
  end if;

  -- Identidad que leerán auth.uid() y, por lo tanto, las RPCs.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin_auth::text)::text, true);

  if auth.uid() is distinct from v_admin_auth then
    raise exception 'FIXTURE: auth.uid() no tomó el claim (obtuvo %).', auth.uid();
  end if;

  -- Día de la ventana: ayer, para que TODAS las ventanas estén ya vencidas y
  -- dentro del lookback del evaluador (default 2 días).
  v_d0 := ((now() at time zone v_tz)::date) - 1;

  -- Objetivo activo, NO de prueba (el evaluador excluye es_prueba), con un
  -- puesto activo que NO tenga turnos ese día: así las únicas ventanas de la
  -- ronda del fixture son las del turno del fixture.
  select o.id, p.id into v_objetivo_id, v_puesto_id
  from public.objetivos o
  join public.puestos p on p.objetivo_id = o.id and p.activo
  where coalesce(o.es_prueba, false) = false
    and o.estado = 'activo'
    and not exists (select 1 from public.turnos t
                    where t.puesto_id = p.id and t.fecha = v_d0)
  order by o.created_at
  limit 1;

  if v_objetivo_id is null then
    raise exception 'FIXTURE: no se encontró objetivo activo no-prueba con un puesto libre de turnos el %.', v_d0;
  end if;

  -- Un guardia activo sin turno ese día, para no chocar con unicidades.
  select u.id into v_guardia_id
  from public.usuarios u
  where u.estado = 'activo'
    and not exists (select 1 from public.turnos t
                    where t.guardia_id = u.id and t.fecha = v_d0)
  order by u.created_at
  limit 1;

  if v_guardia_id is null then
    raise exception 'FIXTURE: no hay usuario activo libre de turno para %.', v_d0;
  end if;

  -- Turno del fixture. Se copia una fila real y se le cambian los campos que
  -- importan: así no hace falta conocer todas las columnas NOT NULL de turnos.
  create temp table _turno_fix on commit drop as
    select * from public.turnos limit 1;

  if not exists (select 1 from _turno_fix) then
    raise exception 'FIXTURE: turnos está vacía; no hay fila modelo que copiar.';
  end if;

  update _turno_fix set
    id          = v_turno_id,
    objetivo_id = v_objetivo_id,
    puesto_id   = v_puesto_id,
    guardia_id  = v_guardia_id,
    fecha       = v_d0,
    hora_inicio = '06:00',
    hora_fin    = '22:00';

  insert into public.turnos select * from _turno_fix;

  -- Ronda del fixture: base 08:00, cada 60'. Ventanas 08..21 (14 en total).
  insert into public.rondas_base
    (objetivo_id, puesto_id, nombre, intervalo_minutos, hora_inicio, activo)
  values
    (v_objetivo_id, v_puesto_id,
     'ZZ_PRUEBA_PAUSA_' || substr(gen_random_uuid()::text, 1, 8),
     60, '08:00', true)
  returning id into v_rb;

  -- Ventanas tomadas de la MISMA función que usan el evaluador y el historial.
  select ventana_inicio into v_vi_09 from public.rondas_ventanas_programadas(v_objetivo_id, v_d0, v_d0)
   where ronda_base_id = v_rb and turno_id = v_turno_id and indice = 1;
  select ventana_inicio into v_vi_10 from public.rondas_ventanas_programadas(v_objetivo_id, v_d0, v_d0)
   where ronda_base_id = v_rb and turno_id = v_turno_id and indice = 2;
  select ventana_inicio into v_vi_11 from public.rondas_ventanas_programadas(v_objetivo_id, v_d0, v_d0)
   where ronda_base_id = v_rb and turno_id = v_turno_id and indice = 3;
  select ventana_inicio into v_vi_12 from public.rondas_ventanas_programadas(v_objetivo_id, v_d0, v_d0)
   where ronda_base_id = v_rb and turno_id = v_turno_id and indice = 4;
  select ventana_inicio into v_vi_13 from public.rondas_ventanas_programadas(v_objetivo_id, v_d0, v_d0)
   where ronda_base_id = v_rb and turno_id = v_turno_id and indice = 5;

  if v_vi_13 is null then
    raise exception 'FIXTURE: la función de ventanas no devolvió las 6 primeras ventanas.';
  end if;

  -- La pausa cubre [10:00, 13:00): arranca EN la ventana 10 y termina JUSTO en
  -- el inicio de la 13, que por lo tanto vuelve a ser exigible.
  v_pausa_at := v_vi_10;
  v_hasta_at := v_vi_13;

  v_n := v_n + 1;
  insert into _res values (v_n, 'FIXTURE', 'Ventanas 09..13 resueltas y espaciadas 60 minutos',
    '5 timestamps consecutivos',
    format('%s · %s · %s · %s · %s', v_vi_09, v_vi_10, v_vi_11, v_vi_12, v_vi_13),
    coalesce(v_vi_10 - v_vi_09 = interval '60 min'
         and v_vi_13 - v_vi_12 = interval '60 min', false));

  ----------------------------------------------------------------------------
  -- BLOQUE A · PAUSAR UNA RONDA (RPC)
  ----------------------------------------------------------------------------

  v_json := public.pausar_ronda(v_rb, 'Corte de energía en el sector', now() + interval '2 hours');

  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'pausar_ronda devuelve contexto ok',
    'ok', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ok', false));

  v_pausa_id := (v_json->'pausa'->>'id')::uuid;

  select count(*) into v_int
  from public.ronda_pausas where ronda_base_id = v_rb and activa = true;

  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'Existe exactamente UNA pausa activa',
    '1', v_int::text, v_int = 1);

  select * into v_rec from public.ronda_pausas where id = v_pausa_id;

  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'Guarda usuario, motivo y hasta_at',
    format('pausada_por=%s · motivo exacto · hasta_at ≈ now()+2h', v_admin_id),
    format('pausada_por=%s · motivo=%s · hasta_at=%s', v_rec.pausada_por, v_rec.motivo, v_rec.hasta_at),
    coalesce(v_rec.pausada_por = v_admin_id
         and v_rec.motivo = 'Corte de energía en el sector'
         and v_rec.hasta_at between now() + interval '119 min' and now() + interval '121 min', false));

  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'pausada_at se registra al momento de pausar',
    'entre hace 1 minuto y ahora', v_rec.pausada_at::text,
    coalesce(v_rec.pausada_at between now() - interval '1 min' and now(), false));

  -- Segunda pausa activa sobre la misma ronda: rechazada por contrato.
  v_json := public.pausar_ronda(v_rb, 'Intento de segunda pausa simultánea');
  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'Segunda pausa activa rechazada',
    'ya_pausada', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ya_pausada', false));

  -- El índice parcial respalda la regla incluso si alguien inserta directo.
  begin
    insert into public.ronda_pausas
      (ronda_base_id, objetivo_id, puesto_id, pausada_por, motivo, activa)
    values (v_rb, v_objetivo_id, v_puesto_id, v_admin_id, 'Insert directo duplicado', true);
    v_txt := 'insert aceptado';
  exception when unique_violation then
    v_txt := 'unique_violation';
  end;

  v_n := v_n + 1;
  insert into _res values (v_n, 'A', 'El índice parcial bloquea dos pausas activas',
    'unique_violation', v_txt, v_txt = 'unique_violation');

  ----------------------------------------------------------------------------
  -- BLOQUE E · REACTIVACIÓN MANUAL
  ----------------------------------------------------------------------------

  v_json := public.reanudar_ronda(v_pausa_id, 'Energía restablecida');

  v_n := v_n + 1;
  insert into _res values (v_n, 'E', 'reanudar_ronda devuelve contexto ok',
    'ok', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ok', false));

  select * into v_rec from public.ronda_pausas where id = v_pausa_id;

  v_n := v_n + 1;
  insert into _res values (v_n, 'E', 'La pausa queda cerrada con usuario y comentario',
    'activa=false · reactivada_por=admin · comentario guardado · automática=false',
    format('activa=%s · reactivada_por=%s · comentario=%s · automática=%s',
           v_rec.activa, v_rec.reactivada_por, v_rec.reactivada_comentario, v_rec.reactivacion_automatica),
    coalesce(v_rec.activa = false
         and v_rec.reactivada_por = v_admin_id
         and v_rec.reactivada_comentario = 'Energía restablecida'
         and v_rec.reactivacion_automatica = false
         and v_rec.reactivada_at is not null, false));

  v_json := public.reanudar_ronda(v_pausa_id, 'Segundo intento');
  v_n := v_n + 1;
  insert into _res values (v_n, 'E', 'Reanudar una pausa ya cerrada se rechaza',
    'ya_reactivada', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ya_reactivada', false));

  -- Cerrada la anterior, se admite una nueva: el índice parcial solo prohíbe
  -- DOS activas a la vez, no el historial.
  v_json := public.pausar_ronda(v_rb, 'Segunda pausa, ya con la primera cerrada');
  v_n := v_n + 1;
  insert into _res values (v_n, 'E', 'Tras reanudar se admite una pausa nueva',
    'ok', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ok', false));

  select count(*) into v_int from public.ronda_pausas where ronda_base_id = v_rb;
  v_n := v_n + 1;
  insert into _res values (v_n, 'E', 'El historial conserva ambas pausas',
    '2', v_int::text, v_int = 2);

  ----------------------------------------------------------------------------
  -- PREPARACIÓN B/C/F · pausa histórica que cubre [10:00, 13:00) de ayer
  ----------------------------------------------------------------------------
  -- Se inserta directo, no por RPC: `pausar_ronda` exige hasta_at futuro, y acá
  -- hace falta una pausa fechada en el pasado para evaluar ventanas vencidas.

  delete from public.ronda_pausas where ronda_base_id = v_rb;

  insert into public.ronda_pausas
    (ronda_base_id, objetivo_id, puesto_id, pausada_por, pausada_at, motivo, hasta_at, activa)
  values
    (v_rb, v_objetivo_id, v_puesto_id, v_admin_id, v_pausa_at,
     'Pausa histórica para verificación de ventanas', v_hasta_at, true)
  returning id into v_pausa_id;

  ----------------------------------------------------------------------------
  -- BLOQUE B · ESTADO POR VENTANA EN EL HISTORIAL
  ----------------------------------------------------------------------------

  v_json := public.listar_rondas_programadas_objetivo(v_objetivo_id, v_d0, v_d0);

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'listar_rondas_programadas_objetivo responde ok',
    'ok', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ok', false));

  -- Ventana ANTERIOR a la pausa: sigue exigible.
  select value->>'estado' into v_txt
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and (value->>'ventana_inicio')::timestamptz = v_vi_09;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'Ventana 09:00 (anterior a la pausa) sigue exigible',
    'no_iniciada', coalesce(v_txt, '(sin fila)'), coalesce(v_txt = 'no_iniciada', false));

  select (value->>'pausada')::boolean into v_bool
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and (value->>'ventana_inicio')::timestamptz = v_vi_09;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'Ventana 09:00 no queda marcada como pausada',
    'false', coalesce(v_bool::text, '(null)'), coalesce(v_bool = false, false));

  -- Ventanas DENTRO de la pausa: estado pausada y anexo poblado.
  select count(*) into v_int
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and (value->>'ventana_inicio')::timestamptz in (v_vi_10, v_vi_11, v_vi_12)
    and value->>'estado' = 'pausada'
    and (value->>'pausada')::boolean = true;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'Ventanas 10/11/12 (dentro de la pausa) figuran pausadas',
    '3', v_int::text, v_int = 3);

  select value->>'pausa_motivo' into v_txt
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and (value->>'ventana_inicio')::timestamptz = v_vi_11;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'La ventana pausada expone el motivo de la pausa',
    'Pausa histórica para verificación de ventanas', coalesce(v_txt, '(null)'),
    coalesce(v_txt = 'Pausa histórica para verificación de ventanas', false));

  -- Ventana POSTERIOR al fin de la pausa: vuelve a estado normal.
  select value->>'estado' into v_txt
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and (value->>'ventana_inicio')::timestamptz = v_vi_13;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'Ventana 13:00 (posterior a hasta_at) vuelve a exigible',
    'no_iniciada', coalesce(v_txt, '(sin fila)'), coalesce(v_txt = 'no_iniciada', false));

  select count(*) into v_int
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and value->>'estado' = 'pausada';

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'Solo 3 ventanas del turno quedan pausadas',
    '3', v_int::text, v_int = 3);

  select count(*) into v_int
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id;

  v_n := v_n + 1;
  insert into _res values (v_n, 'B', 'La pausa no elimina ni duplica filas del historial',
    '14', v_int::text, v_int = 14);

  ----------------------------------------------------------------------------
  -- BLOQUE C · ALERTAS
  ----------------------------------------------------------------------------

  -- Alerta preexistente sobre una ventana que la pausa cubre: representa una
  -- alerta emitida ANTES de que el supervisor pausara. Debe sobrevivir intacta.
  insert into public.ronda_alertas
    (objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id,
     tipo, ventana_inicio, ventana_fin, vencimiento_at)
  values
    (v_objetivo_id, v_puesto_id, v_rb, v_turno_id, v_guardia_id,
     'no_iniciada', v_vi_11, v_vi_11 + interval '60 min', v_vi_11 + interval '75 min')
  returning id into v_alerta_previa;

  -- El evaluador real, sin filtros: recorre todo el alcance.
  perform public.evaluar_ronda_alertas();

  -- Ninguna alerta NUEVA sobre las ventanas pausadas sin alerta previa.
  select count(*) into v_int
  from public.ronda_alertas
  where ronda_base_id = v_rb and turno_id = v_turno_id
    and ventana_inicio in (v_vi_10, v_vi_12);

  v_n := v_n + 1;
  insert into _res values (v_n, 'C', 'El evaluador NO crea alertas para ventanas pausadas',
    '0', v_int::text, v_int = 0);

  -- La alerta previa sigue ahí, con su estado original.
  select estado into v_txt from public.ronda_alertas where id = v_alerta_previa;

  v_n := v_n + 1;
  insert into _res values (v_n, 'C', 'La alerta anterior a la pausa se conserva',
    'pendiente', coalesce(v_txt, '(borrada)'), coalesce(v_txt = 'pendiente', false));

  -- Las ventanas fuera de la pausa sí generan alerta.
  select count(*) into v_int
  from public.ronda_alertas
  where ronda_base_id = v_rb and turno_id = v_turno_id
    and ventana_inicio in (v_vi_09, v_vi_13);

  v_n := v_n + 1;
  insert into _res values (v_n, 'C', 'Las ventanas 09:00 y 13:00 sí generan alerta',
    '2', v_int::text, v_int = 2);

  ----------------------------------------------------------------------------
  -- BLOQUE F · REACTIVACIÓN AUTOMÁTICA
  ----------------------------------------------------------------------------
  -- La pausa histórica tenía hasta_at en el pasado. El evaluador (ejecutado
  -- arriba) debió normalizarla en su primer statement.

  select * into v_rec from public.ronda_pausas where id = v_pausa_id;

  v_n := v_n + 1;
  insert into _res values (v_n, 'F', 'La pausa vencida se normaliza sola',
    'activa=false · automática=true · sin usuario que la reanude',
    format('activa=%s · automática=%s · reactivada_por=%s',
           v_rec.activa, v_rec.reactivacion_automatica, coalesce(v_rec.reactivada_por::text, 'null')),
    coalesce(v_rec.activa = false
         and v_rec.reactivacion_automatica = true
         and v_rec.reactivada_por is null, false));

  v_n := v_n + 1;
  insert into _res values (v_n, 'F', 'reactivada_at toma el hasta_at vencido, no now()',
    v_hasta_at::text, v_rec.reactivada_at::text, coalesce(v_rec.reactivada_at = v_hasta_at, false));

  -- Normalizar NO cambia qué ventanas estaban cubiertas.
  v_json := public.listar_rondas_programadas_objetivo(v_objetivo_id, v_d0, v_d0);

  select count(*) into v_int
  from jsonb_array_elements(v_json->'rondas') value
  where (value->>'ronda_base_id')::uuid = v_rb
    and (value->>'turno_id')::uuid = v_turno_id
    and value->>'estado' = 'pausada';

  v_n := v_n + 1;
  insert into _res values (v_n, 'F', 'Tras normalizar, la cobertura histórica no cambia',
    '3', v_int::text, v_int = 3);

  ----------------------------------------------------------------------------
  -- BLOQUE D · PREDICADO DE SUPRESIÓN DE PUSH
  ----------------------------------------------------------------------------
  -- Réplica en SQL del filtro que aplica app/api/push/cron/route.ts sobre las
  -- pausas activas y vigentes. Verifica el criterio; el contador
  -- `omitidosPorPausa` del endpoint se comprueba con el instructivo adjunto.

  delete from public.ronda_pausas where ronda_base_id = v_rb;
  insert into public.ronda_pausas
    (ronda_base_id, objetivo_id, puesto_id, pausada_por, pausada_at, motivo, activa)
  values
    (v_rb, v_objetivo_id, v_puesto_id, v_admin_id, now() - interval '10 min',
     'Pausa vigente para verificación de supresión de push', true);

  -- Ventana que empieza dentro de 5': el cron debe saltearla.
  select count(*) into v_int
  from public.ronda_pausas p
  where p.activa = true
    and (p.hasta_at is null or p.hasta_at > now())
    and p.ronda_base_id = v_rb
    and (now() + interval '5 min') >= p.pausada_at
    and (p.hasta_at is null or (now() + interval '5 min') < p.hasta_at);

  v_n := v_n + 1;
  insert into _res values (v_n, 'D', 'El predicado del cron detecta la ventana pausada',
    '1', v_int::text, v_int = 1);

  -- Ventana anterior al inicio de la pausa: el cron NO debe saltearla.
  select count(*) into v_int
  from public.ronda_pausas p
  where p.activa = true
    and (p.hasta_at is null or p.hasta_at > now())
    and p.ronda_base_id = v_rb
    and (now() - interval '30 min') >= p.pausada_at
    and (p.hasta_at is null or (now() - interval '30 min') < p.hasta_at);

  v_n := v_n + 1;
  insert into _res values (v_n, 'D', 'Una ventana anterior a la pausa NO se suprime',
    '0', v_int::text, v_int = 0);

  -- Pausa ya vencida: deja de suprimir aunque siga con activa = true.
  update public.ronda_pausas
  set hasta_at = now() - interval '1 min'
  where ronda_base_id = v_rb and activa = true;

  select count(*) into v_int
  from public.ronda_pausas p
  where p.activa = true
    and (p.hasta_at is null or p.hasta_at > now())
    and p.ronda_base_id = v_rb;

  v_n := v_n + 1;
  insert into _res values (v_n, 'D', 'Una pausa vencida deja de suprimir push de inmediato',
    '0', v_int::text, v_int = 0);

  ----------------------------------------------------------------------------
  -- CONTROL DE ALCANCE
  ----------------------------------------------------------------------------

  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid()::text)::text, true);

  v_json := public.pausar_ronda(v_rb, 'Intento sin usuario válido');
  v_n := v_n + 1;
  insert into _res values (v_n, 'ALCANCE', 'Sin usuario válido, pausar_ronda no ejecuta',
    'sin_usuario', v_json->>'contexto', coalesce((v_json->>'contexto') = 'sin_usuario', false));

  v_json := public.listar_rondas_pausadas(null, true);
  v_n := v_n + 1;
  insert into _res values (v_n, 'ALCANCE', 'Sin usuario válido, el listado no devuelve pausas',
    'sin_usuario', v_json->>'contexto', coalesce((v_json->>'contexto') = 'sin_usuario', false));

  v_n := v_n + 1;
  insert into _res values (v_n, 'ALCANCE', 'Sin usuario válido, el array de pausas viene vacío',
    '0', jsonb_array_length(v_json->'pausas')::text,
    jsonb_array_length(v_json->'pausas') = 0);

  -- Se restituye la identidad del admin.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin_auth::text)::text, true);

  v_json := public.listar_rondas_pausadas(null, false);
  v_n := v_n + 1;
  insert into _res values (v_n, 'ALCANCE', 'El admin sí ve el historial de pausas',
    'ok', v_json->>'contexto', coalesce((v_json->>'contexto') = 'ok', false));

end
$prueba$;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ RESULTADO                                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

select
  n,
  bloque,
  case when ok then 'PASA' else '>>> FALLA <<<' end as resultado,
  paso,
  esperado,
  obtenido
from _res
order by n;

rollback;
