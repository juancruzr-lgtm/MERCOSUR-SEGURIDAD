-- Intervenciones por uso de la aplicación: la escalera, registrada.
--
-- ── Por qué existe ───────────────────────────────────────────────────────────
-- El control de adopción detecta quién no registra sus fichajes. Detectarlo no
-- es intervenir: hasta hoy, lo que se hacía al respecto no quedaba en ningún
-- lado. Sin registro no se puede sostener que a alguien "ya se le avisó", que
-- es exactamente lo que hace falta para que una medida posterior sea defendible.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────────
-- No sanciona y no escala solo. Cada fila la crea una persona: el sistema
-- muestra el caso y su antecedente, la decisión la toma Administración. Un
-- disparo automático de advertencias convertiría un problema de registro en una
-- medida disciplinaria sin que nadie hubiera mirado el caso.
--
-- La escalera es entrenamiento → aviso → advertencia. El orden lo decide quien
-- interviene, mirando lo que ya se hizo antes con esa persona.

begin;

create table if not exists public.intervenciones_uso_app (
  id           uuid primary key default gen_random_uuid(),
  empleado_id  uuid not null references public.usuarios(id) on delete cascade,
  -- 'YYYY-MM'. El período que motivó la intervención, no la fecha en que se hizo.
  periodo      text not null check (periodo ~ '^\d{4}-\d{2}$'),

  -- La escalera. Entrenar es enseñar; avisar es dejar constancia de que se
  -- habló; advertir ya es un antecedente formal.
  tipo text not null check (tipo in ('entrenamiento', 'aviso', 'advertencia')),

  -- Por qué se intervino, en palabras de quien intervino.
  motivo text not null,

  -- Los hechos que la sostienen, copiados del control de adopción: jornadas,
  -- jornadas sin registro propio, proporción y clase. Se guardan acá y no se
  -- recalculan después: si el mes se corrige más adelante, la intervención
  -- tiene que seguir mostrando sobre qué se decidió en su momento.
  evidencia jsonb not null default '{}'::jsonb,

  responsable_id uuid references public.usuarios(id) on delete set null,

  -- abierta → se hizo y sigue vigente como antecedente
  -- cerrada → se dio por resuelta, con la observación explicando por qué
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  observacion text,

  creado_at timestamptz not null default now(),
  cerrado_at timestamptz,

  -- Una intervención del mismo tipo por persona y período. Repetir el mismo
  -- aviso por el mismo mes no agrega antecedente, sólo ruido.
  constraint intervencion_unica unique (empleado_id, periodo, tipo)
);

create index if not exists idx_intervenciones_empleado
  on public.intervenciones_uso_app (empleado_id, periodo);
create index if not exists idx_intervenciones_periodo
  on public.intervenciones_uso_app (periodo, tipo);

comment on table public.intervenciones_uso_app is
  'Intervenciones por uso de la aplicacion: entrenamiento, aviso y advertencia. '
  'Las crea una persona, no el sistema. Conserva la evidencia del momento para '
  'que una medida posterior se pueda sostener.';

-- ============================================================================
-- RLS
-- ============================================================================
--
-- Es una herramienta administrativa. El vigilador NO la lee: lo que a él le
-- llega es el entrenamiento, redactado para enseñar. Ver el expediente de su
-- propio caso no le agrega nada accionable y convierte una instruccion en una
-- amenaza.

alter table public.intervenciones_uso_app enable row level security;

drop policy if exists "Lectura intervenciones en alcance" on public.intervenciones_uso_app;
create policy "Lectura intervenciones en alcance"
  on public.intervenciones_uso_app
  for select
  to authenticated
  using (public.entrenamiento_en_alcance(empleado_id));

drop policy if exists "Escritura intervenciones solo admin" on public.intervenciones_uso_app;
create policy "Escritura intervenciones solo admin"
  on public.intervenciones_uso_app
  for all
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke all on table public.intervenciones_uso_app from anon;
grant select, insert, update on table public.intervenciones_uso_app to authenticated;
-- DELETE no se concede: un antecedente que se puede borrar no es un antecedente.
-- Una intervencion equivocada se cierra con la observacion que lo explique.
revoke delete on table public.intervenciones_uso_app from authenticated;

notify pgrst, 'reload schema';

commit;
