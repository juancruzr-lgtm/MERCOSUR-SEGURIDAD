-- Puesta en marcha del monitoreo automático de rondas: limpieza de lo retroactivo
-- y corrección de la obligación de ronda en turnos sin obligación.
--
-- CONTEXTO
-- La migración 20260810180000 programó `evaluar_ronda_alertas()` con pg_cron. Esa
-- función nunca había corrido, así que su primera ejecución evaluó también los días
-- que caían dentro de la ventana de lookback y materializó 41 alertas de rondas
-- anteriores a la puesta en marcha. Son ciertas —esas rondas efectivamente no se
-- iniciaron— pero no son incidentes actuales: el monitoreo automático debe tener
-- efecto operativo desde su activación, no convertir el pasado en pendientes.
--
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 1. OBLIGACIÓN DE RONDA: TURNOS SIN OBLIGACIÓN NO GENERAN VENTANAS           ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- `rondas_ventanas_programadas()` recorría los turnos pidiendo sólo puesto y
-- guardia asignados. Un turno anulado, cancelado o reemplazado seguía generando
-- ventanas de ronda y, por lo tanto, alertas de "no iniciada": el turno ya no
-- existe operativamente pero el vigilador tenía la obligación de recorrerlo.
--
-- Mientras la evaluación no corría sola el defecto era latente. Con el cron activo
-- pasa a ser una alerta falsa cada 10 minutos, así que se corrige acá.
--
-- Se reutiliza la MISMA regla que ya aplica el resto del sistema —el equivalente
-- SQL de ESTADOS_SIN_OBLIGACION de lib/revision-operativa—, idéntica a la de
-- crear_turnos_posicion_objetivo, asignar_vigilador_turnos, la generación mensual
-- y la revisión operativa:
--
--     COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
--
-- No se crea una regla paralela ni una constante nueva.
--
-- El cambio viaja en esta única función, que es la fuente de las ventanas tanto
-- para `evaluar_ronda_alertas()` como para `listar_rondas_programadas_objetivo()`.
-- Corregirla acá alcanza para los dos caminos.
--
-- El resto del cuerpo se recrea textualmente igual al vigente en producción
-- (verificado byte a byte contra pg_proc.prosrc antes de tocarlo). La única
-- diferencia es la línea del filtro de estado.

