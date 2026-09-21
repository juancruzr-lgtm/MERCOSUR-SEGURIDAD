-- ============================================================================
-- FASE 2C — Supervisiones: alcance por zona, sin legacy rol='admin'
-- ============================================================================
--
-- JC (21/09): reemplazar el gate legacy rol='admin'/rol='supervisor' (ownership)
-- de supervisiones por autorización moderna capacidad+alcance, con la regla:
--   · Vigilador           → NO.
--   · Supervisor          → supervisiones de SUS zonas (no sólo las propias).
--   · jefe_supervisores   → global.
--   · direccion_operativa → global.
--   · Administración      → global.
--   · Gerencia            → global.
-- supervision_fotos y supervision_respuestas HEREDAN el alcance de la
-- supervisión padre.
--
-- Mecanismo: `alcanza_objetivo_actual(objetivo_id)` ya codifica exactamente la
-- regla (todas → global; zonas_asignadas → objetivo en zona del supervisor;
-- 'propio'/vigilador → false). Las 3 tablas pasan a una única policy ALL por
-- alcance; se ELIMINAN las policies admin duplicadas y la de ownership por
-- supervisor_id. Para fotos/respuestas se agrega el helper
-- `alcanza_supervision_actual(supervision_id)` (SECURITY DEFINER: resuelve el
-- objetivo de la supervisión padre sin depender de la RLS de supervisiones).
--
-- El endpoint server /api/save-supervision (service_role) valida el alcance con
-- `alcanza_objetivo(usuario_id, objetivo_id)` (variante con usuario explícito),
-- fuera de esta migración.
--
-- ROLLBACK: supabase/rollback/20260921120000_fase2c_supervisiones_alcance_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1) Helper: ¿el actor alcanza la supervisión (por el objetivo de su padre)?
create or replace function public.alcanza_supervision_actual(p_supervision_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.supervisiones s
    where s.id = p_supervision_id
      and public.alcanza_objetivo_actual(s.objetivo_id)
  )
$function$;
revoke all on function public.alcanza_supervision_actual(uuid) from public, anon;
grant execute on function public.alcanza_supervision_actual(uuid) to authenticated;

-- 2) supervisiones — una policy ALL por alcance del objetivo.
drop policy if exists "Admin CRUD supervisiones"          on public.supervisiones;
drop policy if exists "Admin lee supervisiones"           on public.supervisiones;
drop policy if exists "Supervisor CRUD sus supervisiones" on public.supervisiones;
create policy supervisiones_alcance on public.supervisiones
  for all to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id))
  with check (public.alcanza_objetivo_actual(objetivo_id));

-- 3) supervision_fotos — heredan el alcance del padre.
drop policy if exists "Admin CRUD supervision_fotos"          on public.supervision_fotos;
drop policy if exists "Admin lee supervision_fotos"           on public.supervision_fotos;
drop policy if exists "Supervisor CRUD sus supervision_fotos" on public.supervision_fotos;
create policy supervision_fotos_alcance on public.supervision_fotos
  for all to authenticated
  using (public.alcanza_supervision_actual(supervision_id))
  with check (public.alcanza_supervision_actual(supervision_id));

-- 4) supervision_respuestas — heredan el alcance del padre.
drop policy if exists "Admin CRUD supervision_respuestas"          on public.supervision_respuestas;
drop policy if exists "Admin lee supervision_respuestas"           on public.supervision_respuestas;
drop policy if exists "Supervisor CRUD sus supervision_respuestas" on public.supervision_respuestas;
create policy supervision_respuestas_alcance on public.supervision_respuestas
  for all to authenticated
  using (public.alcanza_supervision_actual(supervision_id))
  with check (public.alcanza_supervision_actual(supervision_id));

commit;

notify pgrst, 'reload schema';
