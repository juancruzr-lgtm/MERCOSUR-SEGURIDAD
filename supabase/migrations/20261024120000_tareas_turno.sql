-- Tareas del turno del vigilador, generadas desde el protocolo.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- El protocolo de cada objetivo dice cosas que el vigilador hace en su turno:
-- al ingresar (conectar la cámara, retirar las llaves), durante (anunciar
-- visitas) o al retirarse (cerrar pisos, activar la alarma). El checklist que
-- existe es de SUPERVISIÓN, y las rondas sirven para pasar por lugares con una
-- frecuencia: ninguno de los dos es una lista de tareas del turno. Esto es esa
-- lista, lo más simple posible.
--
-- ── Flujo (reutiliza la Etapa 2 de protocolos) ───────────────────────────────
--  1. La IA identifica las instrucciones del protocolo y propone un control
--     por instrucción (20261023120000/130000). Las de destino «tarea_turno»
--     son tareas del vigilador.
--  2. Una persona las valida y aprueba (Aldo / quien prepara protocolos).
--  3. Gerencia las ACTIVA, sólo desde una versión vigente, eligiendo el
--     momento (ingreso / durante / egreso) y si piden evidencia (nada,
--     comentario o foto). Si ya hay una tarea activa con el mismo texto en
--     el objetivo y puesto, se reutiliza: no hay duplicados.
--  4. El vigilador ve las tareas de sus turnos en la tarjeta del turno y
--     marca cada una: hecha, no aplica o no pude (con motivo). Nunca bloquea
--     el ingreso, el egreso ni el fichaje.
--  5. Supervisión ve, por objetivo, qué se hizo en cada turno y qué no.
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────────
-- No alimenta Mi Desempeño: nada del cumplimiento operativo lee estas tablas,
-- y la foto se guarda en `evidencias` con tipo_evidencia = 'tarea_turno', que
-- el análisis de IA no procesa (sólo libro, uniforme y puntos de ronda). No
-- toca rondas, alertas, liquidación ni el texto de los protocolos.
--
-- Reutiliza: auth, turnos, objetivos, puestos, protocolo_turnos_habilitados()
-- (los turnos de ayer/hoy/mañana del vigilador), evidencias (proceso_tipo
-- 'protocolo', que ya estaba en el CHECK) y el bucket privado ronda-evidencias.
-- Requiere 20261023120000 y 20261023130000.
-- Rollback: supabase/rollback/20261024120000_tareas_turno_rollback.sql

begin;

-- ============================================================================
-- 1. DEFINICIONES (qué tareas tiene el objetivo)
-- ============================================================================

create table if not exists public.tareas_turno_definiciones (
  id                     uuid primary key default gen_random_uuid(),
  objetivo_id            uuid not null references public.objetivos(id) on delete restrict,
  -- NULL = para todos los puestos del objetivo.
  puesto_id              uuid references public.puestos(id) on delete restrict,
  momento                text not null check (momento in ('ingreso', 'durante', 'egreso')),
  texto                  text not null check (length(btrim(texto)) between 1 and 300),
  evidencia              text not null default 'ninguna' check (evidencia in ('ninguna', 'comentario', 'foto')),
  orden                  integer not null default 0,
  activo                 boolean not null default true,
  -- De dónde sale: la instrucción del protocolo y el control aprobado.
  instruccion_id         uuid references public.protocolo_instrucciones(id) on delete restrict,
  control_id             uuid unique references public.protocolo_controles_propuestos(id) on delete restrict,
  activado_por           uuid references public.usuarios(id) on delete restrict,
  activado_at            timestamptz not null default now(),
  desactivado_por        uuid references public.usuarios(id) on delete restrict,
  desactivado_at         timestamptz,
  motivo_desactivacion   text,
  constraint tarea_desactivada_completa check (
    activo or (desactivado_at is not null and desactivado_por is not null
               and length(btrim(coalesce(motivo_desactivacion, ''))) > 0)
  )
);

