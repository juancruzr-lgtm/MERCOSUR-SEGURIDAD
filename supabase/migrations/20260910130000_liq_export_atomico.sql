-- ============================================================================
-- LIQ · EXPORTACIÓN ATÓMICA — consolidar + enviar + exportar en una transacción
-- ============================================================================
-- Simplificación del flujo (pedido de JC): se elimina el paso manual
-- "Consolidar". "Generar archivo Visual" pasa a hacer TODO de forma atómica y
-- coherente, sobre UNA sola preparación de datos hecha en el cliente:
--
--   borrador/revision → Prevalidar → Generar archivo Visual → exportada
--
-- Esta migración agrega UNA función nueva, `exportar_liquidacion_periodo`, que
-- en una sola transacción:
--   1) congela `liquidacion_consolidada` (qué salió de MERCOSUR),
--   2) registra `liquidacion_enviado_visual` (qué se mandó a Visual),
--   3) marca el período `exportada` (con consolidado_at y exportada_at + actores).
--
-- Es la fusión atómica de lo que hoy hacen, en tres transacciones separadas,
-- `consolidar_periodo` + `registrar_enviado_visual` + `marcar_exportada_visual`.
-- El cálculo sigue viviendo en el cliente (fuente única): acá sólo se persiste.
--
-- NO se eliminan las RPC viejas (compatibilidad/histórico): quedan definidas,
-- la UI nueva simplemente deja de llamarlas.
--
-- ADITIVA Y REVERSIBLE. No toca tablas, ni columnas, ni datos, ni el resto de
-- las RPC. Períodos legacy en estado 'consolidada' quedan soportados: la función
-- los acepta (estado ∉ {exportada, liquidada}) y termina en 'exportada'.
--
-- ROLLBACK:     supabase/rollback/20260910130000_liq_export_atomico_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910130000_liq_export_atomico_pre_post.sql
-- ============================================================================

begin;

-- Guardas de dependencia: aborta si falta alguna pieza que la función asume.
do $$
begin
  if to_regclass('public.liquidacion_periodo')        is null then raise exception 'falta public.liquidacion_periodo'; end if;
  if to_regclass('public.liquidacion_consolidada')    is null then raise exception 'falta public.liquidacion_consolidada'; end if;
  if to_regclass('public.liquidacion_enviado_visual') is null then raise exception 'falta public.liquidacion_enviado_visual'; end if;
  if to_regprocedure('public.es_gerencia_actual()')   is null then raise exception 'falta public.es_gerencia_actual()'; end if;
end $$;

create or replace function public.exportar_liquidacion_periodo(
  p_periodo_id  uuid,
  p_consolidada jsonb,  -- [{empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe}]
  p_enviado     jsonb   -- [{cuil, cod_interno, codigo, cantidad, importe}]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_actor  uuid;
  v_estado text;
  f  jsonb;
  ln jsonb;
  v_cons int := 0;
  v_env  int := 0;
begin
  -- Autorización: misma regla que consolidar/marcar_exportada (Gerencia).
  -- Con service_role (v_uid null) se omite el gate, igual que en las otras RPC.
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede exportar liquidaciones a Visual';
  end if;

  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado = 'activo';

  -- Lock del período: evita dos exportaciones simultáneas / estado parcial.
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id for update;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('exportada', 'liquidada') then
    raise exception 'El período está % : no se puede re-exportar', v_estado;
  end if;

  -- 1) Snapshot consolidado (nace de cero: cada exportación reemplaza).
  delete from public.liquidacion_consolidada where periodo_id = p_periodo_id;
  for f in select * from jsonb_array_elements(coalesce(p_consolidada, '[]'::jsonb)) loop
    if nullif(f->>'empleado_id','') is null or nullif(f->>'codigo','') is null then continue; end if;
    insert into public.liquidacion_consolidada
        (periodo_id, empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe)
      values (p_periodo_id, (f->>'empleado_id')::uuid, nullif(f->>'legajo_visual',''), nullif(f->>'cuil',''),
              nullif(f->>'nombre',''), f->>'codigo',
              coalesce(nullif(f->>'cantidad','')::numeric, 1), nullif(f->>'importe','')::numeric)
      on conflict (periodo_id, empleado_id, codigo) do update
        set cantidad = excluded.cantidad, importe = excluded.importe,
            legajo_visual = excluded.legajo_visual, cuil = excluded.cuil, nombre = excluded.nombre;
    v_cons := v_cons + 1;
  end loop;
  if v_cons = 0 then raise exception 'No hay filas consolidadas para exportar'; end if;

  -- 2) Enviado a Visual (lo que efectivamente se mandó; congelado en el mismo acto).
  delete from public.liquidacion_enviado_visual where periodo_id = p_periodo_id;
  for ln in select * from jsonb_array_elements(coalesce(p_enviado, '[]'::jsonb)) loop
    if nullif(ln->>'codigo','') is null then continue; end if;
    insert into public.liquidacion_enviado_visual
        (periodo_id, cuil, cod_interno, codigo, cantidad, importe)
      values (p_periodo_id, nullif(ln->>'cuil',''), nullif(ln->>'cod_interno',''), ln->>'codigo',
              nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric)
      on conflict (periodo_id, cuil, codigo) do update
        set cantidad = excluded.cantidad, importe = excluded.importe, cod_interno = excluded.cod_interno;
    v_env := v_env + 1;
  end loop;

  -- 3) Estado + trazabilidad: consolidado_at (si no lo tenía) y exportada_at, un solo acto.
  update public.liquidacion_periodo
     set estado          = 'exportada',
         consolidado_at  = coalesce(consolidado_at, now()),
         consolidado_por = coalesce(consolidado_por, v_actor),
         exportada_at    = now(),
         exportada_por   = v_actor,
         updated_at      = now()
   where id = p_periodo_id;

  return jsonb_build_object('consolidada', v_cons, 'enviado', v_env, 'estado', 'exportada');
end;
$fn$;

comment on function public.exportar_liquidacion_periodo(uuid, jsonb, jsonb) is
  'Exportación atómica: congela liquidacion_consolidada + liquidacion_enviado_visual '
  'y pasa el período a exportada, en una transacción. Reemplaza el trío '
  'consolidar_periodo + registrar_enviado_visual + marcar_exportada_visual desde la UI.';

revoke all on function public.exportar_liquidacion_periodo(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.exportar_liquidacion_periodo(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
