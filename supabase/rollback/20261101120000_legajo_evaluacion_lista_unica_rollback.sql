-- Rollback de 20261101120000_legajo_evaluacion_lista_unica.sql. Correr por separado.
-- Vuelve a las reglas de #325 (evaluación por puesto) y #328 (legajo por
-- puesto + lista nominal sin zona) y saca de la lista a Juan Cruz, Facundo
-- y Rodolfo (vuelven a entrar por puesto).

begin;

create or replace function public.puede_evaluar_supervisores_actual()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid() and u.estado = 'activo'
       and u.puesto_organizacional in ('direccion_operativa', 'gerencia')
  ) or public.tiene_delegacion_gerencia_actual()
$$;

create or replace function public.puede_ver_legajo_supervisores(p_usuario_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
     where u.id = p_usuario_id and u.estado = 'activo'
       and ( u.puesto_organizacional in ('direccion_operativa', 'gerencia')
             or public.tiene_delegacion_gerencia(u.id)
             or ( exists (select 1 from public.legajo_supervisores_accesos a where a.usuario_id = u.id)
                  and not exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id) ) )
  )
$$;

delete from public.legajo_supervisores_accesos where otorgado_por = 'JC 19/10/2026 (corrección A)';

revoke all on function public.puede_ver_legajo_supervisores(uuid)  from public, anon, authenticated;
revoke all on function public.puede_evaluar_supervisores_actual()   from public, anon;
grant execute on function public.puede_evaluar_supervisores_actual() to authenticated;

commit;
