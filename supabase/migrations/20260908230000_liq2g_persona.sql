-- ============================================================================
-- LIQ2G/A — Padrón canónico de personas liquidables (desacopla de usuarios)
-- ============================================================================
-- Una persona puede ser liquidable aunque NO tenga usuario/login ni actividad
-- operativa. `usuario_id` es nullable (link si existe). Identidad por CUIL.
-- No crea usuarios ficticios. El generador Visual parte de este padrón.
--
-- ROLLBACK: supabase/rollback/20260908230000_liq2g_persona_rollback.sql
-- ============================================================================

create table if not exists public.liquidacion_persona (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid references public.usuarios(id),          -- nullable: puede no tener login
  cuil              text,
  nombre            text,
  cod_interno       text,                                         -- = legajo_visual de Visual
  estado_liquidable text not null default 'activo' check (estado_liquidable in ('activo','baja')),
  origen            text not null default 'usuario',              -- usuario | visual | manual
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cuil)
);
create index if not exists ix_liq_persona_usuario on public.liquidacion_persona (usuario_id);

alter table public.liquidacion_persona enable row level security;
revoke all on public.liquidacion_persona from anon;
drop policy if exists liquidacion_persona_gerencia on public.liquidacion_persona;
create policy liquidacion_persona_gerencia on public.liquidacion_persona
  for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());

-- Backfill: una persona por usuario liquidable (activo, no prueba, CUIL válido).
insert into public.liquidacion_persona (usuario_id, cuil, nombre, cod_interno, estado_liquidable, origen)
select u.id, regexp_replace(coalesce(u.cuil,''),'\D','','g'),
       nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), u.legajo_visual, 'activo', 'usuario'
from public.usuarios u
where u.estado = 'activo' and coalesce(u.es_prueba,false) = false
  and length(regexp_replace(coalesce(u.cuil,''),'\D','','g')) = 11
on conflict (cuil) do nothing;

-- Alta de las 6 personas que existen en Visual pero NO como usuarios operativos.
insert into public.liquidacion_persona (usuario_id, cuil, nombre, cod_interno, estado_liquidable, origen) values
  (null,'23395054309','JOEL ALEXIS JULIAN JUAREZ','1 JUAREZ JOEL','activo','visual'),
  (null,'23174138664','MARIA ANDREA NARVARTE','1 NARVARTE','activo','visual'),
  (null,'23322899599','FACUNDO MARTIN ROMERO','1 ROMERO F','activo','visual'),
  (null,'20313933335','JUAN CRUZ ROMERO','1 ROMERO jc','activo','visual'),
  (null,'27130777487','LAURA NORA MAGARO','1.1 MAGARO','activo','visual'),
  (null,'23142066599','ADRIAN OMAR GURUCHAR','GURUCHAR','activo','visual')
on conflict (cuil) do nothing;