create index if not exists idx_tareas_turno_def_objetivo
  on public.tareas_turno_definiciones (objetivo_id, activo);

comment on table public.tareas_turno_definiciones is
  'Tareas del turno del vigilador por objetivo (y puesto), activadas por Gerencia '
  'desde controles aprobados del protocolo. No alimentan Mi Desempeno.';

-- ============================================================================
-- 2. REGISTROS (qué hizo el vigilador en cada turno)
-- ============================================================================
-- turno_id sin FK a propósito (mismo criterio que protocolo_aperturas): es
-- contexto y una FK haría chocar el borrado de un turno con la inmutabilidad.

create table if not exists public.tareas_turno_registros (
  id             uuid primary key default gen_random_uuid(),
  definicion_id  uuid not null references public.tareas_turno_definiciones(id) on delete restrict,
  turno_id       uuid not null,
  objetivo_id    uuid not null references public.objetivos(id) on delete restrict,
  empleado_id    uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id   uuid not null,
  -- Copia de lo que se le pidió: el registro se sostiene solo.
  momento        text not null,
  texto_tarea    text not null,
  estado         text not null check (estado in ('hecha', 'no_aplica', 'no_pude')),
  comentario     text check (comentario is null or length(comentario) <= 1000),
  registrado_at  timestamptz not null default now(),
  constraint tarea_registro_unico unique (turno_id, definicion_id),
  constraint tarea_registro_motivo check (estado = 'hecha' or length(btrim(coalesce(comentario, ''))) > 0)
);

create index if not exists idx_tareas_turno_reg_objetivo
  on public.tareas_turno_registros (objetivo_id, registrado_at desc);
create index if not exists idx_tareas_turno_reg_turno
  on public.tareas_turno_registros (turno_id);

comment on table public.tareas_turno_registros is
  'Lo que el vigilador marco en cada tarea de su turno. Inmutable. No es '
  'calificacion: sirve para supervision y seguimiento.';

-- ============================================================================
-- 3. INTEGRIDAD
-- ============================================================================

drop trigger if exists trg_tareas_turno_reg_inmutable on public.tareas_turno_registros;
create trigger trg_tareas_turno_reg_inmutable
  before update or delete on public.tareas_turno_registros
  for each row execute function public.protocolo_registro_inmutable();
drop trigger if exists trg_tareas_turno_reg_sin_truncate on public.tareas_turno_registros;
create trigger trg_tareas_turno_reg_sin_truncate
  before truncate on public.tareas_turno_registros
  for each statement execute function public.protocolo_registro_inmutable();

-- Definiciones: lo que se le pidió al personal no cambia; sólo se desactiva.
create or replace function public.tareas_turno_def_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_puesto_objetivo uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Las tareas del turno no se borran: desactivar con motivo' using errcode = '42501';
  end if;
  if new.puesto_id is not null then
    v_puesto_objetivo := (select p.objetivo_id from public.puestos p where p.id = new.puesto_id);
    if v_puesto_objetivo is distinct from new.objetivo_id then
      raise exception 'El puesto no pertenece al objetivo' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.objetivo_id is distinct from old.objetivo_id or new.puesto_id is distinct from old.puesto_id
       or new.momento is distinct from old.momento or new.texto is distinct from old.texto
       or new.evidencia is distinct from old.evidencia or new.instruccion_id is distinct from old.instruccion_id
       or new.control_id is distinct from old.control_id or new.activado_at is distinct from old.activado_at then
      raise exception 'Una tarea activada no cambia: desactivarla y activar otra' using errcode = '42501';
    end if;
    if not old.activo and new.activo then
      raise exception 'Una tarea desactivada no se reactiva: activar otra' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_tareas_turno_def_proteger on public.tareas_turno_definiciones;
create trigger trg_tareas_turno_def_proteger
  before insert or update or delete on public.tareas_turno_definiciones
  for each row execute function public.tareas_turno_def_proteger();
