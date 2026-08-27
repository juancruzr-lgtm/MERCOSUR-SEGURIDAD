-- ROLLBACK de 20260827120000_rondas_ausencia_no_exige.sql
--
-- Devuelve rondas_ventanas_programadas al estado anterior: vuelve a exigir
-- rondas en las jornadas con ausencia registrada. Es decir, REINTRODUCE el
-- doble castigo. Ejecutar solo si el filtro nuevo rompio algo peor.
--
-- No toca datos: la funcion es stable y no escribe nada.

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
as $fn$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_tol_min int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_tolerancia_min'), 15);
  v_tol     interval;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;   -- inicio del turno (local)
  v_t_fin   timestamp;   -- fin del turno (local, +1 dia si nocturno)
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
      -- Alcance completo: nunca objetivos de prueba. Objetivo explicito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos, rb.created_at
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
        -- Una ronda sin puntos no se puede cumplir. Aunque quedara activa por
        -- error, aca no genera obligacion: es la ultima barrera y esta en la
        -- autoridad, no en una pantalla que alguien puede saltear.
        and exists (
          select 1 from public.ronda_puntos rp
           where rp.ronda_base_id = rb.id and rp.activo
        )
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

        -- ── Nada anterior a la creacion de la ronda ────────────────────────
        -- No es un filtro de presentacion: es que esa obligacion NO EXISTIO.
        -- Nadie pudo haberla cumplido, asi que no puede contar como incumplida
        -- ni generar una alerta.
        if (v_vi at time zone v_tz) < r_ronda.created_at then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        v_vf := least(v_vi + v_interv, v_t_fin); -- deadline (acotado al turno)
        v_mf := v_vi + v_interv;                 -- limite de matching (sin acotar)

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
$fn$;

comment on function public.rondas_ventanas_programadas(uuid, date, date) is
  'Definicion unica de la obligacion de ronda: una fila por ventana programada. '
  'NO emite ventanas anteriores a rondas_base.created_at —esa obligacion no '
  'existio— ni de rondas sin puntos activos. La consumen evaluar_ronda_alertas(), '
  'listar_rondas_programadas_objetivo() y el Cumplimiento Operativo.';

revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';

commit;
