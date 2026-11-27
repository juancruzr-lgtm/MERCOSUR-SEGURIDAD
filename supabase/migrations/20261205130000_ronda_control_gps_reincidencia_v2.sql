-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- RONDAS · Control por reincidencia GPS (v2, sobre el esquema de nov. 2026)
-- ============================================================================
--
-- Reemplaza a 20260802100000_ronda_control_gps_reincidencia.sql, que NUNCA se
-- aplicó en producción y que hoy NO debe aplicarse: sus `create or replace` de
-- iniciar_ronda, registrar_punto_ronda, rondas_ejecucion_json y
-- rondas_ejecucion_detalle_supervisor son anteriores al QR (20260905100000), a
-- la regla de validación aprobada (20261120120000) y a la operación compartida
-- (20261124120000), y los pisarían.
--
-- QUÉ HACE
--
--   Tras N registros GPS consecutivos fuera del radio en un mismo punto
--   (N = app_config 'ronda_control_gps_umbral', default 2 EN EL CÓDIGO), la
--   SIGUIENTE visita nace con el pedido de una foto de control. Registrada esa
--   visita con foto, el ciclo vuelve a cero.
--
--     visita fuera del radio      → racha 1           (no pasa nada)
--     visita fuera del radio      → racha 2           (se pide foto en la próxima)
--     visita siguiente            → FOTO PEDIDA       (snap_foto_control_gps)
--     esa visita llega con foto   → racha 0           (ciclo nuevo)
--
--   Y en cualquier momento: GPS dentro del radio o QR verificado → racha 0.
--
-- QUÉ CAMBIA RESPECTO DE LA VERSIÓN DE AGOSTO (y por qué)
--
--   1. NO redefine iniciar_ronda ni registrar_punto_ronda. Se engancha con dos
--      triggers sobre ronda_ejecucion_puntos:
--        · BEFORE INSERT  congela snap_foto_control_gps (lo que en agosto hacía
--                         el LEFT JOIN dentro de iniciar_ronda).
--        · AFTER UPDATE   mueve la racha cuando el punto sale de 'pendiente'
--                         (lo que en agosto era el bloque [CONTROL GPS] dentro
--                         de registrar_punto_ronda).
--      Así el QR, la regla aprobada (GPS dentro del radio O QR verificado O
--      foto aceptada) y el veredicto quedan EXACTAMENTE como están en
--      producción: ninguna de esas funciones se toca.
--
--   2. PIDE la foto, NO TRABA. En agosto la foto de control se sumaba al gate
--      'foto_pendiente' del servidor: sin foto, el punto no se podía registrar.
--      JC (20/10/2026): "el GPS falla; no puede ser que no se hagan". Ahora el
--      servidor no bloquea nunca por este control: la app muestra el pedido y
--      deja registrar igual. Si la visita de control se registra sin foto, el
--      pedido sigue vigente para la próxima (no se castiga, no se cierra).
--
--   3. El QR verificado cuenta como cumplimiento y RESETEA la racha (en agosto
--      el QR no existía). Un QR verificado en la visita de control también
--      cierra el ciclo: es una prueba física de presencia más fuerte que la foto.
--
--   4. Sólo cuenta como incumplimiento GPS: punto con GPS requerido (snapshot),
--      GPS válido capturado, dentro_radio = false y SIN QR verificado. En agosto
--      contaba también puntos con GPS opcional. Sin GPS (señal, permiso,
--      celular) NO cuenta ni resetea: la falla del celular no castiga.
--
--   5. Umbral 0 (o negativo) en app_config = sólo registrar la racha, sin pedir
--      foto: palanca de apagado sin migración. La migración NO escribe en
--      app_config; sin la clave rige 2.
--
--   6. La exigencia se congela sólo si el punto sigue con GPS requerido.
--
--   7. Lectura por alcance con puede_operar_rondas_objetivo (la misma que hoy
--      gobierna la lectura de ronda_puntos y ronda_ejecucion_puntos) + política
--      restrictiva acceso_bloqueado_baja + REVOKE de escritura/DELETE/TRUNCATE.
--
--   8. Cualquier error del control se absorbe con un WARNING: el registro del
--      punto nunca falla por culpa de este control.
--
--   9. rondas_ejecucion_json y rondas_ejecucion_detalle_supervisor se reescriben
--      desde su definición VIVA (pg_get_functiondef) agregando sólo la clave
--      'foto_control_gps'. Si la definición no tiene el ancla esperada, la
--      migración aborta.
--
-- HISTÓRICO: la columna nueva se agrega con default constante (sin reescritura
-- ni UPDATE de filas). Ninguna ejecución pasada se modifica; no hay backfill y
-- la racha de todos los puntos arranca en 0.
--
-- QUÉ NO TOCA: iniciar_ronda, registrar_punto_ronda, validar_qr_ronda_punto,
-- rondas_veredicto_punto, rondas_estado_foto_punto, reevaluar_punto_ronda,
-- rondas_resultado_ejecucion, politica_foto, alertas, asistencia, liquidación.
--
-- ROLLBACK      supabase/rollback/20261205130000_ronda_control_gps_reincidencia_v2_rollback.sql
-- VERIFICACIÓN  supabase/pruebas/rondas-control-gps/verificacion-20261205130000.sql
-- PRUEBAS       supabase/pruebas/rondas-control-gps/run.mjs (PGlite)
-- ============================================================================

