-- Entrega de la evaluación mensual: publicada → vista, y las observaciones.
--
-- ── Dos estados, no tres ─────────────────────────────────────────────────────
--   publicado  la evaluación quedó a disposición del vigilador
--   visto      el vigilador abrió efectivamente Mi Desempeño
--
-- No hay "confirmar que la vi". Pedirle a alguien que apriete un botón para
-- acreditar algo que el sistema puede observar solo agrega un paso que la mitad
-- no va a dar, y deja el dato peor de lo que estaba.
--
-- ── Visto no es conformidad ──────────────────────────────────────────────────
-- Acredita acceso y nada más. Quien quiera objetar la nota tiene la observación,
-- que es un acto distinto y explícito.
--
-- ── Por qué no alcanza la telemetría ─────────────────────────────────────────
-- `os_events` se manda en lotes y es best-effort: se pierde si se cierra la app.
-- Sirve para analizar uso, no para sostener que a una persona se le entregó su
-- evaluación. Esto es un hecho registrado, no una métrica.
--
-- ── Escritura sólo por RPC ───────────────────────────────────────────────────
-- Mismo criterio que `aceptaciones_planilla`: sin policies de INSERT, el cliente
-- no escribe directo en una tabla de auditoría. La RPC valida que quien llama
-- sea el dueño de la evaluación y que esté publicada, así que ni un admin
-- mirando la ficha ajena ni una previsualización pueden marcar un "visto"
-- que nadie tuvo.

begin;

-- ============================================================================
-- 1. LECTURAS
-- ============================================================================

create table if not exists public.lecturas_evaluacion (
  id            uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones_mensuales(id) on delete cascade,
  empleado_id   uuid not null references public.usuarios(id) on delete cascade,
  periodo       text not null check (periodo ~ '^\d{4}-\d{2}$'),
  visto_at      timestamptz not null default now(),
  -- La identidad de la sesión que abrió, aparte del empleado: si mañana un
  -- empleado cambia de cuenta, el rastro sigue diciendo quién estaba adentro.
  auth_user_id  uuid not null,

  -- Idempotencia: abrirla diez veces es una sola lectura, la primera.
  constraint lectura_evaluacion_unica unique (evaluacion_id, empleado_id)
);

create index if not exists idx_lecturas_evaluacion_periodo
  on public.lecturas_evaluacion (periodo, empleado_id);

comment on table public.lecturas_evaluacion is
  'Primera apertura de una evaluacion publicada por su propio destinatario. '
  'Acredita acceso, NO conformidad con la nota.';

-- ============================================================================
-- 2. OBSERVACIONES
-- ============================================================================

create table if not exists public.observaciones_evaluacion (
  id            uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones_mensuales(id) on delete cascade,
  empleado_id   uuid not null references public.usuarios(id) on delete cascade,
  periodo       text not null check (periodo ~ '^\d{4}-\d{2}$'),
  texto         text not null check (length(btrim(texto)) >= 5),

  -- abierta    → la escribió y espera respuesta
  -- respondida → Administración contestó
  -- cerrada    → se dio por terminada
  estado text not null default 'abierta'
    check (estado in ('abierta', 'respondida', 'cerrada')),

  respuesta      text,
  respondido_por uuid references public.usuarios(id) on delete set null,
  respondido_at  timestamptz,
  creado_at      timestamptz not null default now()
);

create index if not exists idx_observaciones_evaluacion_estado
  on public.observaciones_evaluacion (periodo, estado);
create index if not exists idx_observaciones_evaluacion_empleado
  on public.observaciones_evaluacion (empleado_id, periodo);

comment on table public.observaciones_evaluacion is
  'Aclaracion o pedido de revision del vigilador sobre su evaluacion. NO '
  'modifica la nota: una correccion, si corresponde, se hace por la via '
  'administrativa normal y se vuelve a congelar el mes.';

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.lecturas_evaluacion enable row level security;
alter table public.observaciones_evaluacion enable row level security;

-- Mismo alcance que ya rige para la evaluación: admin ve a todos, supervisor
-- sólo su zona. No se inventa una segunda regla que pueda contradecir a la
-- primera.
drop policy if exists "Lectura de lecturas en alcance" on public.lecturas_evaluacion;
create policy "Lectura de lecturas en alcance"
  on public.lecturas_evaluacion for select to authenticated
  using (public.entrenamiento_en_alcance(empleado_id));

drop policy if exists "Vigilador ve sus propias lecturas" on public.lecturas_evaluacion;
create policy "Vigilador ve sus propias lecturas"
  on public.lecturas_evaluacion for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Lectura de observaciones en alcance" on public.observaciones_evaluacion;
create policy "Lectura de observaciones en alcance"
  on public.observaciones_evaluacion for select to authenticated
  using (public.entrenamiento_en_alcance(empleado_id));

drop policy if exists "Vigilador ve sus propias observaciones" on public.observaciones_evaluacion;
create policy "Vigilador ve sus propias observaciones"
  on public.observaciones_evaluacion for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

