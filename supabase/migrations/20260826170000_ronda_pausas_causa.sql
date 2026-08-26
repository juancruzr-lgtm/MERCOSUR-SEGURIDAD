-- Causa estructurada de la pausa de una ronda.
--
-- POR QUE
-- En agosto 571 de 2035 ventanas exigibles quedaron bajo una pausa, y todas
-- figuraban como cumplidas porque el evaluador no emite alertas sobre una ronda
-- pausada. Los motivos son texto libre y conviven dos cosas opuestas:
--
--   "la pauso por que no se hace"        -> la ronda NO se estaba haciendo
--   "No le da ubicacion en los puntos"   -> el sistema no permitia hacerla
--
-- Excluir las dos premia "no la hago -> me la pausan -> desaparece". Incluir
-- las dos castiga a quien no podia. Y clasificar por palabras del motivo seria
-- una inferencia inventada que decide si una persona baja de categoria.
--
-- La unica salida honesta es que la causa la elija la persona que pausa, en el
-- momento en que pausa, cuando sabe por que lo hace.
--
-- QUE NO HACE
-- No toca ninguna pausa historica: quedan con causa null y se siguen tratando
-- como "sin clasificar", que es exactamente lo que son. No reinterpreta el
-- texto de ningun motivo. No modifica evaluar_ronda_alertas: una pausa sigue
-- suprimiendo alertas cualquiera sea su causa, porque eso es lo que pidio quien
-- la pauso. La atribucion se resuelve al medir, no al alertar.

begin;

-- ============================================================================
-- 1. COLUMNA
-- ============================================================================
--
-- Nullable a proposito: las pausas anteriores a esta migracion no tienen causa
-- y nadie puede inventarsela. Un default habria dado una respuesta que nadie
-- dio, sobre 571 ventanas de agosto.

alter table public.ronda_pausas
  add column if not exists causa text;

do $causa$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ronda_pausas_causa_valida'
  ) then
    alter table public.ronda_pausas
      add constraint ronda_pausas_causa_valida check (
        causa is null or causa in (
          'tecnica_gps',
          'configuracion',
          'no_aplica',
          'no_se_realiza',
          'capacitacion',
          'otra'
        )
      );
  end if;
end
$causa$;

comment on column public.ronda_pausas.causa is
  'Causa estructurada, elegida por quien pausa. null = pausa anterior a la '
  'clasificacion; NO se infiere del texto del motivo. Define si las ventanas '
  'cubiertas son atribuibles al vigilador (no_se_realiza) o no. Valores: '
  'tecnica_gps (el GPS no validaba los puntos), configuracion (la ronda estaba '
  'mal armada), no_aplica (no correspondia hacerla), no_se_realiza (se podia '
  'hacer y no se hacia), capacitacion (falta ensenar a hacerla), otra.';

create index if not exists idx_ronda_pausas_causa
  on public.ronda_pausas (causa);

-- ============================================================================
-- 2. pausar_ronda CON CAUSA OBLIGATORIA
-- ============================================================================
--
-- Sobrecarga de 4 argumentos. La de 3 no se borra —hay historial y no hay por
-- que romper nada— pero se le REVOCA la ejecucion: desde ahora toda pausa nueva
-- tiene causa, y una llamada vieja falla de forma visible en vez de crear
-- silenciosamente otra fila sin clasificar.