begin;

-- ── 0. Precondiciones: el esquema que esta migración espera ────────────────
do $pre$
begin
  if to_regclass('public.ronda_punto_control_gps') is not null then
    raise exception 'control_gps_v2: ronda_punto_control_gps ya existe (¿se aplicó la versión de agosto?). Revisar antes de seguir.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ronda_ejecucion_puntos'
                and column_name = 'snap_foto_control_gps') then
    raise exception 'control_gps_v2: ronda_ejecucion_puntos.snap_foto_control_gps ya existe. Revisar antes de seguir.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ronda_ejecucion_puntos'
                    and column_name = 'qr_verificado_at') then
    raise exception 'control_gps_v2: falta el QR (20260905100000).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ronda_ejecucion_puntos'
                    and column_name = 'validado_por') then
    raise exception 'control_gps_v2: falta la regla aprobada (20261120120000).';
  end if;
  if to_regprocedure('public.puede_operar_rondas_objetivo(uuid)') is null then
    raise exception 'control_gps_v2: falta puede_operar_rondas_objetivo (20261124120000).';
  end if;
  if to_regprocedure('public.acceso_habilitado_actual()') is null then
    raise exception 'control_gps_v2: falta acceso_habilitado_actual().';
  end if;
end
$pre$;

-- ── 1. Estado por punto ─────────────────────────────────────────────────────
-- Estado operativo, no configuración: por eso NO va en ronda_puntos (su trigger
-- touch_ronda_base_desde_punto inflaría rondas_base.version y sus políticas de
-- UPDATE dejarían pisar el contador editando el punto).

create table public.ronda_punto_control_gps (
  ronda_punto_id                uuid primary key
                                references public.ronda_puntos(id) on delete cascade,
  ronda_base_id                 uuid not null
                                references public.rondas_base(id) on delete cascade,
  incumplimientos_consecutivos  integer not null default 0,
  foto_requerida_proxima_visita boolean not null default false,
  -- Última visita que movió la fila y qué fue. Trazabilidad; el detalle del
  -- evento (GPS, distancia, QR, foto) vive en ronda_ejecucion_puntos.
  ultimo_ejecucion_punto_id     uuid
                                references public.ronda_ejecucion_puntos(id) on delete set null,
  ultimo_evento                 text,
  updated_at                    timestamptz not null default now(),

  constraint ronda_punto_control_gps_contador_valido
    check (incumplimientos_consecutivos >= 0),
  constraint ronda_punto_control_gps_evento_valido
    check (ultimo_evento is null
           or ultimo_evento in ('fuera_radio', 'dentro_radio', 'qr', 'foto_control'))
);

