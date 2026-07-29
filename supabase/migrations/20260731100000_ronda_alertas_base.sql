-- ============================================================================
-- ALERTAS DE RONDAS · A1 — Tablas base
-- ============================================================================
--
-- Fuente canónica y PERSISTENTE de alertas de rondas (no crea un sistema
-- paralelo: la detección la alimenta el evaluador y el ruteo/push reutiliza el
-- cron y supervisor_zonas existentes). Dos tablas:
--
--   ronda_alertas               — estado ACTUAL, una fila por ventana+tipo
--   ronda_alerta_intervenciones — historial APPEND-ONLY de intervenciones
--
-- Idempotencia por (ronda_base_id, turno_id, ventana_inicio, tipo).
-- No toca horas liquidables, asistencia, JWM, ejecución del vigilador ni las
-- alertas legacy.

begin;

create table public.ronda_alertas (
  id             uuid primary key default gen_random_uuid(),

  -- Vínculo completo pedido: objetivo, puesto, ronda, turno, vigilador, ejecución.
  objetivo_id    uuid not null references public.objetivos(id)        on delete restrict,
  puesto_id      uuid not null references public.puestos(id)          on delete restrict,
  ronda_base_id  uuid not null references public.rondas_base(id)      on delete restrict,
  turno_id       uuid not null references public.turnos(id)           on delete restrict,
  guardia_id     uuid not null references public.usuarios(id)         on delete restrict,
  -- Ejecución asociada: null en no_iniciada sin cobertura; se completa si hay
  -- un inicio (tardío o a tiempo) vinculable a la ventana.
  ejecucion_id   uuid          references public.ronda_ejecuciones(id) on delete set null,

  tipo           text not null check (tipo in ('no_iniciada', 'no_finalizada')),

  -- Ventana programada (obligación). Deriva de rondas_base.hora_inicio + N·intervalo
  -- acotada al turno; vencimiento = fin de ventana + tolerancia.
  ventana_inicio timestamptz not null,
  ventana_fin    timestamptz not null,
  vencimiento_at timestamptz not null,

  estado         text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  detectada_at   timestamptz not null default now(),

  -- Resolución (estado actual; el historial completo va en la tabla aparte).
  resuelta_por   uuid          references public.usuarios(id) on delete set null,
  resuelta_at    timestamptz,
  accion         text          check (accion is null or accion in (
                   'llamada_vigilador', 'solicitud_cumplimiento',
                   'justificacion', 'cierre_administrativo', 'resuelta')),
  comentario     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- estado='resuelta' ⇔ hay marca temporal de resolución.
  constraint ronda_alertas_resuelta_coherente
    check ((estado = 'resuelta') = (resuelta_at is not null)),

  -- Idempotencia: una alerta por ventana programada y tipo.
  constraint ronda_alertas_ventana_key
    unique (ronda_base_id, turno_id, ventana_inicio, tipo)
);

comment on table public.ronda_alertas is
  'Alertas persistentes de rondas: una por ventana programada incumplida. '
  'Idempotente por (ronda_base_id, turno_id, ventana_inicio, tipo).';

create index idx_ronda_alertas_objetivo_estado
  on public.ronda_alertas (objetivo_id, estado, detectada_at desc);
create index idx_ronda_alertas_pendientes
  on public.ronda_alertas (detectada_at desc) where estado = 'pendiente';
create index idx_ronda_alertas_ejecucion
  on public.ronda_alertas (ejecucion_id) where ejecucion_id is not null;
create index idx_ronda_alertas_turno
  on public.ronda_alertas (turno_id);

create trigger trg_ronda_alertas_updated_at
  before update on public.ronda_alertas
  for each row execute function public.set_updated_at();

-- ── Historial append-only de intervenciones ─────────────────────────────────

create table public.ronda_alerta_intervenciones (
  id              uuid primary key default gen_random_uuid(),
  ronda_alerta_id uuid not null references public.ronda_alertas(id) on delete cascade,
  supervisor_id   uuid not null references public.usuarios(id)      on delete restrict,
  accion          text not null check (accion in (
                    'llamada_vigilador', 'solicitud_cumplimiento',
                    'justificacion', 'cierre_administrativo', 'resuelta')),
  comentario      text,
  estado_anterior text not null,
  estado_nuevo    text not null,
  created_at      timestamptz not null default now()
);

comment on table public.ronda_alerta_intervenciones is
  'Historial completo (append-only) de intervenciones sobre ronda_alertas. '
  'No se guarda solo la última: cada acción deja su fila.';

create index idx_ronda_alerta_intervenciones_alerta
  on public.ronda_alerta_intervenciones (ronda_alerta_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Lectura para admin o supervisor con alcance sobre el objetivo. La escritura
-- ocurre solo por funciones SECURITY DEFINER (evaluador / RPC / cierre), que
-- omiten RLS; no se conceden insert/update/delete a clientes.

alter table public.ronda_alertas enable row level security;
alter table public.ronda_alerta_intervenciones enable row level security;

create policy "Admin supervisor lee ronda_alertas de su alcance"
on public.ronda_alertas
for select to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

create policy "Admin supervisor lee ronda_alerta_intervenciones de su alcance"
on public.ronda_alerta_intervenciones
for select to authenticated
using (
  exists (
    select 1 from public.ronda_alertas a
    where a.id = ronda_alerta_intervenciones.ronda_alerta_id
      and public.puede_administrar_rondas_objetivo(a.objetivo_id)
  )
);

revoke all on table public.ronda_alertas               from anon;
revoke all on table public.ronda_alertas               from authenticated;
revoke all on table public.ronda_alerta_intervenciones from anon;
revoke all on table public.ronda_alerta_intervenciones from authenticated;
grant select on table public.ronda_alertas               to authenticated;
grant select on table public.ronda_alerta_intervenciones to authenticated;

notify pgrst, 'reload schema';

commit;
