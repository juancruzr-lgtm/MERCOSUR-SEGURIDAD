-- ============================================================================
-- SANEAMIENTO PUNTUAL — viernes 16, 23 y 30/10/2026 (Rosario, diurnas)
-- *** NO EJECUTAR SIN AUTORIZACIÓN EXPRESA DE JC ***
--
-- ORIGEN (investigado 13/10): el 03/10 a las 12:51 se cargaron a mano
-- guardias de ARANDA para los viernes (una 07-13 y una 07-19 por viernes,
-- autor: romero) y luego se desactivaron, antes de que existiera la
-- auditoría del #279 (por eso no tienen traza). Esas filas INACTIVAS 07-19
-- ocupan el slot de destino y bloquean la transferencia automática
-- JL → ARANDA de la diurna de esos tres viernes (conflicto reportado por la
-- sincronización, por diseño: nunca se pisa ni se reactiva solo).
--
-- QUÉ HACE (2 UPDATEs por viernes, 6 en total, TODOS auditados por el
-- trigger de #279 — no se borra nada, porque el trigger no audita DELETE):
--   1. La diurna ACTIVA de José Luis (cruzada, vinculada a la regla de
--      Aranda) pasa a inactiva y se desvincula.
--   2. La diurna INACTIVA de ARANDA (resto del 03/10) se reactiva y se
--      vincula a la regla diurna de Aranda (806467fa).
-- Los restos 07-13 inactivos quedan como están: no chocan con nada.
--
-- RESULTADO: los 3 conflictos desaparecen; la sincronización conjunta
-- posterior da 0 escrituras y 0 conflictos (verificado en base aislada con
-- la foto real del 13/10 — resultado-rosario.txt).
-- Atómico: cualquier verificación que falle revierte todo.
-- ============================================================================
do $$
declare
  v_fecha date;
  v_jl uuid; v_ar uuid;
  v_n int;
begin
  perform set_config('app.guardia_motivo',
    'Saneamiento 13/10: duplicado inactivo del 03/10 reactivado como titular correcto; diurna cruzada desactivada', true);

  foreach v_fecha in array array['2026-10-16','2026-10-23','2026-10-30']::date[] loop
    select id into v_jl from public.supervisores_guardia
     where fecha = v_fecha and hora_inicio = '07:00' and hora_fin = '19:00'
       and lower(btrim(zona)) = 'rosario' and estado = 'activo'
       and supervisor_id = '2b51e32a-f493-46cc-82ee-6880a8c715b8'           -- José Luis
       and regla_id = '806467fa-faba-45dd-9394-1ab2a98e1524'                -- regla diurna de Aranda
       and coalesce(tipo_evento,'normal') = 'normal' and supervisor_original_id is null;
    select id into v_ar from public.supervisores_guardia
     where fecha = v_fecha and hora_inicio = '07:00' and hora_fin = '19:00'
       and lower(btrim(zona)) = 'rosario' and estado = 'inactivo'
       and supervisor_id = '251289de-c16c-4315-969c-c8ee574ff7c1'           -- ARANDA
       and coalesce(tipo_evento,'normal') = 'normal' and supervisor_original_id is null;
    if v_jl is null or v_ar is null then
      raise exception 'ABORTADO (todo revertido): % no tiene el par esperado (JL activa=% / ARANDA inactiva=%)', v_fecha, v_jl, v_ar;
    end if;
    if exists (select 1 from public.supervisor_intervenciones i where i.supervisor_guardia_id in (v_jl, v_ar)) then
      raise exception 'ABORTADO (todo revertido): % tiene intervenciones', v_fecha;
    end if;
    update public.supervisores_guardia set estado = 'inactivo', regla_id = null where id = v_jl;
    update public.supervisores_guardia set estado = 'activo',
           regla_id = '806467fa-faba-45dd-9394-1ab2a98e1524' where id = v_ar;
  end loop;

  -- Verificación interna: no queda ninguna diurna 07-19 activa de José Luis
  -- esos viernes (la de Sergio es legítima: superposición de su propia regla)
  -- y ARANDA tiene exactamente 3.
  select count(*) into v_n from public.supervisores_guardia
   where fecha in ('2026-10-16','2026-10-23','2026-10-30')
     and hora_inicio = '07:00' and hora_fin = '19:00' and lower(btrim(zona)) = 'rosario'
     and estado = 'activo' and supervisor_id = '2b51e32a-f493-46cc-82ee-6880a8c715b8';
  if v_n <> 0 then
    raise exception 'ABORTADO (todo revertido): quedaron % diurnas 07-19 activas de José Luis', v_n;
  end if;
  select count(*) into v_n from public.supervisores_guardia
   where fecha in ('2026-10-16','2026-10-23','2026-10-30')
     and hora_inicio = '07:00' and hora_fin = '19:00' and lower(btrim(zona)) = 'rosario'
     and estado = 'activo' and supervisor_id = '251289de-c16c-4315-969c-c8ee574ff7c1';
  if v_n <> 3 then
    raise exception 'ABORTADO (todo revertido): % diurnas de ARANDA activas, se esperaban 3', v_n;
  end if;

  perform set_config('app.guardia_motivo', '', true);
  raise notice 'SANEAMIENTO OK: 3 viernes corregidos (6 updates auditados)';
end $$;
