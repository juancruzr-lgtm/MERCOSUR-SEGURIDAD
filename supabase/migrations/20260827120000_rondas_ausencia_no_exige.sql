-- Una jornada con ausencia registrada no exige rondas.
--
-- QUE PASO
-- La auditoria del modelo de evaluacion encontro un doble castigo. Cuando un
-- vigilador falta, el turno sigue existiendo en la base con su puesto y su
-- guardia asignados. rondas_ventanas_programadas solo pide esas dos cosas, asi
-- que genera igual todas las ventanas de ese turno. Nadie las cumple —no habia
-- nadie— y quedan como rondas no realizadas.
--
-- Resultado: el mismo hecho, la ausencia, baja Asistencia Y baja Rondas. Un
-- turno de 12 horas con ronda cada hora convierte una falta en doce rondas
-- incumplidas.
--
-- En agosto de 2026 esto no se manifiesta: la unica persona con ausencia
-- registrada no tiene rondas asignadas. Pero aparece en cuanto haya una falta
-- en un objetivo con rondas, y entonces el numero seria indefendible.
--
-- LA REGLA
-- La falta primaria es la ausencia. Las rondas de esa jornada NO pertenecen al
-- universo evaluable de ese vigilador.
--
-- Esto NO borra rondas ni alertas historicas: define correctamente que se le
-- puede exigir a alguien que no estuvo. Una obligacion que nadie pudo cumplir
-- porque no habia nadie no es una obligacion incumplida.
--
-- DONDE SE ARREGLA
-- En rondas_ventanas_programadas, que es la definicion UNICA de la obligacion.
-- Arreglarlo aca lo arregla a la vez en el evaluador de alertas, en el
-- historial y en el Cumplimiento Operativo, y no deja ninguna copia que pueda
-- decir otra cosa. No se agrega ningun filtro en ninguna pantalla.
--
-- QUE ES UNA AUSENCIA, EXACTAMENTE
-- Una fila de registros_asistencia con tipo_registro = 'ausencia'. Es el unico
-- valor del CHECK que significa "no vino": los otros son fichaje_gps,
-- presente_manual, reemplazo y carga_manual, y todos ellos describen a alguien
-- que SI estuvo. No hay ambiguedad posible.
--
-- LO QUE NO ES UNA AUSENCIA, y por lo tanto SIGUE exigiendo rondas:
--   · trabajo y no dejo registro propio  -> eso es Registro en App
--   · el supervisor confirmo su asistencia -> estuvo, y hay quien lo afirma
--   · cierre automatico de salida        -> estuvo
-- En los tres casos la persona estaba en el objetivo y podia recorrerlo.

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
      -- ── La jornada con ausencia no exige rondas ───────────────────────────
      -- La falta primaria es la ausencia, y ya se cuenta en Asistencia. Cobrar
      -- ademas las rondas de un turno que la persona no trabajo es castigar dos
      -- veces el mismo hecho.
      and not exists (
        select 1
          from public.registros_asistencia ra
         where ra.turno_id = t.id
           and ra.tipo_registro = 'ausencia'
      )
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
  'existio—, ni de rondas sin puntos activos, ni de turnos con ausencia '
  'registrada —la falta primaria es la ausencia y ya se cuenta en Asistencia—. '
  'La consumen evaluar_ronda_alertas(), listar_rondas_programadas_objetivo() y '
  'el Cumplimiento Operativo.';

revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';

commit;
