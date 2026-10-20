-- Rollback de 20261111120000_arca_txt_para_visual.sql
-- Vuelve arca_relaciones_importar a la definición de 20261017120000, quita la
-- función de lectura y la columna con la línea original (se pierden las líneas
-- guardadas; las relaciones quedan intactas).

begin;

drop function if exists public.arca_relaciones_para_visual();

create or replace function public.arca_relaciones_importar(p_consulta date, p_archivo text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare r jsonb; v_yo uuid; n_nuevas int := 0; n_total int := 0; n_ins int;
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
    insert into public.arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio, fecha_fin, situacion_baja, obra_social, archivo, cargado_por)
    values (p_consulta, r->>'cuil', left(btrim(r->>'nombre'), 120), left(nullif(btrim(r->>'modalidad'), ''), 120), (r->>'inicio')::date,
            nullif(r->>'fin', '')::date, left(nullif(btrim(r->>'baja'), ''), 200), left(nullif(btrim(r->>'obra_social'), ''), 200),
            left(nullif(btrim(p_archivo), ''), 120), v_yo)
    on conflict (consulta_fecha, cuil, fecha_inicio) do nothing;
    get diagnostics n_ins = row_count;
    n_nuevas := n_nuevas + n_ins;
  end loop;
  return jsonb_build_object('consulta', p_consulta, 'filas', n_total, 'nuevas', n_nuevas,
    'total_consulta', (select count(*) from public.arca_relaciones_laborales a where a.consulta_fecha = p_consulta));
end;
$fn$;
revoke all on function public.arca_relaciones_importar(date, text, jsonb) from public, anon;
grant execute on function public.arca_relaciones_importar(date, text, jsonb) to authenticated;

alter table public.arca_relaciones_laborales drop constraint if exists arca_relaciones_linea_original_largo;
alter table public.arca_relaciones_laborales drop column if exists linea_original;

commit;

notify pgrst, 'reload schema';
