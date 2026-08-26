-- Una ronda no puede exigir nada de antes de existir, ni sin puntos.
--
-- QUE PASO
-- El 26/08/2026 se crearon dos rondas de demostracion en un objetivo. El
-- evaluador mira dos dias hacia atras, y rondas_ventanas_programadas recorre
-- los turnos del rango contra las rondas ACTIVAS sin mirar cuando se creo cada
-- una. Resultado: una ronda creada a las 16:32 genero obligaciones del 24, del
-- 25 y del 26 antes de las 16:32.
--
-- A un vigilador real le aparecieron 28 alertas de agosto —el 100 % de sus
-- alertas de ronda del mes— por rondas que no existian cuando trabajo. Su
-- dimension Rondas paso a 16/183 y quedo a un paso de recibir un mensaje
-- reprochandole algo imposible.
--
-- Una de esas rondas ademas tenia CERO puntos y estaba activa: generaba
-- ventanas que nadie podia cumplir ni queriendo.
--
-- DONDE SE ARREGLA
-- En rondas_ventanas_programadas, que es la definicion UNICA de la obligacion.
-- Arreglarlo aca lo arregla en todos lados a la vez —el evaluador, el
-- historial y el Cumplimiento leen de ahi— y no deja ninguna copia que pueda
-- decir otra cosa.
--
-- QUE NO CAMBIA
-- Para toda ronda creada antes del periodo que se consulta, el resultado es
-- identico: lo unico que se quita son ventanas que preceden a la existencia de
-- la ronda, y esas nunca fueron exigibles. No se borra ninguna alerta.

begin;

-- ============================================================================
-- 1. LA DEFINICION DE LA OBLIGACION
-- ============================================================================

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

-- ============================================================================
-- 2. NO SE PUEDE ACTIVAR UNA RONDA SIN PUNTOS
-- ============================================================================
--
-- El default de `activo` pasa a false: una ronda nace como BORRADOR. Se
-- configura, se le cargan los puntos, y recien ahi se activa. Antes nacia
-- operativa y empezaba a exigir en el mismo instante en que se creaba, cuando
-- todavia no tenia ni un punto.

alter table public.rondas_base alter column activo set default false;

create or replace function public.rondas_base_exige_puntos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if new.activo and not exists (
    select 1 from public.ronda_puntos rp
     where rp.ronda_base_id = new.id and rp.activo
  ) then
    raise exception
      'No se puede activar una ronda sin puntos de control. Cargale al menos un punto y despues activala.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_rondas_base_exige_puntos on public.rondas_base;
create trigger trg_rondas_base_exige_puntos
  before insert or update of activo on public.rondas_base
  for each row execute function public.rondas_base_exige_puntos();

-- Y al reves: no se le puede sacar el ultimo punto a una ronda que esta activa.
-- Sin esto, la ronda quedaria operativa y vacia por la puerta de atras.
create or replace function public.ronda_puntos_no_dejar_ronda_vacia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ronda uuid := coalesce(new.ronda_base_id, old.ronda_base_id);
begin
  if exists (select 1 from public.rondas_base rb where rb.id = v_ronda and rb.activo)
     and not exists (
       select 1 from public.ronda_puntos rp
        where rp.ronda_base_id = v_ronda and rp.activo
     )
  then
    raise exception
      'La ronda esta activa y este era su ultimo punto. Desactiva la ronda primero.'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_ronda_puntos_no_dejar_ronda_vacia on public.ronda_puntos;
create trigger trg_ronda_puntos_no_dejar_ronda_vacia
  after update or delete on public.ronda_puntos
  for each row execute function public.ronda_puntos_no_dejar_ronda_vacia();

-- Las que ya estaban activas y vacias pasan a borrador. No se borra nada: se
-- las saca de operacion hasta que alguien les cargue los puntos.
update public.rondas_base rb
   set activo = false, updated_at = now()
 where rb.activo
   and not exists (
     select 1 from public.ronda_puntos rp
      where rp.ronda_base_id = rb.id and rp.activo
   );

-- ============================================================================
-- 3. SANEAR LAS ALERTAS QUE NUNCA DEBIERON EXISTIR
-- ============================================================================
--
-- Criterio GENERAL, sin ningun id ni nombre adentro: toda alerta cuya ventana
-- empieza antes de que su ronda existiera es invalida.
--
-- No se borran: se resuelven con un comentario que dice exactamente que paso.
-- Borrarlas dejaria la impresion de que nunca hubo un problema, y lo hubo.
-- Ademas la funcion corregida ya no genera esas ventanas, asi que estas filas
-- tampoco vuelven a aparecer en el Cumplimiento.

update public.ronda_alertas a
   set estado       = 'resuelta',
       resuelta_at  = now(),
       accion       = 'cierre_administrativo',
       comentario   = 'Saneamiento administrativo: obligacion anterior a la creacion de la ronda. '
                    || 'La ronda no existia cuando corria esa ventana, asi que no era exigible '
                    || 'y no se le atribuye a ningun vigilador.',
       updated_at   = now()
  from public.rondas_base rb
 where rb.id = a.ronda_base_id
   and a.estado = 'pendiente'
   and a.ventana_inicio < rb.created_at;

notify pgrst, 'reload schema';

commit;
