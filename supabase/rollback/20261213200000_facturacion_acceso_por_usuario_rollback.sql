-- Rollback 20261213200000_facturacion_acceso_por_usuario: toda Administración vuelve a tener Facturación completa.
drop policy if exists fact_comprobantes_lectura_consulta on public.fact_comprobantes;
drop policy if exists fact_clientes_lectura_consulta on public.fact_clientes;
drop policy if exists fact_documento_vinculos_lectura_consulta on public.fact_documento_vinculos;
drop policy if exists fact_documentos_lectura_consulta on public.fact_documentos;
drop function if exists public.facturacion_ver_comprobantes_actual();

create or replace function public.facturacion_puede_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.acceso_habilitado_actual()
     and (public.puede_acceder_gerencia_actual()
          or exists (select 1 from public.usuarios u
                     where u.auth_user_id = auth.uid() and u.estado = 'activo'
                       and u.puesto_organizacional = 'administracion'))
$fn$;
revoke all on function public.facturacion_puede_actual() from public, anon;
grant execute on function public.facturacion_puede_actual() to authenticated;

drop trigger if exists usuarios_acceso_facturacion_guard on public.usuarios;
drop function if exists public.usuarios_acceso_facturacion_guard();
alter table public.usuarios drop column if exists acceso_facturacion;
