create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  activo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  turno_id uuid not null references turnos(id) on delete cascade,
  tipo text not null,
  titulo text,
  mensaje text,
  created_at timestamptz default now(),
  constraint notificaciones_enviadas_usuario_turno_tipo_key unique (usuario_id, turno_id, tipo)
);

create index if not exists idx_push_subscriptions_usuario
  on push_subscriptions (usuario_id);
create index if not exists idx_push_subscriptions_activo
  on push_subscriptions (activo);
create index if not exists idx_notificaciones_enviadas_turno
  on notificaciones_enviadas (turno_id);
create index if not exists idx_notificaciones_enviadas_tipo
  on notificaciones_enviadas (tipo);

alter table push_subscriptions enable row level security;
alter table notificaciones_enviadas enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'Admin acceso total push subscriptions'
  ) then
    create policy "Admin acceso total push subscriptions"
      on push_subscriptions
      for all
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notificaciones_enviadas'
      and policyname = 'Admin acceso total notificaciones enviadas'
  ) then
    create policy "Admin acceso total notificaciones enviadas"
      on notificaciones_enviadas
      for all
      using (true);
  end if;
end $$;
