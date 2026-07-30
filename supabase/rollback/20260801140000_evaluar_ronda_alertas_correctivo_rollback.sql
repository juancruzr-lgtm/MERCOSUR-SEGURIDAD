-- ============================================================================
-- ROLLBACK de 20260801140000_evaluar_ronda_alertas_correctivo
-- ============================================================================
--
-- Restituye `evaluar_ronda_alertas()` exactamente como la dejó
-- 20260731110000_evaluar_ronda_alertas.sql: bucle de ventanas propio, sin filtro
-- de `objetivos.es_prueba` y sin la supresión por ronda suspendida.
--
-- CONSECUENCIA CONOCIDA de volver atrás: reaparecen las dos causas de ruido
-- documentadas en el correctivo — alertas de objetivos de prueba, y una alerta
-- `no_iniciada` por cada ventana de una ronda que el vigilador suspendió.
-- Las alertas ya creadas por la versión corregida NO se tocan.

begin;

create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tz            constant text := 'America/Argentina/Buenos_Aires';
  v_ahora         timestamp := (now() at time zone v_tz);
  v_tol_min       int := coalesce((select nullif(value, '')::int from public.app_config where key = 'ronda_alerta_tolerancia_min'), 15);
  v_lookback_dias int := coalesce((select nullif(value, '')::int from public.app_config where key = 'ronda_alerta_lookback_dias'), 2);
  v_tol           interval := make_interval(mins => v_tol_min);

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;
  v_t_fin   timestamp;
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_vto     timestamp;
  v_n       int;
  v_ejec    record;
  v_tipo    text;
  v_ejec_id uuid;
  v_afectadas int := 0;
begin
  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin, t.objetivo_id, t.puesto_id, t.guardia_id
    from public.turnos t
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between (v_ahora::date - v_lookback_dias) and v_ahora::date
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio then interval '1 day' else interval '0' end;

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
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;
        v_vf  := least(v_vi + v_interv, v_t_fin);
        v_vto := v_vf + v_tol;

        if v_ahora >= v_vto then
          select e.id,
                 (e.iniciada_at   at time zone v_tz) as ini_local,
                 (e.finalizada_at at time zone v_tz) as fin_local,
                 e.estado
          into v_ejec
          from public.ronda_ejecuciones e
          where e.ronda_base_id = r_ronda.id
            and e.turno_id      = r_turno.id
            and e.estado in ('en_curso', 'finalizada')
            and (e.iniciada_at at time zone v_tz) >= v_vi
            and (e.iniciada_at at time zone v_tz) <  v_vi + v_interv
          order by e.iniciada_at asc
          limit 1;

          if not found then
            v_tipo := 'no_iniciada';
            v_ejec_id := null;
          elsif v_ejec.ini_local < v_vto then
            if v_ejec.estado = 'en_curso'
               or (v_ejec.fin_local is not null and v_ejec.fin_local > v_vto) then
              v_tipo := 'no_finalizada';
              v_ejec_id := v_ejec.id;
            else
              v_tipo := null;
            end if;
          else
            v_tipo := 'no_iniciada';
            v_ejec_id := v_ejec.id;
          end if;

          if v_tipo is not null then
            insert into public.ronda_alertas (
              objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
              tipo, ventana_inicio, ventana_fin, vencimiento_at
            ) values (
              r_turno.objetivo_id, r_turno.puesto_id, r_ronda.id, r_turno.id, r_turno.guardia_id, v_ejec_id,
              v_tipo,
              v_vi  at time zone v_tz,
              v_vf  at time zone v_tz,
              v_vto at time zone v_tz
            )
            on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do update
              set ejecucion_id = coalesce(excluded.ejecucion_id, ronda_alertas.ejecucion_id),
                  updated_at   = now()
              where ronda_alertas.estado = 'pendiente';

            v_afectadas := v_afectadas + 1;
          end if;
        end if;

        v_n := v_n + 1;
        exit when v_n > 10000;
      end loop;
    end loop;
  end loop;

  return v_afectadas;
end;
$$;

revoke all on function public.evaluar_ronda_alertas() from public;
revoke all on function public.evaluar_ronda_alertas() from anon;
revoke all on function public.evaluar_ronda_alertas() from authenticated;
grant execute on function public.evaluar_ronda_alertas() to service_role;

notify pgrst, 'reload schema';

commit;