comment on table public.ronda_punto_control_gps is
  'Racha de registros GPS consecutivos fuera del radio por punto de ronda. Al '
  'llegar al umbral (app_config ronda_control_gps_umbral, default 2; 0 = sólo '
  'registrar) la próxima visita PIDE una foto de control, sin trabar el '
  'registro. GPS dentro del radio, QR verificado o la visita de control con '
  'foto vuelven la racha a cero. La mueve sólo el trigger '
  'trg_ronda_control_gps_transicion.';

create index idx_ronda_punto_control_gps_ronda
  on public.ronda_punto_control_gps (ronda_base_id);

alter table public.ronda_punto_control_gps enable row level security;

-- Lectura: quien puede ver las rondas del objetivo (misma función que la
-- lectura de ronda_puntos / ronda_ejecucion_puntos en producción).
create policy "Admin supervisor lee control gps de su alcance"
on public.ronda_punto_control_gps
for select to authenticated
using (
  exists (
    select 1
      from public.rondas_base rb
     where rb.id = ronda_punto_control_gps.ronda_base_id
       and public.puede_operar_rondas_objetivo(rb.objetivo_id)
  )
);

create policy acceso_bloqueado_baja
on public.ronda_punto_control_gps
as restrictive
for all to authenticated
using ((select public.acceso_habilitado_actual()))
with check ((select public.acceso_habilitado_actual()));

-- Escritura: exclusivamente el trigger SECURITY DEFINER. Los DEFAULT
-- PRIVILEGES conceden INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER a toda
-- tabla nueva: se revoca todo y se concede sólo lectura.
revoke all on table public.ronda_punto_control_gps from public;
revoke all on table public.ronda_punto_control_gps from anon;
revoke all on table public.ronda_punto_control_gps from authenticated;
revoke all on table public.ronda_punto_control_gps from service_role;
grant select on table public.ronda_punto_control_gps to authenticated;
grant select on table public.ronda_punto_control_gps to service_role;

-- ── 2. Snapshot de la exigencia en la visita ────────────────────────────────
-- Default constante: las filas existentes NO se reescriben (PG ≥ 11 guarda el
-- default en el catálogo). Todas las visitas pasadas leen false.

alter table public.ronda_ejecucion_puntos
  add column snap_foto_control_gps boolean not null default false;

comment on column public.ronda_ejecucion_puntos.snap_foto_control_gps is
  'La visita nació con pedido de foto de control por reincidencia GPS. Lo '
  'congela el trigger trg_ronda_control_gps_snapshot al crear la visita. NO '
  'bloquea el registro: es un pedido. Independiente de snap_politica_foto.';

-- ── 3. Umbral ───────────────────────────────────────────────────────────────
-- Lee app_config sin escribirla. Clave ausente, vacía o no numérica → 2.
-- 0 o negativo → 0 = registrar la racha sin pedir foto.

create or replace function public.ronda_control_gps_umbral()
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce(
    (select case
              when btrim(c.value) ~ '^-?[0-9]{1,6}$' then greatest(0, btrim(c.value)::integer)
            end
       from public.app_config c
      where c.key = 'ronda_control_gps_umbral'),
    2);
$fn$;

revoke all on function public.ronda_control_gps_umbral() from public;
revoke all on function public.ronda_control_gps_umbral() from anon;
grant execute on function public.ronda_control_gps_umbral() to authenticated;
grant execute on function public.ronda_control_gps_umbral() to service_role;

-- ── 4. Trigger BEFORE INSERT: congelar el pedido al crear la visita ─────────
-- Corre para cualquier alta de ronda_ejecucion_puntos (hoy sólo iniciar_ronda).
-- Si la racha cambia después de iniciada la ronda, rige en la siguiente.

