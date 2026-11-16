-- Facturación por persona dentro de Administración.
--
-- Hasta ahora todo el puesto 'administracion' tenía Facturación completa. Desde acá:
--   · Gerencia (y delegación gerencial): completa, como siempre.
--   · Administración con usuarios.acceso_facturacion = true: completa.
--   · El resto de Administración: SÓLO LECTURA de comprobantes (lista, cliente y PDF ya
--     generado). Sin cobranzas, saldos, prefacturas, contratos, tablero ni acciones.
-- La marca la cambia sólo Gerencia (trigger); nadie se la puede dar a sí mismo.

alter table public.usuarios add column if not exists acceso_facturacion boolean not null default false;
grant select (acceso_facturacion) on public.usuarios to authenticated;

create or replace function public.usuarios_acceso_facturacion_guard()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is null then return new; end if; -- migraciones / servicio
  if tg_op = 'INSERT' then
    if coalesce(new.acceso_facturacion, false) and not public.es_gerencia_actual() then
      raise exception 'Sólo Gerencia puede otorgar acceso a Facturación' using errcode = '42501';
    end if;
  elsif new.acceso_facturacion is distinct from old.acceso_facturacion and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede cambiar el acceso a Facturación' using errcode = '42501';
  end if;
  return new;
end $fn$;
revoke all on function public.usuarios_acceso_facturacion_guard() from public, anon, authenticated;

drop trigger if exists usuarios_acceso_facturacion_guard on public.usuarios;
create trigger usuarios_acceso_facturacion_guard before insert or update of acceso_facturacion on public.usuarios
  for each row execute function public.usuarios_acceso_facturacion_guard();

-- Acceso completo: Gerencia/delegada, o Administración con la marca.
create or replace function public.facturacion_puede_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.acceso_habilitado_actual()
     and (public.puede_acceder_gerencia_actual()
          or exists (select 1 from public.usuarios u
                     where u.auth_user_id = auth.uid() and u.estado = 'activo'
                       and u.puesto_organizacional = 'administracion'
                       and u.acceso_facturacion = true))
$fn$;
revoke all on function public.facturacion_puede_actual() from public, anon;
grant execute on function public.facturacion_puede_actual() to authenticated;

-- Sólo lectura de comprobantes: acceso completo, o cualquier Administración activa.
create or replace function public.facturacion_ver_comprobantes_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.facturacion_puede_actual()
      or (public.acceso_habilitado_actual()
          and exists (select 1 from public.usuarios u
                      where u.auth_user_id = auth.uid() and u.estado = 'activo'
                        and u.puesto_organizacional = 'administracion'))
$fn$;
revoke all on function public.facturacion_ver_comprobantes_actual() from public, anon;
grant execute on function public.facturacion_ver_comprobantes_actual() to authenticated;

-- Lecturas mínimas para la lista y el PDF ya generado (se suman a las políticas existentes).
drop policy if exists fact_comprobantes_lectura_consulta on public.fact_comprobantes;
create policy fact_comprobantes_lectura_consulta on public.fact_comprobantes for select to authenticated
  using (public.facturacion_ver_comprobantes_actual());
drop policy if exists fact_clientes_lectura_consulta on public.fact_clientes;
create policy fact_clientes_lectura_consulta on public.fact_clientes for select to authenticated
  using (public.facturacion_ver_comprobantes_actual());
drop policy if exists fact_documento_vinculos_lectura_consulta on public.fact_documento_vinculos;
create policy fact_documento_vinculos_lectura_consulta on public.fact_documento_vinculos for select to authenticated
  using (public.facturacion_ver_comprobantes_actual() and entidad = 'comprobante');
drop policy if exists fact_documentos_lectura_consulta on public.fact_documentos;
create policy fact_documentos_lectura_consulta on public.fact_documentos for select to authenticated
  using (public.facturacion_ver_comprobantes_actual() and tipo = 'factura');

-- Administración con Facturación completa (el resto queda en consulta).
update public.usuarios set acceso_facturacion = true
 where id = '1384746c-0520-4ebe-8d7b-17788d833cba' and puesto_organizacional = 'administracion';
