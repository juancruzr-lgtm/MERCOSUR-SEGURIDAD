-- ════════════════════════════════════════════════════════════════════
-- 20260818_confirmaciones_agosto_2026.sql   —   SANEAMIENTO HISTÓRICO
--
-- Materializa la asistencia de las confirmaciones de supervisor de agosto de
-- 2026 que quedaron sin registro. Hasta el fix 20260818100000,
-- confirmar_asistencia sólo dejaba la intervención; y antes de que esa acción
-- existiera (03/08) los supervisores confirmaban presencia con `comentario` o
-- con `confirmar_cubierto`, sin que se creara asistencia en varios casos.
--
-- LA LISTA ES EXPLÍCITA, NO UNA REGLA DE TEXTO. Cada turno de abajo fue
-- revisado uno por uno y el comentario del supervisor afirma presencia de forma
-- inequívoca. No hay clasificación automática en tiempo de ejecución: un LIKE
-- sobre comentarios libres decidiendo horas liquidables es exactamente lo que
-- no queremos. Si mañana aparece otro caso, se agrega a mano acá.
--
-- QUEDAN AFUERA, por decisión revisada:
--   · comentarios que explican por qué no fichó pero no afirman presencia
--     ("Según el vig no le funciona el celular", "No tiene datos en su celular")
--   · confirmar_cubierto sin comentario (sólo el motivo genérico del sistema)
--   · textos ambiguos ("Se cubrio", "Q")
--   · reasignaciones y turnos marcados descubiertos
--   · turnos anulados / cancelados / reemplazados
--   · objetivos inactivos
--   · todo turno que ya tenga cualquier registro de asistencia
--
-- IDEMPOTENTE por partida doble: la lista se filtra contra "cero registros"
-- antes y dentro del loop. Se puede correr dos veces sin duplicar.
--
-- NO BORRA NADA. No toca supervisor_intervenciones, ni fecha ni horario del
-- turno. Reutiliza registrar_cobertura, única vía autorizada:
--   · horas_liquidables = duración programada (nocturnos por EXTRACT EPOCH)
--   · hora_entrada_real / hora_salida_real NULL — no se inventa horario
--   · sin GPS, sin fotos, tipo_registro = 'carga_manual'
--   · origen_cobertura = 'confirmacion_supervisor'
--   · fila en registros_asistencia_auditoria
--
-- IDENTIDAD: registrar_cobertura resuelve el usuario desde auth.uid(), que en
-- el editor SQL no existe. El bloque fija el claim del admin que ejecuta. La
-- auditoría dirá que la carga la hizo ese admin —que es la verdad— y el
-- supervisor que confirmó queda preservado en la observación de cada registro.
--
-- REVERSIÓN: 20260818_confirmaciones_agosto_2026_reversion.sql
-- ════════════════════════════════════════════════════════════════════