create or replace function public.ronda_control_gps_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if new.estado is distinct from 'pendiente' or new.ronda_punto_id is null then
    return new;
  end if;

  new.snap_foto_control_gps :=
       coalesce(new.snap_foto_control_gps, false)
    or (    coalesce(new.snap_gps_requerido, false)
        and public.ronda_control_gps_umbral() > 0
        and coalesce((select cg.foto_requerida_proxima_visita
                        from public.ronda_punto_control_gps cg
                       where cg.ronda_punto_id = new.ronda_punto_id), false));
  return new;
exception when others then
  -- El control nunca impide iniciar una ronda.
  raise warning 'control_gps: no se pudo congelar el pedido de foto (%): %', new.ronda_punto_id, sqlerrm;
  new.snap_foto_control_gps := coalesce(new.snap_foto_control_gps, false);
  return new;
end;
$fn$;

revoke all on function public.ronda_control_gps_snapshot() from public;
revoke all on function public.ronda_control_gps_snapshot() from anon;
revoke all on function public.ronda_control_gps_snapshot() from authenticated;

create trigger trg_ronda_control_gps_snapshot
before insert on public.ronda_ejecucion_puntos
for each row execute function public.ronda_control_gps_snapshot();

-- ── 5. Trigger AFTER UPDATE: transiciones de la racha ───────────────────────
-- Dispara sólo cuando la visita sale de 'pendiente' hacia un veredicto
-- (cumplido / incumplido / pendiente_validacion). Eso pasa una única vez por
-- visita: registrar_punto_ronda actualiza con `where estado = 'pendiente'`, bajo
-- `for update`, y un reintento devuelve 'ya_registrado' sin escribir. NO
-- dispara con: cierre administrativo (→ 'omitido'), re-evaluación por la IA
-- (pendiente_validacion → cumplido/incumplido), verificación QR (el punto
-- sigue 'pendiente') ni intentos de QR inválido.
--
-- Orden de evaluación:
--   1. Visita de control que llegó con foto     → racha 0 ('foto_control')
--   2. GPS dentro del radio                     → racha 0 ('dentro_radio')
--   3. QR verificado                            → racha 0 ('qr')
--   4. GPS requerido, GPS válido, fuera del
--      radio y sin QR                           → racha + 1 ('fuera_radio');
--                                                 al llegar al umbral se pide
--                                                 foto para la PRÓXIMA visita.
--   5. Cualquier otro caso (sin GPS, sin radio, GPS opcional fuera de radio):
--      no cuenta ni resetea.

create or replace function public.ronda_control_gps_transicion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_evento        text;
  v_ronda_base_id uuid;
  v_umbral        integer;
begin
  if old.estado is distinct from 'pendiente'
     or new.estado not in ('cumplido', 'incumplido', 'pendiente_validacion')
     or new.ronda_punto_id is null then
    return null;
  end if;

  if new.snap_foto_control_gps and new.foto_ok is true then
    v_evento := 'foto_control';
  elsif new.dentro_radio is true then
    v_evento := 'dentro_radio';
  elsif new.qr_verificado_at is not null then
    v_evento := 'qr';
  elsif coalesce(new.snap_gps_requerido, false)
        and new.latitud is not null
        and new.longitud is not null
        and new.dentro_radio is false then
    v_evento := 'fuera_radio';
  else
    return null;
  end if;

  begin
    if v_evento = 'fuera_radio' then
      v_ronda_base_id := (select e.ronda_base_id
                            from public.ronda_ejecuciones e
                           where e.id = new.ronda_ejecucion_id);
      -- El punto pudo borrarse de la configuración: sin punto no hay racha.
      if v_ronda_base_id is null
         or not exists (select 1 from public.ronda_puntos rp where rp.id = new.ronda_punto_id) then
        return null;
      end if;
      v_umbral := public.ronda_control_gps_umbral();

      insert into public.ronda_punto_control_gps as cg (
        ronda_punto_id, ronda_base_id, incumplimientos_consecutivos,
        foto_requerida_proxima_visita, ultimo_ejecucion_punto_id, ultimo_evento
      ) values (
        new.ronda_punto_id, v_ronda_base_id, 1,
        v_umbral > 0 and 1 >= v_umbral, new.id, v_evento
      )
      on conflict (ronda_punto_id) do update
        set incumplimientos_consecutivos  = cg.incumplimientos_consecutivos + 1,
            foto_requerida_proxima_visita = v_umbral > 0
                                            and (cg.incumplimientos_consecutivos + 1) >= v_umbral,
            ultimo_ejecucion_punto_id     = excluded.ultimo_ejecucion_punto_id,
            ultimo_evento                 = excluded.ultimo_evento,
            updated_at                    = now()
        -- Defensa extra contra doble conteo de la misma visita.
        where cg.ultimo_ejecucion_punto_id is distinct from excluded.ultimo_ejecucion_punto_id;
    else
      -- Reset: sólo si hay algo que resetear (no crea filas ni escribe de más).
      update public.ronda_punto_control_gps cg
         set incumplimientos_consecutivos  = 0,
             foto_requerida_proxima_visita = false,
             ultimo_ejecucion_punto_id     = new.id,
             ultimo_evento                 = v_evento,
             updated_at                    = now()
       where cg.ronda_punto_id = new.ronda_punto_id
         and (cg.incumplimientos_consecutivos <> 0 or cg.foto_requerida_proxima_visita);
    end if;
  exception when others then
    -- El control nunca hace fallar el registro del punto.
    raise warning 'control_gps: no se pudo actualizar la racha (%): %', new.ronda_punto_id, sqlerrm;
  end;

  return null;
