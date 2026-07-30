-- ============================================================================
-- RONDAS · Evaluador — consume la definición única de ventana + 2 correcciones
-- ============================================================================
--
-- Recrea `evaluar_ronda_alertas()` sobre `rondas_ventanas_programadas()`. El
-- bucle de ventanas deja de estar duplicado acá dentro: es el mismo conjunto que
-- lee el historial, así que ambos no pueden divergir.
--
-- Además corrige dos causas confirmadas de alertas pendientes que nadie puede
-- cerrar:
--
--   C1 · Objetivos de prueba. El evaluador recorría `turnos` sin joinear
--        `objetivos` ni filtrar `es_prueba`, contra la regla fijada en
--        20260717_objetivos_es_prueba.sql. Cada turno de prueba con una ronda
--        activa generaba una alerta por ventana vencida, para siempre. La
--        corrección viaja en `rondas_ventanas_programadas(NULL, …)`, que excluye
--        es_prueba en el alcance completo: acá no hay filtro nuevo que mantener.
--
--   C2 · Rondas suspendidas. `suspender_ronda()` registra la suspensión como
--        alerta pero NO toca `ronda_ejecuciones`, y el evaluador solo miraba
--        ejecuciones. Una ronda suspendida en un turno de 8 h con intervalo de
--        60' emitía 8 `no_iniciada` ADEMÁS de la `suspendida`. Ahora, si hay una
--        suspensión pendiente para (ronda, turno), la ventana no vuelve a
--        reclamarse como no iniciada: la suspendida ya es la alerta de esa
--        obligación y el supervisor la resuelve una sola vez.
--        Acotado a propósito: solo suprime `no_iniciada`. Si el vigilador
--        suspendió pero igual ejecutó y dejó la ronda abierta, la
--        `no_finalizada` se emite normalmente.
--
-- Se conserva sin cambios: idempotencia por (ronda_base_id, turno_id,
-- ventana_inicio, tipo), el catch-up por lookback, la asociación de la ejecución
-- tardía, el valor de retorno, la volatilidad y los grants (solo service_role).
-- No toca horas liquidables, asistencia, JWM ni la ejecución del vigilador.
--
-- Nota sobre comparaciones: la versión anterior convertía ambos lados a hora
-- local para compararlos. Acá se comparan `timestamptz` contra `timestamptz`,
-- que es la misma relación de orden sin la conversión intermedia.

begin;

create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tz            constant text := 'America/Argentina/Buenos_Aires';
  v_ahora         timestamptz := now();
  v_hoy           date := (now() at time zone v_tz)::date;
  v_lookback_dias int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_lookback_dias'), 2);

  r           record;
  v_ejec      record;
  v_tipo      text;
  v_ejec_id   uuid;
  v_afectadas int := 0;
begin
  for r in
    select *
    from public.rondas_ventanas_programadas(
      null,                              -- alcance completo (excluye es_prueba)
      v_hoy - v_lookback_dias,
      v_hoy
    )
  loop
    -- Solo ventanas ya vencidas.
    if v_ahora < r.vencimiento_at then
      continue;
    end if;

    -- Ejecución que "pertenece" a esta ventana: iniciada en [inicio, match_fin).
    -- Cada ejecución mapea a una sola ventana. Se ignoran las canceladas.
    select e.id, e.iniciada_at, e.finalizada_at, e.estado
      into v_ejec
      from public.ronda_ejecuciones e
     where e.ronda_base_id = r.ronda_base_id
       and e.turno_id      = r.turno_id
       and e.estado in ('en_curso', 'finalizada')
       and e.iniciada_at >= r.ventana_inicio
       and e.iniciada_at <  r.match_fin
     order by e.iniciada_at asc
     limit 1;

    if not found then
      v_tipo    := 'no_iniciada';
      v_ejec_id := null;
    elsif v_ejec.iniciada_at < r.vencimiento_at then
      -- Inicio a tiempo (dentro de tolerancia).
      if v_ejec.estado = 'en_curso'
         or (v_ejec.finalizada_at is not null and v_ejec.finalizada_at > r.vencimiento_at) then
        v_tipo    := 'no_finalizada';
        v_ejec_id := v_ejec.id;
      else
        v_tipo    := null;    -- finalizada a tiempo: sin alerta
      end if;
    else
      -- Inicio tardío: la ventana no se inició a tiempo. Se conserva el
      -- incumplimiento (no_iniciada) y se ASOCIA la ejecución tardía.
      v_tipo    := 'no_iniciada';
      v_ejec_id := v_ejec.id;
    end if;

    -- C2 · Suspensión declarada por el vigilador para esta ronda y turno.
    if v_tipo = 'no_iniciada' and exists (
      select 1
        from public.ronda_alertas a
       where a.ronda_base_id = r.ronda_base_id
         and a.turno_id      = r.turno_id
         and a.tipo          = 'suspendida'
         and a.estado        = 'pendiente'
    ) then
      v_tipo := null;
    end if;

    if v_tipo is not null then
      insert into public.ronda_alertas (
        objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
        tipo, ventana_inicio, ventana_fin, vencimiento_at
      ) values (
        r.objetivo_id, r.puesto_id, r.ronda_base_id, r.turno_id, r.guardia_id, v_ejec_id,
        v_tipo, r.ventana_inicio, r.ventana_fin, r.vencimiento_at
      )
      on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do update
        set ejecucion_id = coalesce(excluded.ejecucion_id, ronda_alertas.ejecucion_id),
            updated_at   = now()
        where ronda_alertas.estado = 'pendiente';

      v_afectadas := v_afectadas + 1;
    end if;
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