drop trigger if exists trg_tareas_turno_def_sin_truncate on public.tareas_turno_definiciones;
create trigger trg_tareas_turno_def_sin_truncate
  before truncate on public.tareas_turno_definiciones
  for each statement execute function public.protocolo_registro_inmutable();

-- Un control de tarea del turno también puede quedar «activado».
alter table public.protocolo_controles_propuestos
  add column if not exists tarea_definicion_id uuid references public.tareas_turno_definiciones(id) on delete restrict;
alter table public.protocolo_controles_propuestos drop constraint if exists protocolo_control_activado_completo;
alter table public.protocolo_controles_propuestos add constraint protocolo_control_activado_completo check (
  estado <> 'activado' or (
    activado_por is not null and activado_at is not null and (
         (destino = 'checklist_supervision' and plantilla_id is not null and checklist_item_id is not null)
      or (destino = 'tarea_turno' and tarea_definicion_id is not null)
    )
  )
);

-- Evidencia de tareas en `evidencias` (proceso_tipo 'protocolo'): la ruta y
-- los metadatos los decide la base, como en las rondas.
create or replace function public.tareas_turno_validar_evidencia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_reg public.tareas_turno_registros%rowtype;
begin
  if new.proceso_tipo <> 'protocolo' then
    return new;
  end if;
  v_reg := (select r from public.tareas_turno_registros r where r.id = new.proceso_id);
  if v_reg.id is null then
    raise exception 'Registro de tarea inexistente';
  end if;
  if new.tipo_evidencia <> 'tarea_turno' then
    raise exception 'Tipo de evidencia de tarea invalido';
  end if;
  if new.bucket <> 'ronda-evidencias' then
    raise exception 'Bucket de evidencia de tarea invalido';
  end if;
  if new.storage_path <> 'tareas-turno/' || v_reg.id::text || '/foto' then
    raise exception 'Ruta de evidencia de tarea invalida';
  end if;
  -- El IF anidado hace que la consulta a storage.objects se planifique sólo
  -- donde existe (en las pruebas locales no hay esquema storage).
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects o where o.bucket_id = new.bucket and o.name = new.storage_path) then
      raise exception 'El archivo de evidencia no existe en Storage';
    end if;
  end if;
  new.turno_id    := case when exists (select 1 from public.turnos t where t.id = v_reg.turno_id) then v_reg.turno_id end;
  new.guardia_id  := v_reg.empleado_id;
  new.objetivo_id := v_reg.objetivo_id;
  return new;
end;
$fn$;

drop trigger if exists trg_tareas_turno_validar_evidencia on public.evidencias;
create trigger trg_tareas_turno_validar_evidencia
  before insert or update on public.evidencias
  for each row execute function public.tareas_turno_validar_evidencia();

-- ============================================================================
-- 4. PERMISOS Y RLS
-- ============================================================================

alter table public.tareas_turno_definiciones enable row level security;
alter table public.tareas_turno_registros    enable row level security;
revoke all on table public.tareas_turno_definiciones from anon, authenticated;
revoke all on table public.tareas_turno_registros    from anon, authenticated;
grant select on table public.tareas_turno_definiciones to authenticated;
grant select on table public.tareas_turno_registros    to authenticated;

drop policy if exists "Tareas del turno: definiciones para quien gestiona el objetivo" on public.tareas_turno_definiciones;
create policy "Tareas del turno: definiciones para quien gestiona el objetivo"
  on public.tareas_turno_definiciones for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

drop policy if exists "Tareas del turno: registros propios" on public.tareas_turno_registros;
create policy "Tareas del turno: registros propios"
  on public.tareas_turno_registros for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Tareas del turno: registros para quien gestiona el objetivo" on public.tareas_turno_registros;
create policy "Tareas del turno: registros para quien gestiona el objetivo"
  on public.tareas_turno_registros for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