end;
$fn$;

revoke all on function public.ronda_control_gps_transicion() from public;
revoke all on function public.ronda_control_gps_transicion() from anon;
revoke all on function public.ronda_control_gps_transicion() from authenticated;

create trigger trg_ronda_control_gps_transicion
after update of estado on public.ronda_ejecucion_puntos
for each row
when (old.estado = 'pendiente' and new.estado is distinct from 'pendiente')
execute function public.ronda_control_gps_transicion();

-- ── 6. Exponer el pedido: app del vigilador y detalle del supervisor ───────
-- Reescritura desde la definición VIVA agregando sólo la clave
-- 'foto_control_gps' antes de 'qr_modo'. La app ya la lee con default false.

do $do$
declare
  v_def   text;
  v_nuevo text;
begin
  -- rondas_ejecucion_json (vigilador)
  v_def := pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure);
  if position('foto_control_gps' in v_def) > 0 then
    raise exception 'control_gps_v2: rondas_ejecucion_json ya expone foto_control_gps; revisar';
  end if;
  if (select count(*) from regexp_matches(v_def, '''qr_modo'',\s+p\.snap_qr_modo,', 'g')) <> 1 then
    raise exception 'control_gps_v2: rondas_ejecucion_json cambió (sin ancla qr_modo); revisar antes de aplicar';
  end if;
  v_nuevo := regexp_replace(v_def,
    '(''qr_modo'',\s+p\.snap_qr_modo,)',
    '''foto_control_gps'',  p.snap_foto_control_gps,' || chr(10) || '          \1');
  execute v_nuevo;

  -- rondas_ejecucion_detalle_supervisor (supervisor)
  v_def := pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure);
  if position('foto_control_gps' in v_def) > 0 then
    raise exception 'control_gps_v2: rondas_ejecucion_detalle_supervisor ya expone foto_control_gps; revisar';
  end if;
  if (select count(*) from regexp_matches(v_def, '''qr_modo'',\s+ep\.snap_qr_modo,', 'g')) <> 1 then
    raise exception 'control_gps_v2: rondas_ejecucion_detalle_supervisor cambió (sin ancla qr_modo); revisar antes de aplicar';
  end if;
  v_nuevo := regexp_replace(v_def,
    '(''qr_modo'',\s+ep\.snap_qr_modo,)',
    '''foto_control_gps'',     ep.snap_foto_control_gps,' || chr(10) || '        \1');
  execute v_nuevo;
end
$do$;

notify pgrst, 'reload schema';

commit;
