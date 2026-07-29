-- ROLLBACK de 20260801120000. Quita el anti-duplicado y restaura la firma de 12
-- parámetros de agregar_ronda_punto. Deja la columna posicion_capturada_at
-- (aditiva/inocua); removerla exigiría descartar datos.
begin;
drop trigger if exists trg_ronda_puntos_no_duplicado on public.ronda_puntos;
drop function if exists public.ronda_puntos_no_duplicado();

drop function if exists public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text, timestamptz);

create or replace function public.agregar_ronda_punto(
  p_ronda_base_id uuid, p_nombre text, p_descripcion text, p_foto_requerida boolean,
  p_gps_requerido boolean, p_latitud double precision, p_longitud double precision,
  p_precision_metros double precision, p_radio_metros integer, p_origen_posicion text,
  p_activo boolean, p_politica_foto text default null
) returns public.ronda_puntos language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_objetivo_id uuid; v_orden integer; v_punto public.ronda_puntos;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  select rb.objetivo_id into v_objetivo_id from public.rondas_base rb where rb.id = p_ronda_base_id for update;
  if not found then raise exception 'Ronda base no encontrada'; end if;
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then raise exception 'No autorizado para administrar esta ronda'; end if;
  perform 1 from public.ronda_puntos rp where rp.ronda_base_id = p_ronda_base_id for update;
  select coalesce(max(rp.orden),0)+1 into v_orden from public.ronda_puntos rp where rp.ronda_base_id = p_ronda_base_id;
  if v_orden > 10000 then raise exception 'La ronda alcanzo el maximo de puntos permitido'; end if;
  insert into public.ronda_puntos (ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
    latitud, longitud, precision_metros, radio_metros, origen_posicion, activo, politica_foto)
  values (p_ronda_base_id, btrim(p_nombre), nullif(btrim(p_descripcion),''), v_orden,
    coalesce(p_foto_requerida,true), p_gps_requerido, p_latitud, p_longitud,
    p_precision_metros, p_radio_metros, p_origen_posicion, p_activo, p_politica_foto)
  returning * into v_punto;
  return v_punto;
end; $$;
revoke all on function public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text) from public;
revoke all on function public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text) from anon;
grant execute on function public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
