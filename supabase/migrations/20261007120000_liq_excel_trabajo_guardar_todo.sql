-- ============================================================================
-- 20261007120000 · Excel de trabajo: se guarda TODO lo que Juan cambia (JC 07/10)
-- ============================================================================
-- Hasta ahora, al reimportar el Excel de trabajo sólo se guardaban las variables
-- de entrada por persona. Se perdían:
--   · los PARÁMETROS del mes (Básico, Presentismo, Viático, No remunerativo,
--     valor hora extra, y hora/día si se fijaron a mano) → el sistema volvía a
--     los valores fijos del código;
--   · los importes CALCULADOS pisados a mano (p. ej. un viático escrito sobre la
--     fórmula);
--   · los TEXTOS editados (nombre, novedades, objetivo/s, observación);
--   · las correcciones que se DESHACÍAN (volver al valor del sistema no borraba
--     el ajuste anterior).
--
-- Esta migración agrega:
--   1) liquidacion_parametro_mes: parámetros por mes. Los meses siguientes los
--      heredan (hora/día manuales valen sólo para su mes).
--   2) liquidacion_ajuste.valor_texto: para los textos editados ('texto:D', …).
--      Los importes pisados usan la tabla existente con clave 'celda:<COL>'.
--   3) guardar_reimport_excel_trabajo(): guarda parámetros + ajustes + quitas
--      de UNA subida en UNA transacción, con lote, dedupe por hash y auditoría.
--      Reemplaza el uso de aplicar_ajustes_liquidacion desde la pantalla (que se
--      conserva intacta).
--
-- No modifica datos existentes.
-- ROLLBACK:     supabase/rollback/20261007120000_liq_excel_trabajo_guardar_todo_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20261007120000_liq_excel_trabajo_guardar_todo_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.liquidacion_ajuste') is null then raise exception 'falta public.liquidacion_ajuste'; end if;
  if to_regclass('public.liquidacion_importacion') is null then raise exception 'falta public.liquidacion_importacion'; end if;
  if to_regclass('public.liquidacion_auditoria') is null then raise exception 'falta public.liquidacion_auditoria'; end if;
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta public.puede_liquidar_actual()'; end if;
end $$;

-- 1) Parámetros salariales por mes ------------------------------------------
create table if not exists public.liquidacion_parametro_mes (
  id          uuid primary key default gen_random_uuid(),
  mes         text not null check (mes ~ '^\d{4}-\d{2}$'),
  clave       text not null check (clave in ('basico','presentismo','viatico','no_rem','hora_extra','hora','dia')),
  valor       numeric not null check (valor >= 0),
  lote_id     uuid references public.liquidacion_importacion(id) on delete set null,
  updated_by  uuid references public.usuarios(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (mes, clave)
);
create index if not exists ix_liq_parametro_mes on public.liquidacion_parametro_mes (clave, mes desc);

alter table public.liquidacion_parametro_mes enable row level security;
revoke all on public.liquidacion_parametro_mes from anon, authenticated;
grant select on public.liquidacion_parametro_mes to authenticated;
drop policy if exists liq_parametro_mes_lectura on public.liquidacion_parametro_mes;
create policy liq_parametro_mes_lectura on public.liquidacion_parametro_mes
  for select to authenticated using (public.puede_liquidar_actual());

-- 2) Textos editados en el Excel ---------------------------------------------
alter table public.liquidacion_ajuste add column if not exists valor_texto text;

