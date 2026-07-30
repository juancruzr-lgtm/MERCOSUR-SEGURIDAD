-- ============================================================================
-- RONDAS · Ventanas programadas — definición única de la OBLIGACIÓN
-- ============================================================================
--
-- Hasta hoy, "qué rondas había que hacer" existía en un solo lugar y de forma
-- privada: el bucle interno de `evaluar_ronda_alertas()`. Esa lógica no era
-- consultable, así que el historial solo podía mostrar lo que alguien ejecutó
-- (`ronda_ejecuciones`) y una ronda jamás iniciada era, literalmente, la
-- ausencia de una fila.
--
-- Esta migración extrae ese cálculo a una función consultable, con el mismo
-- criterio que ya se aplicó a `rondas_turno_vigente()`: una sola definición
-- compartida. A partir de acá el evaluador de alertas y el historial derivan
-- del MISMO conjunto de ventanas, y por lo tanto no pueden contradecirse.
--
-- Ventanas:  base + N·intervalo, acotadas al turno. base = rondas_base.hora_inicio
--            (reposicionada dentro del turno; soporta nocturno) o, si es NULL,
--            el inicio del turno. NUNCA corre desde el ingreso/fichaje.
-- Deadline:  `ventana_fin` = fin de ventana acotado al turno.
--            `vencimiento_at` = ventana_fin + tolerancia (app_config, default 15').
-- Matching:  `match_fin` = ventana_inicio + intervalo SIN acotar. Es el límite
--            que decide a qué ventana pertenece una ejecución. Se devuelve
--            aparte de `ventana_fin` porque en la última ventana del turno los
--            dos valores difieren, y usar el acotado dejaría ejecuciones huérfanas.
--
-- Objetivos de prueba: se excluyen cuando se consulta el alcance completo
-- (p_objetivo_id NULL), tal como exige 20260717_objetivos_es_prueba.sql. Si se
-- pide UN objetivo explícitamente se devuelve tal cual, incluso si es de prueba:
-- quien abre el legajo de un objetivo de prueba quiere ver sus datos.
--
-- SIN efectos: es `stable`, no escribe nada. No toca asistencia, liquidables,
-- turnos, JWM ni la ejecución del vigilador.
--
-- Seguridad: helper interno. `security definer` con search_path fijo y SIN
-- grants a authenticated/anon: solo la pueden invocar otras funciones
-- SECURITY DEFINER (el evaluador y la RPC de historial), que aplican su propia
-- autorización antes de exponer datos.

begin;

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
  'Definición única de la obligación de ronda: una fila por ventana programada. '
  'La consumen evaluar_ronda_alertas() y listar_rondas_programadas_objetivo(). '
  'Helper interno: sin grants a clientes.';

revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';

commit;
