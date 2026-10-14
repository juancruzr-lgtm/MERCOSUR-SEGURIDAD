-- Rollback de 20261019120000: vuelve a copiar en EMPLEADOS/CREDENCIALES.
begin;

create or replace function public.documental_encolar_credencial(p_documento uuid)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare d public.documentacion_documentos%rowtype; u public.usuarios%rowtype; a record; v_base text; v_dest text; n int := 0; k int;
begin
  d := (select x from public.documentacion_documentos x where x.id = p_documento);
  if d.id is null or d.tipo <> 'credencial' then return 0; end if;
  u := (select x from public.usuarios x where x.id = d.empleado_id);
  v_base := 'EMPLEADOS/CREDENCIALES/' || public.documental_nombre_archivo(coalesce(u.apellido, '') || ' ' || coalesce(u.nombre, ''))
            || ' - ' || to_char((d.creado_at at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD');
  for a in select f.* from public.documentacion_archivos f where f.documento_id = d.id order by f.orden loop
    continue when exists (select 1 from public.documental_exportaciones e where e.archivo_id = a.id);
    v_dest := v_base || ' - ' || coalesce(initcap(a.cara), 'Hoja ' || a.orden);
    k := 1;
    while exists (select 1 from public.documental_exportaciones e where e.destino in (v_dest || '.' || split_part(a.ruta, '.', 2))) loop
      k := k + 1; v_dest := v_base || ' - ' || coalesce(initcap(a.cara), 'Hoja ' || a.orden) || ' (' || k || ')';
    end loop;
    insert into public.documental_exportaciones (documento_id, archivo_id, ruta_origen, destino)
    values (d.id, a.id, a.ruta, v_dest || '.' || split_part(a.ruta, '.', 2));
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function public.documental_encolar_credencial(uuid) from public, anon, authenticated;

commit;