-- ============================================================================
-- 5. RPC: ACTIVAR (Gerencia) Y DESACTIVAR
-- ============================================================================
-- p_items: [{control_id, momento, evidencia}]. Valida todo antes de escribir.
create or replace function public.tareas_turno_activar(p_objetivo_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario  uuid;
  v_item     jsonb;
  v_c        public.protocolo_controles_propuestos%rowtype;
  v_puesto   uuid;
  v_momento  text;
  v_evid     text;
  v_def      uuid;
  v_orden    integer;
  v_nuevas   integer := 0;
  v_reusadas integer := 0;
begin
  if auth.uid() is null or not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia activa tareas del turno' using errcode = '42501';
  end if;
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay tareas para activar' using errcode = '22023';
  end if;
  v_usuario := public.rondas_usuario_actual_id();
  perform pg_advisory_xact_lock(hashtext('tareas_turno:' || p_objetivo_id::text));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_c := (select c from public.protocolo_controles_propuestos c where c.id = (v_item->>'control_id')::uuid for update);
    if v_c.id is null or v_c.objetivo_id <> p_objetivo_id then
      raise exception 'El control no es de este objetivo' using errcode = '22023';
    end if;
    if v_c.estado <> 'aprobado' or v_c.destino <> 'tarea_turno' then
      raise exception 'Solo se activan tareas del turno aprobadas («%» esta % como %)', v_c.texto_item, v_c.estado, v_c.destino
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.protocolo_versiones v
      join public.protocolo_instrucciones i on i.version_id = v.id
      where v.id = v_c.version_id and i.id = v_c.instruccion_id
        and v.estado = 'vigente' and i.obsoleta_at is null
        and i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex')
    ) then
      raise exception 'La tarea «%» no sale de la version del protocolo que rige: guardala primero para que rija', v_c.texto_item
        using errcode = '22023';
    end if;
    v_momento := coalesce(v_item->>'momento', '');
    v_evid := coalesce(nullif(v_item->>'evidencia', ''), 'ninguna');
    if v_momento not in ('ingreso', 'durante', 'egreso') then
      raise exception 'Momento invalido para «%»: ingreso, durante o egreso', v_c.texto_item using errcode = '22023';
    end if;
    if v_evid not in ('ninguna', 'comentario', 'foto') then
      raise exception 'Evidencia invalida para «%»', v_c.texto_item using errcode = '22023';
    end if;
    v_puesto := (select v.puesto_id from public.protocolo_versiones v where v.id = v_c.version_id);

    -- Sin duplicados: misma tarea activa en el objetivo y puesto.
    v_def := (select d.id from public.tareas_turno_definiciones d
              where d.objetivo_id = p_objetivo_id and d.activo
                and d.puesto_id is not distinct from v_puesto
                and public.protocolo_normalizar(d.texto) = public.protocolo_normalizar(v_c.texto_item)
              limit 1);
    if v_def is null then
      v_orden := (select coalesce(max(d.orden), 0) + 1 from public.tareas_turno_definiciones d
                  where d.objetivo_id = p_objetivo_id and d.momento = v_momento);
      insert into public.tareas_turno_definiciones (
        objetivo_id, puesto_id, momento, texto, evidencia, orden, instruccion_id, control_id, activado_por
      ) values (
        p_objetivo_id, v_puesto, v_momento, left(btrim(v_c.texto_item), 300), v_evid, v_orden,
        v_c.instruccion_id, v_c.id, v_usuario
      ) returning id into v_def;
      v_nuevas := v_nuevas + 1;
    else
      v_reusadas := v_reusadas + 1;
    end if;

    update public.protocolo_controles_propuestos
       set estado = 'activado', activado_por = v_usuario, activado_at = now(), tarea_definicion_id = v_def
     where id = v_c.id;
  end loop;

  return jsonb_build_object('ok', true, 'nuevas', v_nuevas, 'reutilizadas', v_reusadas);
end;
$fn$;

