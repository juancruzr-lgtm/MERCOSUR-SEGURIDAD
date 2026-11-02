-- ============================================================================
-- PROPUESTA — NO EJECUTAR SIN AUTORIZACIÓN EXPRESA (AGENTS.md)
-- LAROMET ROSARIO: tres objetivos para una misma sede. Reconocer la actividad
-- real SIN fusionar, desactivar ni mover nada.
-- ============================================================================
-- Diagnóstico (producción, sólo lectura, 02/11/2026) y decisión pendiente:
-- docs/auditoria-2026-10/rondas_historial_exigencias.md §7.
--
--   a748b4e8… LAROMET ROSARIO   OVIDIO LAGOS 2800        activo   alta 01/08  turnos 01/08→03/10
--   99523cba… Laromet rosario 2 Pellegrini 6 Ovidio Lagos inactivo alta 10/08  turnos 10/08→28/08
--   e6586ac9… LAROMET ROSARIO 2 SAN LUIS E IRIONDO       activo   alta 07/09  turnos 07/09→hoy
-- Coordenadas a 16–34 m entre sí, misma zona (Rosario), mismo cliente, los
-- mismos vigiladores (Mena, Fleytas, Benítez, Taborda, Borgnis) rotando entre
-- los tres registros. Es UNA sede. Desde el 04/10 sólo LAROMET ROSARIO 2 tiene
-- turnos (y la única ronda: «Punto sur»), pero los supervisores siguieron
-- registrando la visita en los otros dos: 27 supervisiones de octubre (18 en
-- LAROMET ROSARIO y 9 en Laromet rosario 2) quedan fuera del objetivo que E1
-- controla (frecuencia 24 h). E1 hoy le imputa a LAROMET ROSARIO 2 8
-- vencimientos y 568,1 h en octubre (Aranda 4 / 380,5 h; Martínez J. L.
-- 4 / 187,6 h). Contando las supervisiones de los alias (estimación por huecos
-- entre visitas, sin tramos de exigibilidad) quedarían ≈ 82 h.
--
-- Propuesta: una tabla de ALIAS con vigencia. Un alias no cambia el objetivo
-- de nada: la supervisión sigue registrada donde se hizo; los lectores que
-- miden "¿se supervisó este objetivo?" (E1, última supervisión, Mi Desempeño
-- del supervisor) cuentan también las del alias dentro de la vigencia. Una
-- fila se anula, no se borra.
--
-- Cambio de código NO incluido (decisión aparte): E1
-- (evaluacion_vencimientos_supervision) y ultima_supervision_por_objetivo
-- tendrían que leer supervisiones a través de objetivo_canonico_en(). Este
-- archivo sólo crea la tabla en una transacción y muestra el efecto.
-- ============================================================================

begin;

-- ── 1) ANTES ────────────────────────────────────────────────────────────────
select o.nombre, o.estado, o.created_at::date as alta,
       (select min(t.fecha) || ' → ' || max(t.fecha) from public.turnos t where t.objetivo_id = o.id) as turnos,
       (select count(*) from public.supervisiones s where s.objetivo_id = o.id and s.estado <> 'incompleta'
          and s.created_at >= ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
          and s.created_at <  ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')) as supervisiones_oct,
       (select count(*) from public.ronda_alertas a where a.objetivo_id = o.id) as alertas_ronda
  from public.objetivos o
 where o.id in ('a748b4e8-3562-450f-8d3e-d7051293a8b7', '99523cba-216d-4416-bb00-f147c19a0cae',
                'e6586ac9-36fd-4ecf-a6c2-2997a72543dc')
 order by o.created_at;

select o.nombre, u.apellido || ', ' || u.nombre as supervisor, count(*) as vencimientos, sum(v.horas_vencido) as horas
  from public.evaluacion_vencimientos_supervision('2026-10-01', '2026-10-31') v
  join public.objetivos o on o.id = v.objetivo_id
  left join public.usuarios u on u.id = v.supervisor_id
 where v.objetivo_id = 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc'
 group by 1, 2 order by 2;

-- ── 2) Tabla de alias ───────────────────────────────────────────────────────
create table if not exists public.objetivo_alias (
  id                 uuid primary key default gen_random_uuid(),
  alias_objetivo_id  uuid not null references public.objetivos(id),
  objetivo_id        uuid not null references public.objetivos(id),   -- canónico
  desde              date not null,                                     -- ART, inclusivo
  hasta              date,                                              -- ART, inclusivo; NULL = vigente
  motivo             text not null check (length(btrim(motivo)) > 0),
  creado_por         uuid references public.usuarios(id),
  created_at         timestamptz not null default now(),
  anulado_at         timestamptz,
  anulado_por        uuid references public.usuarios(id),
  constraint objetivo_alias_distintos check (alias_objetivo_id <> objetivo_id),
  constraint objetivo_alias_rango check (hasta is null or hasta >= desde)
);
comment on table public.objetivo_alias is
  'Otro registro de la misma sede: lo que se registra en el alias cuenta también para el objetivo '
  'canónico dentro de la vigencia. No fusiona ni mueve datos. Se anula, no se borra.';
