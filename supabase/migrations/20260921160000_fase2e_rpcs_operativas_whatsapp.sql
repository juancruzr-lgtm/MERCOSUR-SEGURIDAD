-- ============================================================================
-- FASE 2E — Cerrar legacy operativo: 4 RPCs por alcance + bug WhatsApp + muerto
-- ============================================================================
--
-- JC (21/09): cerrar SOLO los restos legacy con impacto operativo real.
--
-- PARTE A — 4 RPCs SECURITY DEFINER que autorizaban por rol='admin' (dejaban
-- afuera a Aldo jefe_supervisores). Se reemplaza el gate por alcance real usando
-- el helper canónico `puede_administrar_rondas_objetivo(objetivo_id)` (=
-- es_operador + alcanza_objetivo(usuario, objetivo): vigilador NO; supervisor por
-- zona; jefe/dir_operativa/administracion/gerencia global). NO se toca ninguna
-- lógica de negocio: sólo autorización/alcance.
--   · anular_cobertura_manual_operativa y corregir_turno_manual_operativo YA
--     chequean puede_administrar_rondas_objetivo(turno.objetivo_id); sólo se
--     quita el gate `rol='admin'` del actor (redundante y excluyente).
--   · declarar_estructura_programacion (objetivo p_objetivo_id) y
--     vincular_servicio_puesto (objetivo del servicio) NO tenían chequeo de
--     alcance: se quita rol='admin' y se AGREGA puede_administrar_rondas_objetivo.
-- El cuerpo se preserva textualmente (pg_get_functiondef + regexp_replace); el
-- DO-block valida que el gate quedó removido y el alcance presente.
--
-- PARTE B — Bug de permisos en policies WhatsApp/escalamiento: comparaban
-- `u.id = auth.uid()` (usuarios.id vs auth.users.id → nunca matchea, admin no
-- accedía por RLS). Se corrige a `u.auth_user_id = auth.uid()` (+ estado activo),
-- conservando el gate rol='admin'. Los crons/service_role no usan RLS → intactos.
--
-- PARTE C — Código muerto: drop `current_usuario_rol()` (0 consumidores:
-- policies/funciones/vistas/triggers/código). `puedeEscribirPosiciones` (TS) NO
-- se toca: sus tests unitarios siguen referenciándola (reportado).
--
-- ROLLBACK: supabase/rollback/20260921160000_fase2e_rpcs_operativas_whatsapp_rollback.sql
-- ============================================================================

begin;

-- ── PARTE A — 4 RPCs por alcance (preserva cuerpo) ──────────────────────────
do $do$
declare v_src text;
begin
  -- anular_cobertura_manual_operativa
  v_src := pg_get_functiondef('public.anular_cobertura_manual_operativa(uuid,uuid,text)'::regprocedure);
  v_src := regexp_replace(v_src, 'and\s+([a-z]+\.)?rol\s*=\s*''admin''', '', 'gi');
  if v_src ~* 'rol\s*=\s*''admin''' then raise exception 'anular: rol=admin no removido'; end if;
  if v_src not ilike '%puede_administrar_rondas_objetivo%' then raise exception 'anular: falta alcance'; end if;
  execute v_src;

  -- corregir_turno_manual_operativo
  v_src := pg_get_functiondef('public.corregir_turno_manual_operativo(uuid,uuid,date,time without time zone,time without time zone,uuid,text)'::regprocedure);
  v_src := regexp_replace(v_src, 'and\s+([a-z]+\.)?rol\s*=\s*''admin''', '', 'gi');
  if v_src ~* 'rol\s*=\s*''admin''' then raise exception 'corregir: rol=admin no removido'; end if;
  if v_src not ilike '%puede_administrar_rondas_objetivo%' then raise exception 'corregir: falta alcance'; end if;
  execute v_src;

  -- declarar_estructura_programacion (agrega alcance sobre p_objetivo_id)
  v_src := pg_get_functiondef('public.declarar_estructura_programacion(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  v_src := regexp_replace(v_src, 'and\s+([a-z]+\.)?rol\s*=\s*''admin''', '', 'gi');
  v_src := regexp_replace(v_src,
    '(Objetivo de prueba excluido de la programacion'';\s*END IF;)',
    E'\\1 IF NOT public.puede_administrar_rondas_objetivo(p_objetivo_id) THEN RAISE EXCEPTION ''El objetivo esta fuera de tu alcance''; END IF;',
    'i');
  if v_src ~* 'rol\s*=\s*''admin''' then raise exception 'declarar: rol=admin no removido'; end if;
  if v_src not ilike '%puede_administrar_rondas_objetivo(p_objetivo_id)%' then raise exception 'declarar: alcance no inyectado'; end if;
  execute v_src;

  -- vincular_servicio_puesto (agrega alcance sobre el objetivo del servicio)
  v_src := pg_get_functiondef('public.vincular_servicio_puesto(uuid,uuid)'::regprocedure);
  v_src := regexp_replace(v_src, 'and\s+([a-z]+\.)?rol\s*=\s*''admin''', '', 'gi');
  v_src := regexp_replace(v_src,
    '(''Servicio inexistente'';\s*END IF;)',
    E'\\1 IF NOT public.puede_administrar_rondas_objetivo(v_servicio.objetivo_id) THEN RAISE EXCEPTION ''El servicio esta fuera de tu alcance''; END IF;',
    'i');
  if v_src ~* 'rol\s*=\s*''admin''' then raise exception 'vincular: rol=admin no removido'; end if;
  if v_src not ilike '%puede_administrar_rondas_objetivo(v_servicio.objetivo_id)%' then raise exception 'vincular: alcance no inyectado'; end if;
  execute v_src;
end $do$;

-- ── PARTE B — Fix bug de join en policies WhatsApp/escalamiento ──────────────
drop policy if exists admin_gestiona_destinatarios on public.escalamiento_destinatarios;
create policy admin_gestiona_destinatarios on public.escalamiento_destinatarios
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol = 'admin'));

drop policy if exists admin_lee_auditoria on public.escalamiento_whatsapp_envios;
create policy admin_lee_auditoria on public.escalamiento_whatsapp_envios
  for select to authenticated
  using (exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol = 'admin'));

drop policy if exists admin_lee_estados on public.whatsapp_mensaje_estados;
create policy admin_lee_estados on public.whatsapp_mensaje_estados
  for select to authenticated
  using (exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.rol = 'admin'));

-- ── PARTE C — Código muerto ─────────────────────────────────────────────────
drop function if exists public.current_usuario_rol();

commit;

notify pgrst, 'reload schema';
