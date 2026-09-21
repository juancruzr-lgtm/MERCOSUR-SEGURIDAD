-- ROLLBACK de 20260921180000_supervisiones_registro_propio_fuera_de_zona.sql
-- Restaura la regla de Fase 2C (sólo por ZONA, sin la vía propia). OJO: vuelve a
-- impedir que un supervisor guarde/vea su propia supervisión fuera de su zona.

begin;

drop policy if exists supervisiones_alcance on public.supervisiones;
create policy supervisiones_alcance on public.supervisiones
  for all to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id))
  with check (public.alcanza_objetivo_actual(objetivo_id));

create or replace function public.alcanza_supervision_actual(p_supervision_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.supervisiones s
    where s.id = p_supervision_id
      and public.alcanza_objetivo_actual(s.objetivo_id)
  )
$function$;

commit;

notify pgrst, 'reload schema';
