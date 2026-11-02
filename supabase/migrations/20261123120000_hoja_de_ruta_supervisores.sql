-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- Hoja de ruta de supervisores por WhatsApp (auditoría 10/2026, punto 4.2)
-- ============================================================================
-- Diseño: docs/auditoria-2026-10/hoja_de_ruta_supervisores.md
-- Pruebas: supabase/pruebas/hoja-de-ruta/run.mjs (PGlite)
-- Rollback: supabase/rollback/20261123120000_hoja_de_ruta_supervisores_rollback.sql
--
-- Al terminar cada turno de supervisor, un WhatsApp por destinatario con las
-- visitas del turno (supervisiones) y su novedad textual. Destinatarios:
-- configurables por Gerencia (hoy: Jefe de Supervisores y Director Técnico).
--
-- Por qué tablas propias y no escalamiento_whatsapp_envios: esa tabla exige
-- turno_id (FK a turnos de vigiladores) y un CHECK de nivel sólo para alertas,
-- y sus topes por destinatario se cuentan sobre todas sus filas: la hoja de
-- ruta consumiría el tope de las alertas. Se reutiliza el MISMO patrón de la
-- migración 20261121130000: reclamo atómico por clave única ANTES de llamar a
-- Meta, cierre idempotente después, fail-closed ante cualquier error.
--
-- Un solo mensaje por (turno, destinatario): índice único. Sin reintentos
-- automáticos (un fallo queda 'fallido' a la vista; mandar dos veces es peor
-- que no mandar). Lo que excede el límite de WhatsApp no se recorta: queda
-- 'excede_limite' sin enviar.
--
-- NO toca: alertas, escalamiento, turnos, supervisiones ni datos existentes.
-- No crea cron: el envío queda apagado (HOJA_DE_RUTA_WHATSAPP) hasta que
-- Gerencia lo autorice.
-- ============================================================================

begin;

create table if not exists public.hoja_ruta_destinatarios (
  usuario_id      uuid primary key references public.usuarios(id),
  descripcion     text not null check (char_length(btrim(descripcion)) between 3 and 80),
  activo          boolean not null default true,
  actualizado_por uuid references public.usuarios(id),
  actualizado_at  timestamptz not null default now()
);

alter table public.hoja_ruta_destinatarios enable row level security;
revoke all on public.hoja_ruta_destinatarios from public, anon, authenticated;
grant select on public.hoja_ruta_destinatarios to authenticated;
grant all on public.hoja_ruta_destinatarios to service_role;
drop policy if exists hoja_ruta_destinatarios_lectura on public.hoja_ruta_destinatarios;
create policy hoja_ruta_destinatarios_lectura on public.hoja_ruta_destinatarios
  for select to authenticated using (public.puede_acceder_gerencia_actual());

-- Gerencia agrega, desactiva o reactiva destinatarios. Identidad por auth.uid().
create or replace function public.hoja_ruta_guardar_destinatario(
  p_usuario_id uuid, p_descripcion text, p_activo boolean)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_yo uuid;
begin
  if not public.puede_acceder_gerencia_actual() then
    raise exception 'No autorizado: los destinatarios de la hoja de ruta los define Gerencia';
  end if;
  select u.id into v_yo from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1;
  if not exists (select 1 from public.usuarios u where u.id = p_usuario_id and u.estado = 'activo') then
    raise exception 'Usuario inexistente o inactivo';
  end if;
  insert into public.hoja_ruta_destinatarios (usuario_id, descripcion, activo, actualizado_por, actualizado_at)
  values (p_usuario_id, btrim(p_descripcion), coalesce(p_activo, true), v_yo, now())
  on conflict (usuario_id) do update
    set descripcion = excluded.descripcion, activo = excluded.activo,
        actualizado_por = excluded.actualizado_por, actualizado_at = now();
end $$;
revoke all on function public.hoja_ruta_guardar_destinatario(uuid, text, boolean) from public, anon;
grant execute on function public.hoja_ruta_guardar_destinatario(uuid, text, boolean) to authenticated;