-- Responder y cerrar es de Administración.
drop policy if exists "Administracion responde observaciones" on public.observaciones_evaluacion;
create policy "Administracion responde observaciones"
  on public.observaciones_evaluacion for update to authenticated
  using (public.ia_es_admin()) with check (public.ia_es_admin());

revoke all on table public.lecturas_evaluacion from anon;
revoke all on table public.observaciones_evaluacion from anon;
-- Sin INSERT: se escribe por RPC. Sin DELETE: un rastro que se borra no sirve.
grant select on table public.lecturas_evaluacion to authenticated;
grant select, update on table public.observaciones_evaluacion to authenticated;

-- ============================================================================
-- 4. RPC: registrar la lectura
-- ============================================================================
--
-- Idempotente y silenciosa. La llama la pantalla al abrir; si algo no da, no
-- rompe la vista: el vigilador tiene que poder leer su evaluación aunque el
-- registro de lectura falle.

create or replace function public.registrar_lectura_evaluacion(p_evaluacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid      uuid;
  v_empleado uuid;
  v_eval     record;
  v_ya       boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado');
  end if;

  select id into v_empleado
  from public.usuarios
  where auth_user_id = v_uid and estado = 'activo';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo');
  end if;

  select id, empleado_id, periodo, estado
  into v_eval
  from public.evaluaciones_mensuales
  where id = p_evaluacion_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;

  -- Sólo el destinatario, y sólo si está publicada. Esto es lo que impide que
  -- un admin abriendo la ficha ajena, o la previsualización "Vista como
  -- vigilador", inventen un visto que la persona nunca tuvo.
  if v_eval.empleado_id <> v_empleado then
    return jsonb_build_object('ok', false, 'motivo', 'no_es_suya');
  end if;
  if v_eval.estado <> 'publicada' then
    return jsonb_build_object('ok', false, 'motivo', 'no_publicada');
  end if;

  select exists (
    select 1 from public.lecturas_evaluacion
    where evaluacion_id = p_evaluacion_id and empleado_id = v_empleado
  ) into v_ya;

  insert into public.lecturas_evaluacion
    (evaluacion_id, empleado_id, periodo, auth_user_id)
  values (p_evaluacion_id, v_empleado, v_eval.periodo, v_uid)
  on conflict on constraint lectura_evaluacion_unica do nothing;

  return jsonb_build_object('ok', true, 'primera_vez', not v_ya);
end;
$fn$;

revoke all on function public.registrar_lectura_evaluacion(uuid) from public;
revoke all on function public.registrar_lectura_evaluacion(uuid) from anon;
grant execute on function public.registrar_lectura_evaluacion(uuid) to authenticated;

comment on function public.registrar_lectura_evaluacion(uuid) is
  'Marca visto la primera vez que el destinatario abre su evaluacion publicada. '
  'Idempotente. Acredita acceso, no conformidad.';

-- ============================================================================
-- 5. RPC: dejar una observación
-- ============================================================================

create or replace function public.observar_evaluacion(
  p_evaluacion_id uuid,
  p_texto         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid      uuid;
  v_empleado uuid;
  v_eval     record;
  v_id       uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select id into v_empleado
  from public.usuarios
  where auth_user_id = v_uid and estado = 'activo';
  if not found then
    raise exception 'Usuario no encontrado o inactivo';
  end if;

  if p_texto is null or length(btrim(p_texto)) < 5 then
    raise exception 'La observacion necesita un texto';
  end if;

  select id, empleado_id, periodo, estado
  into v_eval
  from public.evaluaciones_mensuales
  where id = p_evaluacion_id;
  if not found then
    raise exception 'Evaluacion inexistente';
  end if;

  if v_eval.empleado_id <> v_empleado then
    raise exception 'La evaluacion no es suya';
  end if;
  if v_eval.estado <> 'publicada' then
    raise exception 'La evaluacion no esta publicada';
  end if;

  -- Una observación abierta por vez y por período: dos pedidos simultáneos
  -- sobre el mismo mes no son dos temas, son el mismo tema repetido.
  if exists (
    select 1 from public.observaciones_evaluacion
    where evaluacion_id = p_evaluacion_id and estado = 'abierta'
  ) then
    raise exception 'Ya tenes una observacion abierta de este periodo';
  end if;

  insert into public.observaciones_evaluacion
    (evaluacion_id, empleado_id, periodo, texto)
  values (p_evaluacion_id, v_empleado, v_eval.periodo, btrim(p_texto))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

revoke all on function public.observar_evaluacion(uuid, text) from public;
revoke all on function public.observar_evaluacion(uuid, text) from anon;
grant execute on function public.observar_evaluacion(uuid, text) to authenticated;

comment on function public.observar_evaluacion(uuid, text) is
  'El vigilador deja una aclaracion o pide revision de su evaluacion publicada. '
  'NO modifica la nota.';

notify pgrst, 'reload schema';

commit;
