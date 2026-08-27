-- Escalamiento por WhatsApp de puestos descubiertos: destinatarios y auditoria.
--
-- QUE RESUELVE
-- Cuando un puesto sigue descubierto 30 minutos despues del inicio, el aviso
-- va al "grupo de supervisores y directivos". La Cloud API de Meta NO permite
-- enviar a un grupo de WhatsApp, asi que ese grupo se resuelve como una LISTA
-- de personas y mensajes individuales. Ademas de ser lo unico oficialmente
-- soportado, deja auditoria por persona: se sabe quien recibio y quien no.
--
-- QUE NO SE CREA
-- Ninguna tabla de deduplicacion. La que existe -notificaciones_enviadas, con
-- indice unico (usuario_id, turno_id, tipo)- ya es exactamente
-- destinatario + turno + tipo de escalamiento. Reutilizarla evita que dos
-- registros digan cosas distintas sobre el mismo aviso.
--
-- Tampoco se guardan telefonos aca: salen de usuarios.telefono, que es donde
-- ya estan. Una copia se desactualiza el dia que alguien cambia de numero.

begin;

-- ============================================================================
-- 1. QUIEN RECIBE CADA NIVEL
-- ============================================================================
--
-- Apunta a usuarios existentes. El nivel 15 no se configura: sale de la zona
-- del objetivo por resolverResponsablesOperativos, que es la misma regla que
-- usan las pantallas. Esta tabla es solo para el escalamiento de 30.

create table if not exists public.escalamiento_destinatarios (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  -- Para que en la pantalla se entienda por que esta esa persona en la lista.
  rol_en_escalamiento text not null default 'operaciones',
  activo      boolean not null default true,
  creado_por  uuid references public.usuarios(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'escalamiento_destinatarios_rol_check'
  ) then
    alter table public.escalamiento_destinatarios
      add constraint escalamiento_destinatarios_rol_check
      check (rol_en_escalamiento in ('jefe_supervisores', 'operaciones', 'direccion', 'otro'));
  end if;
end $$;

-- Una persona, una vez.
create unique index if not exists escalamiento_destinatarios_usuario_key
  on public.escalamiento_destinatarios (usuario_id);

-- ============================================================================
-- 2. AUDITORIA DE ENVIOS
-- ============================================================================
--
-- El hecho completo, para poder reconstruir despues que paso: que turno, quien
-- debia estar, quien recibio, a que numero, con que plantilla y que contesto el
-- proveedor.
--
-- NO guarda tokens ni credenciales. El campo `error` guarda el mensaje del
-- proveedor, que nunca incluye el token.

create table if not exists public.escalamiento_whatsapp_envios (
  id             uuid primary key default gen_random_uuid(),

  turno_id       uuid not null references public.turnos(id) on delete cascade,
  objetivo_id    uuid references public.objetivos(id),
  puesto_id      uuid references public.puestos(id),
  -- El vigilador programado. Null cuando el turno no tenia nadie asignado, que
  -- es justamente uno de los dos motivos por los que un puesto queda sin cubrir.
  guardia_id     uuid references public.usuarios(id),

  nivel          text not null,
  destinatario_id uuid references public.usuarios(id),
  -- Normalizado, listo para la API. Se guarda para poder ver a que numero se
  -- mando realmente, no al que estaba cargado.
  telefono       text,
  plantilla      text,

  turno_inicio   timestamptz,
  detectado_at   timestamptz not null default now(),
  minutos_descubierto integer,

  -- 'enviado' | 'fallido' | 'simulado' | 'sin_telefono' | 'telefono_invalido'
  --  | 'sin_supervisor_responsable'
  resultado      text not null,
  id_proveedor   text,
  proveedor      text,
  error          text,

  created_at     timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'escalamiento_envios_nivel_check'
  ) then
    alter table public.escalamiento_whatsapp_envios
      add constraint escalamiento_envios_nivel_check
      check (nivel in ('escalamiento_wa_15', 'escalamiento_wa_30'));
  end if;
end $$;

create index if not exists escalamiento_envios_turno_idx
  on public.escalamiento_whatsapp_envios (turno_id, nivel);
create index if not exists escalamiento_envios_fecha_idx
  on public.escalamiento_whatsapp_envios (detectado_at desc);

-- ============================================================================
-- 3. PERMISOS
-- ============================================================================
--
-- Los DEFAULT PRIVILEGES del proyecto conceden DELETE y TRUNCATE a
-- `authenticated` sobre toda tabla nueva. TRUNCATE ademas no pasa por RLS.
-- Se revoca explicitamente: la auditoria de un aviso no la puede borrar quien
-- fue avisado.

revoke all on table public.escalamiento_destinatarios from anon, authenticated;
revoke all on table public.escalamiento_whatsapp_envios from anon, authenticated;

alter table public.escalamiento_destinatarios enable row level security;
alter table public.escalamiento_whatsapp_envios enable row level security;

-- Solo admin configura la lista y solo admin lee la auditoria. El cron escribe
-- con service_role, que no pasa por RLS.
grant select, insert, update on table public.escalamiento_destinatarios to authenticated;
grant select on table public.escalamiento_whatsapp_envios to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'escalamiento_destinatarios' and policyname = 'admin_gestiona_destinatarios'
  ) then
    create policy admin_gestiona_destinatarios on public.escalamiento_destinatarios
      for all to authenticated
      using (exists (
        select 1 from public.usuarios u
         where u.id = auth.uid() and u.rol = 'admin'
      ))
      with check (exists (
        select 1 from public.usuarios u
         where u.id = auth.uid() and u.rol = 'admin'
      ));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'escalamiento_whatsapp_envios' and policyname = 'admin_lee_auditoria'
  ) then
    create policy admin_lee_auditoria on public.escalamiento_whatsapp_envios
      for select to authenticated
      using (exists (
        select 1 from public.usuarios u
         where u.id = auth.uid() and u.rol = 'admin'
      ));
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