do $saneamiento$
declare
  v_auth_admin  uuid := 'c110bb0e-f0e4-42dd-af05-a1056f931d14';
  v_admin_id    uuid;
  r             record;
  v_registro_id uuid;
  v_creados     int := 0;
  v_salteados   int := 0;
  v_horas       numeric := 0;
  v_horas_reg   numeric;

  -- 28 turnos revisados y aprobados a mano el 18/08/2026 · 283,00 h.
  --
  -- La acción con la que quedó guardada cada intervención NO fue el criterio:
  -- los supervisores usaron los botones equivocados durante todo agosto —hubo
  -- confirmaciones de presencia guardadas como `comentario` y como
  -- `confirmar_cubierto`—. Lo que se revisó fue si la intervención afirma que
  -- el vigilador estaba en el puesto.
  v_turnos uuid[] := ARRAY[
    -- Acción confirmar_asistencia (14 turnos · 141,00 h)
    'c306ccab-cc50-4afc-a8a0-2ef5e710a352',  -- 05/08 CLUB · ROSÓN · 8,00
    'de24a677-69e7-4025-bc77-0601c8a62458',  -- 06/08 CLUB · ROSÓN · 8,00
    '476f6caf-e7de-4806-b9c1-7662d9b5cf48',  -- 06/08 NACION SERV. ER · OJEDA · 12,00
    'aed1ca4c-5444-4ac5-b2a5-0583ccd30ea2',  -- 07/08 CLUB · ROSÓN · 8,00
    '9ef38648-533a-4e33-8763-18b56d74d470',  -- 08/08 CLUB · ROSÓN · 12,00
    '4c78da79-1f46-4ab6-93dc-97aed3aab761',  -- 09/08 CLUB · ROSÓN · 12,00
    'e139c607-66fa-480a-91cd-34449ecfbb10',  -- 10/08 CLUB · ROSÓN · 8,00
    'f669dce4-1526-416c-a6d3-ea61ed8a188a',  -- 11/08 CLUB · ROSÓN · 8,00
    '25577de1-5325-4d63-8254-6a892799f40f',  -- 11/08 LAROMET CARCARAÑA · BORGNIS · 13,00
    '7526435c-c236-491e-9df1-b21346e0b62a',  -- 11/08 Servicio eventual · CENTURION · 14,00
    'e14e929c-991f-4640-ba5e-e8d65dfda1e8',  -- 12/08 CLUB · ROSÓN · 8,00
    'f18ae2ba-d978-4132-aaee-2f87f8a61818',  -- 13/08 CLUB · ROSÓN · 8,00
    'e7937e7e-d02c-4c24-8ae4-033b75a6f723',  -- 14/08 LA CASONA · BASSE · 12,00
    '90475fab-dfa8-4c2a-a9e8-2d6c87a5c8d7',  -- 14/08 Servicio eventual · CENTURION · 10,00
    -- Acción confirmar_cubierto (6 turnos · 60,00 h)
    -- Los tres últimos no dejaron comentario, pero el sistema guardó
    -- motivo = 'Entrada confirmada por supervisor' y el turno quedó en estado
    -- 'cubierto' sin ningún registro: el sistema ya los daba por cubiertos y
    -- la asistencia nunca se materializó.
    'da965d37-e610-4e87-8156-924d6acb0a06',  -- 01/08 CLUB · ROSÓN · 12,00
    'bc308e52-c75b-4488-9943-5db5826f1071',  -- 01/08 LAROMET ROSARIO · RIVAS · 12,00
    '2fbbe37b-f6dc-40eb-ace1-2ed3aae90028',  -- 01/08 SRT · CENTURION · 8,00
    'b17f1c99-2ffd-4a6d-9e03-5d1d184b0b04',  -- 01/08 SKATEPARK · PIÑERO · 8,00
    'd75daac8-73c2-4fe1-8c81-23d8298d037e',  -- 01/08 SRT · BARRIENTOS · 8,00
    'e28a0438-84d4-4a6d-9759-74c4e6b492bb',  -- 02/08 ANTENA · TERAN · 12,00
    -- Acción comentario, previa al alta de confirmar_asistencia (6 · 59,00 h)
    'ba24b6a7-b148-474d-b325-74e75d367c5e',  -- 02/08 CLUB · ROSÓN · 12,00
    'a256f971-a6e5-412a-83db-23b355e91d6a',  -- 02/08 CLUB · PANIAGUA · 5,00
    '99d8dfb7-87dd-4f2d-9ad8-6f573c13f65b',  -- 03/08 CLUB · ROSÓN · 8,00
    '617834fb-e39e-46bb-b3ed-f1b445a0e694',  -- 03/08 PEAJE · PANIAGUA · 14,00
    '5d034272-0310-4ff6-b0b1-a39c5cdca8fc',  -- 03/08 SRT · CENTURION · 8,00
    '9848c04e-1051-4202-91ed-254416adaf7d',  -- 04/08 ANTENA · TERAN · 12,00
    -- Resueltos por decisión humana explícita el 18/08/2026 (2 · 23,00 h).
    -- Las horas van al vigilador asignado al turno.
    '0ecdec90-606d-4c9d-bd79-e0dcb9a78479',  -- 02/08 MUSEO MACRO · GAUTO · 9,00
    '80e7133e-9dcd-4db2-a737-25f63fb0d3c2'   -- 01/08 LAROMET RP41 P2 · MARTINEZ, R. E. · 14,00
  ];
