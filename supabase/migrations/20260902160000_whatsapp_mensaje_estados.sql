-- Estados de mensajes WhatsApp informados por el webhook de Meta.
--
-- La Cloud API no permite consultar el estado de un wamid: sent / delivered /
-- read / failed llegan UNICAMENTE por webhook. Esta tabla los guarda tal cual
-- llegan; se cruza con escalamiento_whatsapp_envios.id_proveedor cuando hace
-- falta saber si un envio operativo llego de verdad.
--
-- No toca ninguna tabla operativa. No guarda contenido de mensajes de
-- clientes (el webhook ignora los entrantes) ni ningun secreto.

begin;

create table if not exists public.whatsapp_mensaje_estados (
  id             uuid primary key default gen_random_uuid(),

  -- El wamid. Un mismo mensaje recibe varios estados (sent, luego delivered,
  -- luego read), asi que NO es unico: la historia completa importa.
  id_proveedor   text not null,
  estado         text not null,
  destinatario   text,
  -- Momento del estado segun Meta; created_at es cuando lo recibimos.
  ocurrido_at    timestamptz,

  -- Solo en failed: el codigo de Meta (131042 = problema de facturacion).
  error_codigo   text,
  error_detalle  text,

  created_at     timestamptz not null default now()
);

create index if not exists whatsapp_mensaje_estados_wamid_idx
  on public.whatsapp_mensaje_estados (id_proveedor, created_at desc);
create index if not exists whatsapp_mensaje_estados_fecha_idx
  on public.whatsapp_mensaje_estados (created_at desc);

-- Los DEFAULT PRIVILEGES del proyecto conceden DELETE y TRUNCATE a
-- authenticated sobre toda tabla nueva; se revoca. Escribe solo el webhook
-- (service_role); lee solo admin.
revoke all on table public.whatsapp_mensaje_estados from anon, authenticated;
alter table public.whatsapp_mensaje_estados enable row level security;
grant select on table public.whatsapp_mensaje_estados to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'whatsapp_mensaje_estados' and policyname = 'admin_lee_estados'
  ) then
    create policy admin_lee_estados on public.whatsapp_mensaje_estados
      for select to authenticated
      using (exists (
        select 1 from public.usuarios u
         where u.id = auth.uid() and u.rol = 'admin'
      ));
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