create or replace function public.tareas_turno_desactivar(p_definicion_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_obj uuid;
begin
  if auth.uid() is null or not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia desactiva tareas del turno' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indicar el motivo' using errcode = '22023';
  end if;
  v_obj := (select d.objetivo_id from public.tareas_turno_definiciones d where d.id = p_definicion_id);
  if v_obj is null then
    raise exception 'Tarea inexistente' using errcode = '22023';
  end if;
  if not public.protocolo_puede_ver(v_obj) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  update public.tareas_turno_definiciones
     set activo = false, desactivado_por = public.rondas_usuario_actual_id(), desactivado_at = now(),
         motivo_desactivacion = btrim(p_motivo)
   where id = p_definicion_id and activo;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.tareas_turno_activar(uuid, jsonb) from public, anon;
revoke all on function public.tareas_turno_desactivar(uuid, text) from public, anon;
grant execute on function public.tareas_turno_activar(uuid, jsonb) to authenticated;
grant execute on function public.tareas_turno_desactivar(uuid, text) to authenticated;

-- ============================================================================
-- 6. RPC DEL VIGILADOR
-- ============================================================================

-- Las tareas activas de mis turnos habilitados (ayer, hoy, mañana), con lo
-- que ya marqué. Un único jsonb.
create or replace function public.tareas_turno_mias()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_empleado uuid;
begin
  v_empleado := public.rondas_usuario_actual_id();
  if auth.uid() is null or v_empleado is null then
    return jsonb_build_object('ok', false, 'turnos', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'turnos', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'turno_id', h.turno_id,
        'objetivo_id', h.objetivo_id,
        'tareas', (
          select coalesce(jsonb_agg(jsonb_build_object(
              'definicion_id', d.id, 'momento', d.momento, 'texto', d.texto, 'evidencia', d.evidencia,
              'registro', case when r.id is null then null else jsonb_build_object(
                'id', r.id, 'estado', r.estado, 'comentario', r.comentario, 'registrado_at', r.registrado_at,
                'con_foto', exists (select 1 from public.evidencias e
                                    where e.proceso_tipo = 'protocolo' and e.proceso_id = r.id)) end
            ) order by case d.momento when 'ingreso' then 1 when 'durante' then 2 else 3 end, d.orden), '[]'::jsonb)
          from public.tareas_turno_definiciones d
          left join public.tareas_turno_registros r on r.definicion_id = d.id and r.turno_id = h.turno_id
          where d.objetivo_id = h.objetivo_id
            and (d.puesto_id is null or d.puesto_id = h.puesto_id)
            and (d.activo or r.id is not null))
      )), '[]'::jsonb)
    from public.protocolo_turnos_habilitados() h
  ));
end;
$fn$;

create or replace function public.tareas_turno_registrar(
  p_turno_id uuid, p_definicion_id uuid, p_estado text, p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid      uuid;
  v_empleado uuid;
  v_t_turno  uuid;
  v_t_obj    uuid;
  v_t_puesto uuid;
  v_def      public.tareas_turno_definiciones%rowtype;
  v_reg      public.tareas_turno_registros%rowtype;
begin
  v_uid := auth.uid();
  v_empleado := public.rondas_usuario_actual_id();
  if v_uid is null or v_empleado is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  v_t_turno := (select h.turno_id from public.protocolo_turnos_habilitados() h where h.turno_id = p_turno_id limit 1);
  v_t_obj := (select h.objetivo_id from public.protocolo_turnos_habilitados() h where h.turno_id = p_turno_id limit 1);
  v_t_puesto := (select h.puesto_id from public.protocolo_turnos_habilitados() h where h.turno_id = p_turno_id limit 1);
  if v_t_turno is null then
    raise exception 'Ese turno no es tuyo o no esta habilitado' using errcode = '42501';
  end if;
  v_def := (select d from public.tareas_turno_definiciones d where d.id = p_definicion_id);
  if v_def.id is null or not v_def.activo or v_def.objetivo_id <> v_t_obj
     or (v_def.puesto_id is not null and v_def.puesto_id is distinct from v_t_puesto) then
    raise exception 'Esa tarea no corresponde a tu turno' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('hecha', 'no_aplica', 'no_pude') then
    raise exception 'Estado invalido' using errcode = '22023';
  end if;
  if p_estado <> 'hecha' and coalesce(btrim(p_comentario), '') = '' then
    raise exception 'Contá brevemente por qué' using errcode = '22023';
  end if;
  if v_def.evidencia = 'comentario' and p_estado = 'hecha' and coalesce(btrim(p_comentario), '') = '' then
    raise exception 'Esta tarea pide un comentario' using errcode = '22023';
  end if;

  insert into public.tareas_turno_registros (
    definicion_id, turno_id, objetivo_id, empleado_id, auth_user_id, momento, texto_tarea, estado, comentario
  ) values (
    v_def.id, p_turno_id, v_t_obj, v_empleado, v_uid, v_def.momento, v_def.texto,
    p_estado, nullif(btrim(left(coalesce(p_comentario, ''), 1000)), '')
  )
  on conflict on constraint tarea_registro_unico do nothing;

  v_reg := (select r from public.tareas_turno_registros r where r.turno_id = p_turno_id and r.definicion_id = v_def.id);
  if v_reg.empleado_id <> v_empleado then
    raise exception 'Otra persona ya registro esta tarea en este turno' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'id', v_reg.id, 'estado', v_reg.estado, 'registrado_at', v_reg.registrado_at,
                            'pide_foto', v_def.evidencia = 'foto' and v_reg.estado = 'hecha');