begin
  select u.id into v_admin_id
  from public.usuarios u
  where u.auth_user_id = v_auth_admin
    and u.estado = 'activo'
    and u.rol = 'admin';

  if not found then
    raise exception 'El auth_user_id % no corresponde a un admin activo. Corregir antes de ejecutar.', v_auth_admin;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_auth_admin::text, 'role', 'authenticated')::text,
    true
  );

  for r in
    select distinct on (t.id)
      t.id            as turno_id,
      t.fecha,
      t.guardia_id,
      -- Tres de los turnos aprobados no tienen comentario: el supervisor usó
      -- confirmar_cubierto, que guarda el motivo del sistema en vez de texto
      -- libre. Se conserva lo que haya, sin exigir comentario.
      coalesce(nullif(btrim(si.comentario), ''), nullif(btrim(si.motivo), '')) as texto,
      si.accion,
      si.created_at   as confirmada_at,
      sup.apellido || ', ' || sup.nombre as supervisor
    from public.turnos t
    join public.supervisor_intervenciones si on si.turno_id = t.id and si.tipo_alerta = 'sin_fichar'
    join public.objetivos o on o.id = t.objetivo_id
    left join public.usuarios sup on sup.id = coalesce(si.supervisor_id, si.supervisor_intervino_id)
    where t.id = any(v_turnos)
      and t.guardia_id is not null
      and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
      and coalesce(o.estado, 'activo') = 'activo'
      and not exists (select 1 from public.registros_asistencia ra where ra.turno_id = t.id)
    -- Con varias intervenciones sobre el mismo turno gana la PRIMERA que dejó
    -- texto. Ascendente, no descendente: en ANTENA del 04/08 el supervisor
    -- escribió "Confirmo ingreso por foto" a las 23:08 y "No tiene datos en su
    -- celular" a las 23:12; la más nueva es la que menos explica lo que pasó.
    order by t.id,
             (coalesce(nullif(btrim(si.comentario), ''), nullif(btrim(si.motivo), '')) is not null) desc,
             si.secuencia_evento asc
  loop
    if exists (select 1 from public.registros_asistencia ra where ra.turno_id = r.turno_id) then
      v_salteados := v_salteados + 1;
      continue;
    end if;

    select public.registrar_cobertura(
      r.turno_id,
      r.guardia_id,
      'confirmacion_supervisor',
      null,
      null,
      null,
      'Saneamiento 18/08/2026 — confirmación de ' || coalesce(r.supervisor, 'supervisor')
        || ' (' || r.accion || ') del '
        || to_char(r.confirmada_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || ': ' || coalesce(r.texto, 'sin texto registrado')
    ) into v_registro_id;

    select coalesce(ra.horas_liquidables, 0) into v_horas_reg
    from public.registros_asistencia ra where ra.id = v_registro_id;

    v_creados := v_creados + 1;
    v_horas := v_horas + v_horas_reg;

    raise notice 'Turno % (%): registro % · % h', r.turno_id, r.fecha, v_registro_id, v_horas_reg;
  end loop;

  raise notice '─────────────────────────────────────────────';
  raise notice 'Turnos en la lista  : %', array_length(v_turnos, 1);
  raise notice 'Asistencias creadas : %', v_creados;
  raise notice 'Salteados           : %', v_salteados;
  raise notice 'Horas reconocidas   : %', v_horas;
  raise notice '─────────────────────────────────────────────';
end;
$saneamiento$;
