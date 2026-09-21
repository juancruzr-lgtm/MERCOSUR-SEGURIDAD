-- ROLLBACK de 20260921160000_fase2e_rpcs_operativas_whatsapp.sql
-- Restaura: gate rol='admin' en las 4 RPCs (y quita el alcance inyectado en
-- declarar/vincular), el bug original de las policies WhatsApp (u.id = auth.uid())
-- y recrea current_usuario_rol(). OJO: reabre la exclusión de Aldo y el bug.

begin;

-- ── PARTE A (reverse) ───────────────────────────────────────────────────────
do $do$
declare v_src text;
begin
  -- anular: re-agregar rol='admin' al actor
  v_src := pg_get_functiondef('public.anular_cobertura_manual_operativa(uuid,uuid,text)'::regprocedure);
  v_src := regexp_replace(v_src, '(x\.estado\s*=\s*''activo'')', E'\\1 and x.rol=''admin''', 'i');
  execute v_src;

  -- corregir: re-agregar rol='admin'
  v_src := pg_get_functiondef('public.corregir_turno_manual_operativo(uuid,uuid,date,time without time zone,time without time zone,uuid,text)'::regprocedure);
  v_src := regexp_replace(v_src, '(u\.estado\s*=\s*''activo'')', E'\\1 AND u.rol = ''admin''', 'i');
  execute v_src;

  -- declarar: re-agregar rol='admin' y quitar alcance inyectado
  v_src := pg_get_functiondef('public.declarar_estructura_programacion(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  v_src := regexp_replace(v_src, '(auth_user_id = v_uid AND estado = ''activo'')', E'\\1 AND rol = ''admin''', 'i');
  v_src := regexp_replace(v_src, '\s*IF NOT public\.puede_administrar_rondas_objetivo\(p_objetivo_id\) THEN RAISE EXCEPTION ''El objetivo esta fuera de tu alcance''; END IF;', '', 'i');
  execute v_src;

  -- vincular: re-agregar rol='admin' y quitar alcance inyectado
  v_src := pg_get_functiondef('public.vincular_servicio_puesto(uuid,uuid)'::regprocedure);
  v_src := regexp_replace(v_src, '(auth_user_id = v_uid AND estado = ''activo'')', E'\\1 AND rol = ''admin''', 'i');
  v_src := regexp_replace(v_src, '\s*IF NOT public\.puede_administrar_rondas_objetivo\(v_servicio\.objetivo_id\) THEN RAISE EXCEPTION ''El servicio esta fuera de tu alcance''; END IF;', '', 'i');
  execute v_src;
end $do$;

-- ── PARTE B (reverse: bug original) ─────────────────────────────────────────
drop policy if exists admin_gestiona_destinatarios on public.escalamiento_destinatarios;
create policy admin_gestiona_destinatarios on public.escalamiento_destinatarios
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

drop policy if exists admin_lee_auditoria on public.escalamiento_whatsapp_envios;
create policy admin_lee_auditoria on public.escalamiento_whatsapp_envios
  for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

drop policy if exists admin_lee_estados on public.whatsapp_mensaje_estados;
create policy admin_lee_estados on public.whatsapp_mensaje_estados
  for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

-- ── PARTE C (reverse) ───────────────────────────────────────────────────────
create or replace function public.current_usuario_rol()
returns text language sql stable security definer set search_path to 'public' as $function$
  select rol from public.usuarios where auth_user_id = auth.uid() and estado = 'activo' limit 1
$function$;

commit;

notify pgrst, 'reload schema';