-- 3) Guardado atómico de una subida del Excel de trabajo -----------------------
--   p_ajustes:    [{empleado_id, clave, etiqueta, valor_operativo, valor_liquidacion, valor_texto}]
--   p_quitar:     [{empleado_id, clave}]   (vuelven al valor del sistema; sólo origen excel_reimport)
--   p_parametros: [{clave, valor}]         (valor null = quitar hora/día manual del mes)
create or replace function public.guardar_reimport_excel_trabajo(
  p_periodo_id uuid,
  p_archivo    text,
  p_hash       text,
  p_motivo     text,
  p_ajustes    jsonb,
  p_quitar     jsonb,
  p_parametros jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_lote uuid;
  v_estado text;
  v_mes text;
  x jsonb;
  v_emp uuid;
  v_clave text;
  v_ant numeric;
  v_ant_txt text;
  v_existia boolean;
  v_val numeric;
  v_altas int := 0; v_cambios int := 0; v_quitados int := 0; v_params int := 0; v_errores int := 0;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede aplicar ajustes de liquidación';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado = 'activo';
  select estado, mes into v_estado, v_mes from public.liquidacion_periodo where id = p_periodo_id for update;
  if not found then raise exception 'Período inexistente'; end if;
  -- Mismo criterio de bloqueo que aplicar_ajustes_liquidacion.
  if v_estado in ('cerrado','exportado','anulado') then raise exception 'El período está % : no admite ajustes', v_estado; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_importacion where periodo_id = p_periodo_id and hash = p_hash) then
    raise exception 'Este archivo ya fue reimportado en este período (dedupe por hash)';
  end if;

  insert into public.liquidacion_importacion(periodo_id, archivo, hash, usuario_id)
    values (p_periodo_id, p_archivo, p_hash, v_actor) returning id into v_lote;

  -- Parámetros del mes del período.
  for x in select * from jsonb_array_elements(coalesce(p_parametros, '[]'::jsonb)) loop
    v_clave := nullif(x->>'clave', '');
    if v_clave is null or v_clave not in ('basico','presentismo','viatico','no_rem','hora_extra','hora','dia') then
      v_errores := v_errores + 1; continue;
    end if;
    v_val := nullif(x->>'valor', '')::numeric;
    select valor into v_ant from public.liquidacion_parametro_mes where mes = v_mes and clave = v_clave;
    if v_val is null then
      delete from public.liquidacion_parametro_mes where mes = v_mes and clave = v_clave;
    else
      insert into public.liquidacion_parametro_mes(mes, clave, valor, lote_id, updated_by)
        values (v_mes, v_clave, v_val, v_lote, v_actor)
        on conflict (mes, clave) do update
          set valor = excluded.valor, lote_id = excluded.lote_id, updated_by = excluded.updated_by, updated_at = now();
    end if;
    v_params := v_params + 1;
    insert into public.liquidacion_auditoria(periodo_id, empleado_id, codigo, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, null, 'param:' || v_clave, v_ant, v_val, 'parametro_excel', v_lote, v_actor, p_motivo);
  end loop;

  -- Ajustes (variables, celdas pisadas 'celda:*' y textos 'texto:*').
  for x in select * from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)) loop
    v_emp := nullif(x->>'empleado_id', '')::uuid;
    v_clave := nullif(x->>'clave', '');
    if v_emp is null or v_clave is null then v_errores := v_errores + 1; continue; end if;

    select true, valor_liquidacion, valor_texto into v_existia, v_ant, v_ant_txt
      from public.liquidacion_ajuste where periodo_id = p_periodo_id and empleado_id = v_emp and clave = v_clave;

    insert into public.liquidacion_ajuste(periodo_id, empleado_id, tipo, clave, etiqueta,
                                          valor_operativo, valor_liquidacion, valor_texto, origen, motivo, lote_id, created_by)
      values (p_periodo_id, v_emp, 'variable', v_clave, nullif(x->>'etiqueta', ''),
              nullif(x->>'valor_operativo', '')::numeric, nullif(x->>'valor_liquidacion', '')::numeric,
              x->>'valor_texto', 'excel_reimport', p_motivo, v_lote, v_actor)
      on conflict (periodo_id, empleado_id, clave) do update
        set valor_operativo = excluded.valor_operativo,
            valor_liquidacion = excluded.valor_liquidacion,
            valor_texto = excluded.valor_texto,
            etiqueta = excluded.etiqueta,
            origen = excluded.origen,
            motivo = excluded.motivo,
            lote_id = excluded.lote_id,
            created_by = excluded.created_by,
            updated_at = now();

    if coalesce(v_existia, false) then v_cambios := v_cambios + 1; else v_altas := v_altas + 1; end if;
    insert into public.liquidacion_auditoria(periodo_id, empleado_id, codigo, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, v_clave, v_ant, nullif(x->>'valor_liquidacion', '')::numeric, 'ajuste_excel', v_lote, v_actor,
              case when x ? 'valor_texto' then coalesce(p_motivo, '') || ' · texto: ' || coalesce(v_ant_txt, '∅') || ' → ' || coalesce(x->>'valor_texto', '∅') else p_motivo end);
    v_existia := null; v_ant := null; v_ant_txt := null;
  end loop;

  -- Correcciones deshechas en el Excel: vuelven al valor del sistema. Sólo las que
  -- vinieron de una subida del Excel (no toca ajustes de otro origen).
  for x in select * from jsonb_array_elements(coalesce(p_quitar, '[]'::jsonb)) loop
    v_emp := nullif(x->>'empleado_id', '')::uuid;
    v_clave := nullif(x->>'clave', '');
    if v_emp is null or v_clave is null then v_errores := v_errores + 1; continue; end if;
    delete from public.liquidacion_ajuste
      where periodo_id = p_periodo_id and empleado_id = v_emp and clave = v_clave and origen = 'excel_reimport'
      returning valor_liquidacion, valor_texto into v_ant, v_ant_txt;
    if not found then continue; end if;
    v_quitados := v_quitados + 1;
    insert into public.liquidacion_auditoria(periodo_id, empleado_id, codigo, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, v_clave, v_ant, null, 'ajuste_excel_quitado', v_lote, v_actor,
              coalesce(p_motivo, '') || ' · vuelve al valor del sistema' || case when v_ant_txt is not null then ' (texto: ' || v_ant_txt || ')' else '' end);
  end loop;

  update public.liquidacion_importacion
     set filas_total = v_altas + v_cambios + v_quitados + v_params + v_errores,
         filas_aplicadas = v_altas + v_cambios + v_quitados + v_params,
         filas_error = v_errores
   where id = v_lote;
  return jsonb_build_object('lote', v_lote, 'altas', v_altas, 'cambios', v_cambios, 'quitados', v_quitados,
                            'parametros', v_params, 'errores', v_errores);
end;
$fn$;
revoke all on function public.guardar_reimport_excel_trabajo(uuid,text,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.guardar_reimport_excel_trabajo(uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;

commit;
