-- ============================================================================
-- Archivo de ARCA para Visual (Importar AFIP) — pedido de JC 20/10/2026
-- ============================================================================
-- Los eventuales que se dan de baja no están en Visual Sueldos. Visual los
-- incorpora con «Importar AFIP», que lee el .txt de la «Consulta de Relaciones
-- Laborales» de ARCA. La app genera ese mismo .txt sólo con las personas elegidas.
--
-- 1) arca_relaciones_laborales.linea_original: la línea tal cual vino de ARCA
--    (1020 caracteres), para devolverla idéntica. Lo cargado antes queda sin línea
--    y la app la reconstruye con los datos guardados + los tramos fijos de la empresa.
-- 2) arca_relaciones_importar: igual que antes y además guarda la línea. Volver a
--    subir una consulta ya cargada no duplica filas: sólo completa la línea que faltaba.
-- 3) arca_relaciones_para_visual(): la última relación de cada CUIL (todas las
--    consultas), con el estado en la app y el legajo de Visual. Sólo lectura,
--    Administración/Gerencia (legajo_puede_gestionar).
--
-- Rollback: supabase/rollback/20261111120000_arca_txt_para_visual_rollback.sql
-- ============================================================================

begin;

alter table public.arca_relaciones_laborales add column if not exists linea_original text;
alter table public.arca_relaciones_laborales drop constraint if exists arca_relaciones_linea_original_largo;
alter table public.arca_relaciones_laborales add constraint arca_relaciones_linea_original_largo check (linea_original is null or char_length(linea_original) <= 2000);

create or replace function public.arca_relaciones_importar(p_consulta date, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare r jsonb; v_yo uuid; n_nuevas int := 0; n_total int := 0; v_nueva boolean;
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  if p_consulta is null or p_consulta > current_date or p_consulta < date '2020-01-01' then raise exception 'La fecha de la consulta no es válida'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene relaciones laborales'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Demasiadas filas'; end if;
  v_yo := (select u.id from public.usuarios u where u.auth_user_id = auth.uid());
  for r in select * from jsonb_array_elements(p_filas) loop
    n_total := n_total + 1;
    if not public.cuil_valido(r->>'cuil') then raise exception 'CUIL inválido en la fila %', n_total; end if;
    if nullif(btrim(r->>'nombre'), '') is null or (r->>'inicio') is null then raise exception 'Fila % incompleta', n_total; end if;
    v_nueva := null;
    insert into public.arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio, fecha_fin, situacion_baja, obra_social, archivo, cargado_por, linea_original)
    values (p_consulta, r->>'cuil', left(btrim(r->>'nombre'), 120), left(nullif(btrim(r->>'modalidad'), ''), 120), (r->>'inicio')::date,
            nullif(r->>'fin', '')::date, left(nullif(btrim(r->>'baja'), ''), 200), left(nullif(btrim(r->>'obra_social'), ''), 200),
            left(nullif(btrim(p_archivo), ''), 120), v_yo, nullif(left(r->>'linea', 2000), ''))
    on conflict (consulta_fecha, cuil, fecha_inicio) do update
      set linea_original = excluded.linea_original
      where public.arca_relaciones_laborales.linea_original is null and excluded.linea_original is not null
    returning (xmax = 0) into v_nueva;
    if coalesce(v_nueva, false) then n_nuevas := n_nuevas + 1; end if;
  end loop;
  return jsonb_build_object('consulta', p_consulta, 'filas', n_total, 'nuevas', n_nuevas,
    'total_consulta', (select count(*) from public.arca_relaciones_laborales a where a.consulta_fecha = p_consulta));
end;
$fn$;
revoke all on function public.arca_relaciones_importar(date, text, jsonb) from public, anon;
grant execute on function public.arca_relaciones_importar(date, text, jsonb) to authenticated;

create or replace function public.arca_relaciones_para_visual()
returns table (cuil text, apellido_nombre text, obra_social text, modalidad text, fecha_inicio date, fecha_fin date,
               situacion_baja text, consulta_fecha date, linea_original text,
               empleado_id uuid, estado_app text, legajo_visual text)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.legajo_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  return query
  with ult as (
    select distinct on (a.cuil) a.cuil, a.apellido_nombre, a.obra_social, a.modalidad, a.fecha_inicio, a.fecha_fin,
           a.situacion_baja, a.consulta_fecha, a.linea_original
      from public.arca_relaciones_laborales a
     order by a.cuil, a.consulta_fecha desc, a.fecha_inicio desc
  )
  select u.cuil, u.apellido_nombre, u.obra_social, u.modalidad, u.fecha_inicio, u.fecha_fin, u.situacion_baja, u.consulta_fecha,
         -- La línea original de la consulta más nueva que la tenga para esa misma relación.
         coalesce(u.linea_original, (select a2.linea_original from public.arca_relaciones_laborales a2
                                       where a2.cuil = u.cuil and a2.fecha_inicio = u.fecha_inicio and a2.linea_original is not null
                                       order by a2.consulta_fecha desc limit 1)),
         us.id, us.estado, coalesce(lp.cod_interno, us.legajo_visual)
    from ult u
    left join lateral (select x.id, x.estado, x.legajo_visual from public.usuarios x
                        where regexp_replace(coalesce(x.cuil, ''), '\D', '', 'g') = u.cuil
                        order by (x.estado = 'activo') desc, x.id limit 1) us on true
    left join public.liquidacion_persona lp on lp.cuil = u.cuil
   order by u.apellido_nombre;
end;
$fn$;
revoke all on function public.arca_relaciones_para_visual() from public, anon;
grant execute on function public.arca_relaciones_para_visual() to authenticated;

commit;

notify pgrst, 'reload schema';