alter table public.objetivo_alias enable row level security;
revoke all on public.objetivo_alias from public, anon, authenticated;

-- Canónico de un objetivo en un instante (él mismo si no es alias vigente).
create or replace function public.objetivo_canonico_en(p_objetivo_id uuid, p_instante timestamptz)
returns uuid language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((
    select a.objetivo_id from public.objetivo_alias a
     where a.alias_objetivo_id = p_objetivo_id and a.anulado_at is null
       and (p_instante at time zone 'America/Argentina/Buenos_Aires')::date >= a.desde
       and (a.hasta is null or (p_instante at time zone 'America/Argentina/Buenos_Aires')::date <= a.hasta)
     order by a.created_at desc limit 1), p_objetivo_id)
$$;

-- Vigencia: desde el alta de LAROMET ROSARIO 2 (07/09). Mientras LAROMET
-- ROSARIO tuvo turnos propios (hasta el 03/10) su supervisión cuenta para él
-- Y para el canónico: no se le quita nada a nadie.
insert into public.objetivo_alias (alias_objetivo_id, objetivo_id, desde, motivo) values
  ('a748b4e8-3562-450f-8d3e-d7051293a8b7', 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc', date '2026-09-07',
   'Misma sede que LAROMET ROSARIO 2 (16 m). Auditoría oct-2026: supervisiones registradas en este registro.'),
  ('99523cba-216d-4416-bb00-f147c19a0cae', 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc', date '2026-09-07',
   'Misma sede que LAROMET ROSARIO 2 (34 m), objetivo inactivo. Auditoría oct-2026.');

-- ── 3) Las 27 supervisiones de octubre que pasarían a reconocerse ───────────
select s.id, o.nombre as registrada_en,
       to_char(s.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') as fecha,
       u.apellido || ', ' || u.nombre as supervisor, s.estado,
       round((6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - (-32.8895713)) / 2), 2)
         + cos(radians(s.lat)) * cos(radians(-32.8895713)) * power(sin(radians(s.lng - (-60.6937008)) / 2), 2))))::numeric) as metros_a_la_sede
  from public.supervisiones s
  join public.objetivos o on o.id = s.objetivo_id
  left join public.usuarios u on u.id = s.supervisor_id
 where s.objetivo_id in ('a748b4e8-3562-450f-8d3e-d7051293a8b7', '99523cba-216d-4416-bb00-f147c19a0cae')
   and s.estado <> 'incompleta'
   and s.created_at >= ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and s.created_at <  ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and public.objetivo_canonico_en(s.objetivo_id, s.created_at) = 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc'
   -- el alias no tenía turno propio ese día (o el anterior): la visita fue a la sede activa
   and not exists (select 1 from public.turnos t
                    where t.objetivo_id = s.objetivo_id
                      and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
                      and t.fecha between (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date - 1
                                      and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
 order by s.created_at;

-- ── 4) DESPUÉS (estimación): horas vencidas de la sede con y sin alias ──────
-- Huecos entre supervisiones válidas > 24 h dentro de octubre. Aproxima E1
-- (no aplica tramos de exigibilidad ni el control de turnos).
with p as (select ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
                  least(now(), ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')) as t1),
s0 as (
  select 'sin_alias' as modo, s.created_at from public.supervisiones s
   where s.estado <> 'incompleta' and s.objetivo_id = 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc'
  union all
  select 'con_alias', s.created_at from public.supervisiones s
   where s.estado <> 'incompleta'
     and public.objetivo_canonico_en(s.objetivo_id, s.created_at) = 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc'
), s as (
  select modo, created_at, lead(created_at) over (partition by modo order by created_at) as sig from s0
), v as (
  select modo, created_at + interval '24 hours' as vencio, sig from s
   where coalesce(sig, now()) > created_at + interval '24 hours'
)
select modo,
       count(*) filter (where vencio < p.t1 and coalesce(sig, now()) > p.t0) as vencimientos,
       round(sum(extract(epoch from (least(coalesce(sig, p.t1), p.t1) - greatest(vencio, p.t0))) / 3600)
             filter (where vencio < p.t1 and coalesce(sig, now()) > p.t0)::numeric, 1) as horas_vencidas
  from v, p group by modo order by modo;

rollback;   -- ← propuesta: nada queda creado