create or replace function public.rondas_ventanas_programadas(
  p_objetivo_id uuid,            -- NULL = todos los objetivos (excluye es_prueba)
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id       uuid,
  objetivo_id    uuid,
  puesto_id      uuid,
  guardia_id     uuid,
  ronda_base_id  uuid,
  indice         integer,
  ventana_inicio timestamptz,
  ventana_fin    timestamptz,
  match_fin      timestamptz,
  vencimiento_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_tol_min int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_tolerancia_min'), 15);
  v_tol     interval;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;   -- inicio del turno (local)
  v_t_fin   timestamp;   -- fin del turno (local, +1 día si nocturno)
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_mf      timestamp;
  v_n       int;
begin
  v_tol := make_interval(mins => v_tol_min);

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return;
  end if;

  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin,
           t.objetivo_id, t.puesto_id, t.guardia_id
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between p_desde and p_hasta
      and (p_objetivo_id is null or t.objetivo_id = p_objetivo_id)
      -- Alcance completo: nunca objetivos de prueba. Objetivo explícito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
      -- Estados sin obligación: el turno ya no existe operativamente, así que
      -- tampoco hay obligación de recorrerlo. Misma regla que usa todo el sistema.
      and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
    loop
      v_interv := r_ronda.intervalo_minutos * interval '1 minute';

      if r_ronda.hora_inicio is null then
        v_base := v_t_ini;
      else
        v_base := r_turno.fecha + r_ronda.hora_inicio;
        -- Reposiciona la hora de inicio dentro de la ventana del turno (nocturno).
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;              -- fin de las obligaciones del turno

        v_vf := least(v_vi + v_interv, v_t_fin); -- deadline (acotado al turno)
        v_mf := v_vi + v_interv;                 -- límite de matching (sin acotar)

        turno_id       := r_turno.id;
        objetivo_id    := r_turno.objetivo_id;
        puesto_id      := r_turno.puesto_id;
        guardia_id     := r_turno.guardia_id;
        ronda_base_id  := r_ronda.id;
        indice         := v_n;
        ventana_inicio := v_vi           at time zone v_tz;
        ventana_fin    := v_vf           at time zone v_tz;
        match_fin      := v_mf           at time zone v_tz;
        vencimiento_at := (v_vf + v_tol) at time zone v_tz;
        return next;

        v_n := v_n + 1;
        exit when v_n > 10000;                  -- backstop defensivo
      end loop;
    end loop;
  end loop;

  return;
end;
$$;

comment on function public.rondas_ventanas_programadas(uuid, date, date) is
  'Ventanas de ronda exigibles por turno. Excluye objetivos de prueba en alcance '
  'completo y turnos en estados sin obligación (reemplazado/anulado/cancelado). '
  'Fuente única de ventanas para evaluar_ronda_alertas y listar_rondas_programadas_objetivo.';

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 2. CIERRE ADMINISTRATIVO DE LAS ALERTAS RETROACTIVAS                        ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- CRITERIO TEMPORAL
-- El instante de activación es la primera corrida real del job de pg_cron:
--
--     2026-08-10 16:40:00.120739+00   (13:40 hora Argentina)
--
-- tomado de cron.job_run_details y congelado acá como literal para que la
-- migración sea determinista y reproducible.
--
-- Se cierra una alerta sólo si cumple LAS DOS condiciones:
--
--   a) created_at    >= activación  → la creó la puesta en marcha del cron,
--                                     no es una de las 75 alertas históricas
--                                     anteriores, que no se tocan;
--   b) vencimiento_at <  activación  → la ronda venció ANTES de que existiera el
--                                     monitoreo automático.
--
-- La condición (b) es la que protege lo nuevo: cualquier alerta cuya ronda venza
-- desde la activación en adelante queda pendiente y sigue el circuito normal
-- —atender, pausar, justificar o resolver—, aunque el cron la haya creado en la
-- misma corrida.
--
-- QUÉ SE HACE Y QUÉ NO
-- No se borra nada. Se usa el ciclo de vida que ya existe: estado 'resuelta' con
-- accion 'cierre_administrativo', que ya es un valor válido del CHECK de
-- ronda_alertas y de ronda_alerta_intervenciones.
--
-- No se escribe fila en ronda_alerta_intervenciones: esa tabla exige
-- supervisor_id NOT NULL y no hay supervisor que haya intervenido. Atribuirlo a
-- una persona sería falsear la auditoría. El registro correcto es la propia
-- alerta con resuelta_por = NULL, que junto a accion = 'cierre_administrativo'
-- identifica de forma inequívoca un cierre de sistema y no de una persona.
--
-- Idempotente: al quedar en 'resuelta' dejan de cumplir el filtro estado =
-- 'pendiente', así que repetir la migración no vuelve a tocarlas.

do $$
declare
  v_activacion constant timestamptz := timestamptz '2026-08-10 16:40:00.120739+00';
  v_cerradas   bigint;
begin
  update public.ronda_alertas a
     set estado       = 'resuelta',
         resuelta_at  = now(),
         resuelta_por = null,
         accion       = 'cierre_administrativo',
         comentario   = 'Cierre administrativo por activación inicial del monitoreo '
                     || 'automático de rondas. Alerta correspondiente a período '
                     || 'anterior a la puesta en marcha.',
         updated_at   = now()
   where a.estado         = 'pendiente'
     and a.created_at    >= v_activacion
     and a.vencimiento_at <  v_activacion;

  get diagnostics v_cerradas = row_count;
  raise notice 'Cierre administrativo por activación: % alertas cerradas.', v_cerradas;
end $$;