create or replace function public.pausar_ronda(
  p_ronda_base_id uuid,
  p_motivo        text,
  p_hasta_at      timestamptz,
  p_causa         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_usuario_id  uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_pausa       record;
  v_alertas_ant bigint;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select rb.objetivo_id, rb.puesto_id
    into v_objetivo_id, v_puesto_id
  from public.rondas_base rb
  where rb.id = p_ronda_base_id and rb.activo;
  if v_objetivo_id is null then
    return jsonb_build_object('contexto', 'ronda_no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('contexto', 'motivo_invalido');
  end if;

  -- La causa es obligatoria y cerrada. Sin esto no se puede saber despues si
  -- las ventanas que cubrio esta pausa eran exigibles o no.
  if p_causa is null or p_causa not in (
    'tecnica_gps', 'configuracion', 'no_aplica', 'no_se_realiza', 'capacitacion', 'otra'
  ) then
    return jsonb_build_object('contexto', 'causa_invalida');
  end if;

  if p_hasta_at is not null and p_hasta_at <= now() then
    return jsonb_build_object('contexto', 'hasta_invalido');
  end if;

  if exists (
    select 1 from public.ronda_pausas
    where ronda_base_id = p_ronda_base_id and activa = true
  ) then
    return jsonb_build_object('contexto', 'ya_pausada');
  end if;

  insert into public.ronda_pausas (
    ronda_base_id, objetivo_id, puesto_id, pausada_por, motivo, hasta_at, causa
  ) values (
    p_ronda_base_id, v_objetivo_id, v_puesto_id, v_usuario_id,
    trim(p_motivo), p_hasta_at, p_causa
  )
  returning * into v_pausa;

  select count(*) into v_alertas_ant
  from public.ronda_alertas
  where ronda_base_id = p_ronda_base_id
    and estado = 'pendiente';

  return jsonb_build_object(
    'contexto', 'ok',
    'pausa', jsonb_build_object(
      'id',              v_pausa.id,
      'ronda_base_id',   v_pausa.ronda_base_id,
      'objetivo_id',     v_pausa.objetivo_id,
      'puesto_id',       v_pausa.puesto_id,
      'pausada_por',     v_pausa.pausada_por,
      'pausada_por_nombre', (
        select u.apellido || ', ' || u.nombre
        from public.usuarios u where u.id = v_usuario_id
      ),
      'pausada_at',      v_pausa.pausada_at,
      'motivo',          v_pausa.motivo,
      'causa',           v_pausa.causa,
      'hasta_at',        v_pausa.hasta_at,
      'activa',          v_pausa.activa
    ),
    'alertas_pendientes_anteriores', v_alertas_ant
  );
end;
$fn$;

comment on function public.pausar_ronda(uuid, text, timestamptz, text) is
  'Pausa una ronda con causa estructurada obligatoria. La causa NO se deduce '
  'del motivo: la elige quien pausa, que es el unico que la sabe.';

revoke all on function public.pausar_ronda(uuid, text, timestamptz, text) from public;
revoke all on function public.pausar_ronda(uuid, text, timestamptz, text) from anon;
grant execute on function public.pausar_ronda(uuid, text, timestamptz, text) to authenticated;

-- La version sin causa deja de estar disponible. No se borra: se cierra.
revoke execute on function public.pausar_ronda(uuid, text, timestamptz) from authenticated;
revoke execute on function public.pausar_ronda(uuid, text, timestamptz) from anon;

-- ============================================================================
-- 3. listar_rondas_pausadas — devolver la causa
-- ============================================================================

create or replace function public.listar_rondas_pausadas(
  p_objetivo_id  uuid    default null,
  p_solo_activas boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_usuario_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'pausas', jsonb_build_array());
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'pausas', jsonb_build_array());
  end if;

  if p_objetivo_id is not null
     and not public.puede_administrar_rondas_objetivo(p_objetivo_id)
  then
    return jsonb_build_object('contexto', 'sin_permiso', 'pausas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'pausas', coalesce((
      select jsonb_agg(fila order by fila->>'activa' desc, fila->>'pausada_at' desc)
      from (
        select jsonb_build_object(
          'id',                     p.id,
          'ronda_base_id',          p.ronda_base_id,
          'ronda_nombre',           rb.nombre,
          'objetivo_id',            p.objetivo_id,
          'objetivo_nombre',        o.nombre,
          'puesto_id',              p.puesto_id,
          'puesto_nombre',          pu.nombre,
          'pausada_por',            p.pausada_por,
          'pausada_por_nombre',     up.apellido || ', ' || up.nombre,
          'pausada_at',             p.pausada_at,
          'motivo',                 p.motivo,
          'causa',                  p.causa,
          'hasta_at',               p.hasta_at,
          'activa',                 p.activa,
          'vigente',                (p.activa and (p.hasta_at is null or p.hasta_at > now())),
          'reactivada_por',         p.reactivada_por,
          'reactivada_por_nombre',
            case when p.reactivada_por is null then null
                 else ur.apellido || ', ' || ur.nombre end,
          'reactivada_at',          p.reactivada_at,
          'reactivada_comentario',  p.reactivada_comentario,
          'reactivacion_automatica', p.reactivacion_automatica
        ) as fila
        from public.ronda_pausas p
        join public.rondas_base rb on rb.id = p.ronda_base_id
        join public.objetivos    o on  o.id = p.objetivo_id
        join public.puestos     pu on pu.id = p.puesto_id
        join public.usuarios    up on up.id = p.pausada_por
        left join public.usuarios ur on ur.id = p.reactivada_por
        where (p_objetivo_id is null or p.objetivo_id = p_objetivo_id)
          and (not p_solo_activas or p.activa)
          and public.puede_administrar_rondas_objetivo(p.objetivo_id)
      ) sub
    ), jsonb_build_array())
  );
end;
$fn$;

revoke all on function public.listar_rondas_pausadas(uuid, boolean) from public;
revoke all on function public.listar_rondas_pausadas(uuid, boolean) from anon;
grant execute on function public.listar_rondas_pausadas(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
