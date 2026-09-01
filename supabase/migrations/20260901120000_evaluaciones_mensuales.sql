-- Evaluación mensual congelada: la fuente autoritativa única.
--
-- ── Por qué existe ───────────────────────────────────────────────────────────
-- Hasta hoy la evaluación se recalculaba en el navegador cada vez que alguien
-- abría la pantalla. Eso tiene dos consecuencias que impiden publicarla:
--
--   1. la nota se mueve sola cuando Administración corrige el mes;
--   2. no hay nada que "publicar": no existe el hecho, sólo el cálculo.
--
-- Esta tabla guarda el resultado de UNA corrida, con las cuatro capas del
-- modelo separadas y etiquetadas, para que Administración, Mi desempeño y el
-- Tablero de Gerencia lean exactamente el mismo número.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────────
-- No calcula nada. El motor sigue siendo lib/cumplimiento + lib/evaluacion-final
-- y no se toca: acá sólo se deposita lo que ese motor ya produjo. Si algún día
-- cambia el modelo, esta tabla conserva lo que se publicó, que es justamente lo
-- que se necesita para poder responder por una calificación entregada.
--
-- No bloquea nada. Agosto sigue siendo editable por las vías administrativas
-- normales; lo que queda fijo es la evaluación publicada, no los datos.

begin;

create table if not exists public.evaluaciones_mensuales (
  id           uuid primary key default gen_random_uuid(),
  empleado_id  uuid not null references public.usuarios(id) on delete cascade,
  -- 'YYYY-MM'. El mes lo determina la fecha de inicio del turno, igual que en
  -- liquidación: el universo lo arma la app, acá sólo se guarda la etiqueta.
  periodo      text not null check (periodo ~ '^\d{4}-\d{2}$'),

  -- ── Las cuatro capas, separadas a propósito ────────────────────────────────
  -- Confundirlas fue el defecto que tuvo la lista de Cumplimiento hasta hoy:
  -- mostraba `cumplimiento_ponderado` con formato de nota. Acá cada una tiene
  -- su nombre y su unidad, y no se pueden mezclar por descuido.
  --
  -- CAPA 1 · cumplimiento ponderado, 0 a 100. NO es la nota.
  cumplimiento_ponderado numeric(5,2),
  -- CAPA 3 · índice tras la escala escolar (68→4, 80→6, 88→7, 94→8, 98→9, 100→10).
  indice                 numeric(4,2),
  -- CAPA 4 · nota final = min(índice, topes). Es LA calificación.
  nota_final             numeric(4,2),
  concepto               text,

  -- Nulos a propósito cuando la muestra no alcanza: no se inventa una nota.
  datos_insuficientes boolean not null default false,

  cobertura        numeric(5,2),
  alcance          text,
  estado_desempeno text,

  -- Las siete dimensiones con su nota, peso y estado, tal cual las devolvió el
  -- motor. Es lo que permite explicarle a alguien de dónde salió su número.
  dimensiones jsonb not null default '[]'::jsonb,
  -- Faltas críticas aplicadas (Modelo C, inasistencia). Vacío = sin topes.
  faltas      jsonb not null default '[]'::jsonb,
  explicacion text,
  -- El balance del mes: qué salió bien y qué conviene mejorar, ya separado en
  -- Prestación del servicio / Uso de la app / Calidad de la medición.
  balance     jsonb,
  -- Contexto para poder decir "sobre cuántas oportunidades": jornadas,
  -- rondas exigibles, turnos con obligación. Sin esto, un 0 % no se entiende.
  contexto    jsonb not null default '{}'::jsonb,

  -- ── Publicación ────────────────────────────────────────────────────────────
  -- calculada  → existe, nadie la vio salvo Administración
  -- revisada   → Administración la miró y la da por buena
  -- publicada  → el vigilador puede verla. Es el único estado que abre acceso.
  estado text not null default 'calculada'
    check (estado in ('calculada', 'revisada', 'publicada')),

  generado_at   timestamptz not null default now(),
  generado_por  uuid references public.usuarios(id) on delete set null,
  publicado_at  timestamptz,
  publicado_por uuid references public.usuarios(id) on delete set null,

  -- Una evaluación por persona y período. Republicar el mes actualiza la fila
  -- en vez de acumular versiones: lo que vale es la última publicada.
  constraint evaluacion_unica unique (empleado_id, periodo)
);

create index if not exists idx_evaluaciones_periodo
  on public.evaluaciones_mensuales (periodo, estado);
create index if not exists idx_evaluaciones_empleado
  on public.evaluaciones_mensuales (empleado_id, periodo);

comment on table public.evaluaciones_mensuales is
  'Evaluacion mensual congelada. Fuente unica para Administracion, Mi desempeño '
  'y el Tablero de Gerencia. El vigilador solo ve la suya y solo si esta '
  'publicada. No calcula: deposita lo que produjo lib/evaluacion-final.';

comment on column public.evaluaciones_mensuales.cumplimiento_ponderado is
  'CAPA 1, de 0 a 100. NO es la nota y no debe mostrarse con formato /10.';
comment on column public.evaluaciones_mensuales.nota_final is
  'CAPA 4. La calificacion. Es lo unico que se muestra como nota.';

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.evaluaciones_mensuales enable row level security;

-- Administracion y Supervision, con el mismo alcance que ya rige para el
-- Entrenador: admin ve a todos, supervisor solo su zona. No se inventa una
-- segunda regla de alcance que pueda contradecir a la primera.
drop policy if exists "Lectura evaluaciones en alcance" on public.evaluaciones_mensuales;
create policy "Lectura evaluaciones en alcance"
  on public.evaluaciones_mensuales
  for select
  to authenticated
  using (public.entrenamiento_en_alcance(empleado_id));

-- El vigilador: SOLO la suya, y SOLO publicada.
--
-- Las dos condiciones son necesarias. Sin la primera vería a sus compañeros;
-- sin la segunda vería el mes mientras Administracion todavia lo corrige.
drop policy if exists "Vigilador lee su evaluacion publicada" on public.evaluaciones_mensuales;
create policy "Vigilador lee su evaluacion publicada"
  on public.evaluaciones_mensuales
  for select
  to authenticated
  using (
    empleado_id = public.rondas_usuario_actual_id()
    and estado = 'publicada'
  );

-- La escritura la hace Administracion desde la pantalla de Cumplimiento.
drop policy if exists "Escritura evaluaciones solo admin" on public.evaluaciones_mensuales;
create policy "Escritura evaluaciones solo admin"
  on public.evaluaciones_mensuales
  for all
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke all on table public.evaluaciones_mensuales from anon;
grant select, insert, update on table public.evaluaciones_mensuales to authenticated;
-- DELETE no se concede: una evaluacion publicada se despublica cambiando el
-- estado, no borrandola. El rastro de lo que se le mostro a alguien se conserva.
revoke delete on table public.evaluaciones_mensuales from authenticated;

notify pgrst, 'reload schema';

commit;