end;
$fn$;

-- Para la ruta de subida: confirma que el registro es del que llama, pide
-- foto y todavía no la tiene. Devuelve la ruta que exige el trigger.
create or replace function public.tareas_turno_destino_foto(p_registro_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_reg public.tareas_turno_registros%rowtype;
  v_ev  text;
begin
  v_reg := (select r from public.tareas_turno_registros r where r.id = p_registro_id);
  if auth.uid() is null or v_reg.id is null or v_reg.empleado_id <> public.rondas_usuario_actual_id() then
    raise exception 'Registro inexistente o ajeno' using errcode = '42501';
  end if;
  v_ev := (select d.evidencia from public.tareas_turno_definiciones d where d.id = v_reg.definicion_id);
  if v_ev <> 'foto' or v_reg.estado <> 'hecha' then
    raise exception 'Esta tarea no lleva foto' using errcode = '22023';
  end if;
  if exists (select 1 from public.evidencias e where e.proceso_tipo = 'protocolo' and e.proceso_id = v_reg.id) then
    raise exception 'La foto ya fue cargada' using errcode = '22023';
  end if;
  return jsonb_build_object('registro_id', v_reg.id, 'bucket', 'ronda-evidencias',
                            'storage_path', 'tareas-turno/' || v_reg.id::text || '/foto');
end;
$fn$;

-- Para ver una foto: el propio vigilador o quien gestiona el objetivo.
create or replace function public.tareas_turno_ver_foto(p_registro_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_reg public.tareas_turno_registros%rowtype;
  v_ev  public.evidencias%rowtype;
begin
  v_reg := (select r from public.tareas_turno_registros r where r.id = p_registro_id);
  if auth.uid() is null or v_reg.id is null
     or not (v_reg.empleado_id = public.rondas_usuario_actual_id() or public.protocolo_puede_ver(v_reg.objetivo_id)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_ev := (select e from public.evidencias e where e.proceso_tipo = 'protocolo' and e.proceso_id = v_reg.id limit 1);
  if v_ev.id is null then
    raise exception 'Sin foto' using errcode = '22023';
  end if;
  return jsonb_build_object('bucket', v_ev.bucket, 'storage_path', v_ev.storage_path);
end;
$fn$;

revoke all on function public.tareas_turno_mias() from public, anon;
revoke all on function public.tareas_turno_registrar(uuid, uuid, text, text) from public, anon;
revoke all on function public.tareas_turno_destino_foto(uuid) from public, anon;
revoke all on function public.tareas_turno_ver_foto(uuid) from public, anon;
grant execute on function public.tareas_turno_mias() to authenticated;
grant execute on function public.tareas_turno_registrar(uuid, uuid, text, text) to authenticated;
grant execute on function public.tareas_turno_destino_foto(uuid) to authenticated;
grant execute on function public.tareas_turno_ver_foto(uuid) to authenticated;

-- ============================================================================
-- 7. RPC DE SUPERVISIÓN: panel por objetivo
-- ============================================================================
-- Definiciones, tareas aprobadas listas para activar, y por turno de los
-- últimos p_dias: cuántas tareas aplicaban, hechas, no aplica, no pude y
-- pendientes, con los motivos. Un único jsonb.
create or replace function public.tareas_turno_panel(p_objetivo_id uuid, p_dias integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hoy  date;
  v_dias integer;
begin
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  v_hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_dias := least(greatest(coalesce(p_dias, 7), 1), 31);

  return jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'permisos', jsonb_build_object('activar', public.protocolo_puede_publicar()),
    'definiciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'momento', d.momento, 'texto', d.texto, 'evidencia', d.evidencia, 'activo', d.activo,
          'puesto_id', d.puesto_id, 'puesto_nombre', p.nombre, 'activado_at', d.activado_at,
          'desactivado_at', d.desactivado_at, 'motivo_desactivacion', d.motivo_desactivacion,
          'instruccion_id', d.instruccion_id
        ) order by d.activo desc, case d.momento when 'ingreso' then 1 when 'durante' then 2 else 3 end, d.orden), '[]'::jsonb)
      from public.tareas_turno_definiciones d
      left join public.puestos p on p.id = d.puesto_id
      where d.objetivo_id = p_objetivo_id),
    'para_activar', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'control_id', c.id, 'texto', c.texto_item, 'cuando', c.cuando, 'quien', c.quien,
          'version_estado', v.estado, 'version_numero', v.numero
        ) order by c.aprobado_at), '[]'::jsonb)
      from public.protocolo_controles_propuestos c
      join public.protocolo_versiones v on v.id = c.version_id
      where c.objetivo_id = p_objetivo_id and c.destino = 'tarea_turno' and c.estado = 'aprobado'),
    'turnos', (
      select coalesce(jsonb_agg(x.fila order by x.fecha desc, x.inicio desc), '[]'::jsonb)
      from (
        select t.fecha, t.hora_inicio as inicio, jsonb_build_object(
          'turno_id', t.id, 'fecha', t.fecha, 'hora_inicio', t.hora_inicio, 'hora_fin', t.hora_fin,
          'vigilador', nullif(btrim(coalesce(u.apellido, '') || ', ' || coalesce(u.nombre, '')), ','),
          'aplicables', count(d.id),
          'hechas', count(r.id) filter (where r.estado = 'hecha'),
          'no_aplica', count(r.id) filter (where r.estado = 'no_aplica'),
          'no_pude', count(r.id) filter (where r.estado = 'no_pude'),
          'pendientes', count(d.id) filter (where r.id is null),
          'motivos', coalesce(jsonb_agg(jsonb_build_object('tarea', r.texto_tarea, 'estado', r.estado, 'comentario', r.comentario))
                              filter (where r.estado <> 'hecha'), '[]'::jsonb)
        ) as fila
        from public.turnos t
        left join public.usuarios u on u.id = t.guardia_id
        join public.tareas_turno_definiciones d
          on d.objetivo_id = t.objetivo_id and (d.puesto_id is null or d.puesto_id = t.puesto_id)
         and d.activado_at < (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
         and (d.activo or d.desactivado_at > (t.fecha + t.hora_inicio))
        left join public.tareas_turno_registros r on r.definicion_id = d.id and r.turno_id = t.id
        where t.objetivo_id = p_objetivo_id
          and t.fecha between v_hoy - v_dias and v_hoy
          and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
        group by t.id, t.fecha, t.hora_inicio, t.hora_fin, u.apellido, u.nombre
      ) x)
  );
end;
$fn$;

revoke all on function public.tareas_turno_panel(uuid, integer) from public, anon;
grant execute on function public.tareas_turno_panel(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
