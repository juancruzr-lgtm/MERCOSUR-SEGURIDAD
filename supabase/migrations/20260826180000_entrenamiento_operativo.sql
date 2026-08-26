-- Entrenamiento Operativo — el registro de qué se le enseñó a cada persona.
--
-- QUE GUARDA
-- Una fila por (empleado, tipo de entrenamiento, periodo). Lo que se le dijo,
-- por que, con que numeros, cuando se le mando y por que canal. Y la metrica de
-- la dimension AL MOMENTO de mandarlo, que es la unica forma de saber despues
-- si sirvio: sin el valor previo congelado, "mejoro" es una impresion.
--
-- QUE NO GUARDA
-- No guarda el X/10 ni ninguna nota agregada. Guarda la metrica de UNA
-- dimension, que es sobre lo que trata el mensaje.
--
-- QUIEN VE QUE
--   Administracion   todo.
--   Supervisor       solo los empleados de sus zonas. Sin zonas, nada.
--   Vigilador        NADA de esta tabla. Ni una fila, ni una columna.
--
-- El vigilador recibe el TEXTO por push, y puede leerlo en la app a traves de
-- mis_instrucciones_operativas(), que devuelve texto y fecha y ninguna metrica.
-- Darle select sobre la tabla —aunque fuera solo sobre sus filas— le abriria
-- metrica_previa, que es una nota por dimension, y todavia no ve su puntaje.

begin;

-- ============================================================================
-- 1. ALCANCE
-- ============================================================================

create or replace function public.entrenamiento_en_alcance(p_empleado_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select public.ia_es_admin()
      or exists (
        select 1
          from public.turnos t
          join public.objetivos o        on o.id = t.objetivo_id
          join public.supervisor_zonas sz on sz.zona_id = o.zona_id
         where t.guardia_id   = p_empleado_id
           and sz.supervisor_id = public.rondas_usuario_actual_id()
      )
$fn$;

comment on function public.entrenamiento_en_alcance(uuid) is
  'Admin ve a todos; supervisor solo a quienes trabajaron en objetivos de sus '
  'zonas. Un supervisor sin zonas asignadas no ve a nadie: la ausencia de '
  'configuracion NO abre el acceso.';

revoke all on function public.entrenamiento_en_alcance(uuid) from public;
revoke all on function public.entrenamiento_en_alcance(uuid) from anon;
grant execute on function public.entrenamiento_en_alcance(uuid) to authenticated;

-- ============================================================================
-- 2. TABLA
-- ============================================================================

create table if not exists public.entrenamiento_operativo (
  id                uuid        primary key default gen_random_uuid(),
  empleado_id       uuid        not null references public.usuarios(id) on delete cascade,
  dimension         text        not null,
  tipo              text        not null,
  periodo           text        not null,
  prioridad         integer     not null,
  severidad         text        not null check (severidad in ('aislada', 'reincidencia', 'patron')),
  motivo            text        not null,
  texto             text        not null,
  hechos            jsonb       not null default '[]'::jsonb,

  -- La foto del momento en que se mando. Congelada a proposito.
  metrica_previa      numeric,
  incidencias_previas integer,
  requeridos_previos  integer,

  generado_at   timestamptz not null default now(),
  generado_por  uuid        references public.usuarios(id) on delete set null,
  notificado_at timestamptz,
  canal         text        check (canal is null or canal in ('push', 'app')),

  -- Se completa despues, cuando haya un periodo posterior que comparar.
  periodo_posterior       text,
  metrica_posterior       numeric,
  incidencias_posteriores integer,
  requeridos_posteriores  integer,
  medido_at               timestamptz,

  created_at timestamptz not null default now(),

  -- Un entrenamiento por persona, tipo y periodo. Es tambien la deduplicacion:
  -- el mismo mensaje del mismo mes no se manda dos veces.
  constraint entrenamiento_unico unique (empleado_id, tipo, periodo)
);

create index if not exists idx_entrenamiento_empleado
  on public.entrenamiento_operativo (empleado_id, periodo);
create index if not exists idx_entrenamiento_tipo
  on public.entrenamiento_operativo (tipo, periodo);
create index if not exists idx_entrenamiento_notificado
  on public.entrenamiento_operativo (notificado_at)
  where notificado_at is not null;

comment on table public.entrenamiento_operativo is
  'Que se le enseño a cada persona, con que hechos y cuando. NO es una '
  'evaluacion ni una sancion: no toca liquidacion, ni horas, ni fichajes, ni el '
  'puntaje. El vigilador no tiene acceso de lectura a esta tabla.';

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.entrenamiento_operativo enable row level security;

drop policy if exists "Lectura entrenamiento en alcance" on public.entrenamiento_operativo;
create policy "Lectura entrenamiento en alcance"
  on public.entrenamiento_operativo
  for select
  to authenticated
  using (public.entrenamiento_en_alcance(empleado_id));

-- La escritura la hace la ruta de envio con el cliente de servicio, o
-- Administracion desde la pantalla. Nadie mas.
drop policy if exists "Escritura entrenamiento solo admin" on public.entrenamiento_operativo;
create policy "Escritura entrenamiento solo admin"
  on public.entrenamiento_operativo
  for all
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke all on table public.entrenamiento_operativo from anon;
grant select on table public.entrenamiento_operativo to authenticated;
grant insert, update on table public.entrenamiento_operativo to authenticated;

-- ============================================================================
-- 4. LO QUE SI PUEDE VER EL VIGILADOR
-- ============================================================================
--
-- Texto, dimension y fecha. Ninguna metrica, ningun puntaje, ninguna categoria,
-- ninguna comparacion con nadie. Es una instruccion sobre como hacer mejor el
-- trabajo, no una calificacion.
--
-- Es una funcion y no una policy sobre la tabla a proposito: una policy le
-- daria acceso a la FILA, y en la fila viven metrica_previa y prioridad. Acá
-- las columnas que no puede ver directamente no salen.

create or replace function public.mis_instrucciones_operativas(
  p_desde date default null
)
returns table (
  dimension    text,
  tipo         text,
  texto        text,
  entregado_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select e.dimension, e.tipo, e.texto, e.notificado_at
    from public.entrenamiento_operativo e
   where e.empleado_id = public.rondas_usuario_actual_id()
     and e.notificado_at is not null
     and (p_desde is null or e.notificado_at >= p_desde)
   order by e.notificado_at desc
$fn$;

comment on function public.mis_instrucciones_operativas(date) is
  'Las instrucciones que ya se le entregaron al usuario que llama. Texto y '
  'fecha, nada mas: ni puntaje, ni nota por dimension, ni categoria, ni '
  'comparacion. Solo las YA notificadas: una instruccion generada y no enviada '
  'no existe todavia para el vigilador.';

revoke all on function public.mis_instrucciones_operativas(date) from public;
revoke all on function public.mis_instrucciones_operativas(date) from anon;
grant execute on function public.mis_instrucciones_operativas(date) to authenticated;

-- ============================================================================
-- 5. CONFIGURACION DEL MOMENTO DE ENVIO
-- ============================================================================
--
-- Sin nombres ni horarios particulares en el codigo. Default explicito: lunes
-- a las 10, fuera de turno.

insert into public.app_config (key, value, description) values
  ('entrenamiento_dia_semana', '1',
   'Dia de la semana en que se envian los entrenamientos operativos. 0 = domingo.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('entrenamiento_hora_envio', '10:00',
   'Hora local desde la que se pueden enviar los entrenamientos operativos.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
