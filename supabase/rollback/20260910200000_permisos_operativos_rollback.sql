-- ============================================================================
-- ROLLBACK de 20260910200000_permisos_operativos_b1_d1_d2.sql
-- Restaura el estado anterior: puestos vuelve a rol='admin', se eliminan las
-- RPC/funciones nuevas. ⚠️ Vuelve a bloquear a supervisores/jefe para crear
-- objetivos, puestos y alta/baja de vigiladores. Archivo aparte, nunca junto a
-- la migración.
-- ============================================================================

begin;

-- ── D1: puestos vuelve a rol='admin' ────────────────────────────────────────
drop policy if exists puestos_insert_alcance on public.puestos;
drop policy if exists puestos_update_alcance on public.puestos;
drop policy if exists puestos_delete_alcance on public.puestos;

drop policy if exists "Admin escribe puestos" on public.puestos;
create policy "Admin escribe puestos" on public.puestos
  for insert to authenticated
  with check (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'::text));

drop policy if exists "Admin actualiza puestos" on public.puestos;
create policy "Admin actualiza puestos" on public.puestos
  for update to authenticated
  using (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'::text));

drop policy if exists "Admin elimina puestos" on public.puestos;
create policy "Admin elimina puestos" on public.puestos
  for delete to authenticated
  using (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'::text));

grant truncate, references, trigger on table public.puestos to authenticated;

-- ── B1 / D2 / helpers: se eliminan las funciones nuevas ─────────────────────
drop function if exists public.resolver_solicitud_personal_operativo(uuid);
drop function if exists public.crear_objetivo_operativo(uuid,text,text,text,text,uuid,integer,text,integer,boolean,time,time);
drop function if exists public.puede_gestionar_personal_operativo_actual();
drop function if exists public.alcanza_baja_vigilador_actual(uuid);
drop function if exists public.alcanza_zona_actual(uuid);

commit;

notify pgrst, 'reload schema';
