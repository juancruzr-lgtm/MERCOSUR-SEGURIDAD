-- ============================================================================
-- Seguridad (auditoría alta de vigiladores 06/11/2026) — REGISTRO DE INVITACIONES
-- ============================================================================
-- Cada envío de invitación (cuenta nueva) o de enlace para crear contraseña
-- (cuenta existente) queda registrado: a quién, a qué email, quién lo pidió,
-- cuándo y con qué resultado. Lo escribe sólo el servidor (service_role) desde
-- app/api/_lib/acceso-invitacion.ts. Lo leen Administración y Gerencia.
-- Es un historial: no se edita ni se borra.
--
-- Rollback: supabase/rollback/20261208100100_accesos_invitaciones_rollback.sql
-- ============================================================================

begin;

create table if not exists public.accesos_invitaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references public.usuarios(id),
  auth_user_id  uuid,
  email         text,
  tipo          text check (tipo in ('invitacion', 'enlace_password')),
  origen        text not null check (origen in ('alta_postulante', 'administracion')),
  referencia_id uuid,
  resultado     text not null check (resultado in ('enviado', 'omitido', 'error')),
  detalle       text check (char_length(detalle) <= 300),
  enviado_por   uuid references public.usuarios(id),
  enviado_at    timestamptz not null default now()
);

create index if not exists accesos_invitaciones_usuario_idx on public.accesos_invitaciones (usuario_id, enviado_at desc);

alter table public.accesos_invitaciones enable row level security;
revoke all on public.accesos_invitaciones from anon, authenticated;
grant select on public.accesos_invitaciones to authenticated;

drop policy if exists "Accesos invitaciones: Administracion y Gerencia" on public.accesos_invitaciones;
create policy "Accesos invitaciones: Administracion y Gerencia" on public.accesos_invitaciones
  for select to authenticated
  using ((select public.legajo_puede_gestionar()));

drop policy if exists "acceso_bloqueado_baja" on public.accesos_invitaciones;
create policy "acceso_bloqueado_baja" on public.accesos_invitaciones
  as restrictive for all to authenticated
  using ((select public.acceso_habilitado_actual()))
  with check ((select public.acceso_habilitado_actual()));

create or replace function public.accesos_invitaciones_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'El registro de invitaciones no se modifica ni se borra' using errcode = '42501';
end;
$$;

drop trigger if exists trg_accesos_invitaciones_inmutable on public.accesos_invitaciones;
create trigger trg_accesos_invitaciones_inmutable
  before update or delete on public.accesos_invitaciones
  for each row execute function public.accesos_invitaciones_inmutable();

commit;