create table if not exists public.hoja_ruta_envios (
  id              uuid primary key default gen_random_uuid(),
  clave_turno     text not null,
  supervisor_id   uuid not null references public.usuarios(id),
  guardia_ids     uuid[] not null,
  turno_desde     timestamptz not null,
  turno_hasta     timestamptz not null,
  destinatario_id uuid not null references public.usuarios(id),
  telefono        text,
  mensaje         text not null,
  caracteres      integer not null,
  resultado       text not null check (resultado in
                    ('reclamado', 'enviado', 'fallido', 'fuera_de_ventana', 'excede_limite', 'sin_telefono')),
  id_proveedor    text,
  error           text,
  created_at      timestamptz not null default now(),
  completado_at   timestamptz,
  constraint hoja_ruta_envios_uno_por_turno unique (clave_turno, destinatario_id)
);
create index if not exists hoja_ruta_envios_turno_hasta_idx on public.hoja_ruta_envios (turno_hasta desc);

alter table public.hoja_ruta_envios enable row level security;
revoke all on public.hoja_ruta_envios from public, anon, authenticated;
grant select on public.hoja_ruta_envios to authenticated;
grant select, insert, update on public.hoja_ruta_envios to service_role;
drop policy if exists hoja_ruta_envios_lectura on public.hoja_ruta_envios;
create policy hoja_ruta_envios_lectura on public.hoja_ruta_envios
  for select to authenticated using (public.puede_acceder_gerencia_actual());

-- Reclamo atómico: inserta la fila ANTES de llamar a Meta. Si ya existe (otra
-- corrida, o ya salió) → ok:false y NO se envía. Un resultado terminal
-- (excede_limite / sin_telefono) se registra igual, para que se vea y no se
-- vuelva a evaluar.
create or replace function public.reclamar_hoja_ruta_envio(p_fila jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare
  v_resultado text := coalesce(p_fila->>'resultado', 'reclamado');
  v_id uuid;
begin
  if v_resultado not in ('reclamado', 'excede_limite', 'sin_telefono') then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;
  insert into public.hoja_ruta_envios
    (clave_turno, supervisor_id, guardia_ids, turno_desde, turno_hasta, destinatario_id, telefono,
     mensaje, caracteres, resultado, completado_at)
  values (p_fila->>'clave_turno', (p_fila->>'supervisor_id')::uuid,
          array(select jsonb_array_elements_text(p_fila->'guardia_ids'))::uuid[],
          (p_fila->>'turno_desde')::timestamptz, (p_fila->>'turno_hasta')::timestamptz,
          (p_fila->>'destinatario_id')::uuid, p_fila->>'telefono',
          p_fila->>'mensaje', (p_fila->>'caracteres')::integer, v_resultado,
          case when v_resultado = 'reclamado' then null else now() end)
  on conflict on constraint hoja_ruta_envios_uno_por_turno do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'ya_reclamado');
  end if;
  if v_resultado <> 'reclamado' then
    return jsonb_build_object('ok', false, 'motivo', v_resultado, 'id', v_id);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.reclamar_hoja_ruta_envio(jsonb) from public, anon, authenticated;
grant execute on function public.reclamar_hoja_ruta_envio(jsonb) to service_role;

-- Cierre idempotente: sólo completa filas 'reclamado'.
create or replace function public.completar_hoja_ruta_envio(
  p_id uuid, p_ok boolean, p_id_proveedor text, p_error text, p_fuera_de_ventana boolean default false)
returns boolean
language plpgsql security invoker set search_path = public, pg_catalog as $$
begin
  update public.hoja_ruta_envios
     set resultado = case when p_ok then 'enviado' when p_fuera_de_ventana then 'fuera_de_ventana' else 'fallido' end,
         id_proveedor = p_id_proveedor, error = p_error, completado_at = now()
   where id = p_id and resultado = 'reclamado';
  return found;
end $$;
revoke all on function public.completar_hoja_ruta_envio(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.completar_hoja_ruta_envio(uuid, boolean, text, text, boolean) to service_role;

commit;

-- ── Carga inicial de destinatarios (NO se ejecuta acá; la hace Gerencia desde
-- la pantalla o, con autorización, este bloque con los ids verificados) ──────
-- select public.hoja_ruta_guardar_destinatario('<id Aldo Monzón>',   'Jefe de Supervisores', true);
-- select public.hoja_ruta_guardar_destinatario('<id Rodolfo Romero>', 'Director Técnico',     true);
--
-- ── Verificación (solo lectura, después de aplicar) ───────────────────────
-- select to_regclass('public.hoja_ruta_envios'), to_regclass('public.hoja_ruta_destinatarios');
-- select resultado, count(*) from public.hoja_ruta_envios group by 1;
