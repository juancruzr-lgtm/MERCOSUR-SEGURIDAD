-- Esqueleto mínimo de producción para probar las migraciones de protocolos.
-- Las funciones de permisos son copia de pg_get_functiondef en producción
-- (14/10/2026); tiene_delegacion_gerencia se simula (sin delegaciones).
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.zonas_operativas (id uuid primary key default gen_random_uuid(), nombre text);
create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, acceso_admin_pleno boolean default false, es_prueba boolean default false,
  nombre text, apellido text, legajo text);
create table public.objetivos (
  id uuid primary key default gen_random_uuid(), nombre text, estado text default 'activo',
  es_prueba boolean default false, zona_id uuid references public.zonas_operativas(id));
create table public.puestos (id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id), nombre text);
create table public.turnos (
  id uuid primary key default gen_random_uuid(), guardia_id uuid references public.usuarios(id),
  objetivo_id uuid references public.objetivos(id), puesto_id uuid references public.puestos(id),
  fecha date, hora_inicio time, hora_fin time, estado text default 'programado');
create table public.supervisor_zonas (supervisor_id uuid references public.usuarios(id), zona_id uuid references public.zonas_operativas(id));
-- Lo que la app ya expone de estas tablas no importa acá: el vigilador nunca
-- debe leer protocolos por ellas.
grant select on public.usuarios, public.objetivos, public.puestos, public.turnos to authenticated;

create function public.tiene_delegacion_gerencia(p uuid) returns boolean language sql stable as $$ select false $$;

CREATE OR REPLACE FUNCTION public.rondas_usuario_actual_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $function$;
CREATE OR REPLACE FUNCTION public.es_operador_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )) $function$;
CREATE OR REPLACE FUNCTION public.tiene_acceso_admin_pleno_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.acceso_admin_pleno = true) $function$;
CREATE OR REPLACE FUNCTION public.puede_gestionar_personal_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia') or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual() $function$;
CREATE OR REPLACE FUNCTION public.es_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia' or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $function$;
CREATE OR REPLACE FUNCTION public.tiene_delegacion_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and public.tiene_delegacion_gerencia(u.id)) $function$;
CREATE OR REPLACE FUNCTION public.puede_acceder_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual() $function$;
CREATE OR REPLACE FUNCTION public.alcance_operativo_de(p_usuario_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio' end
  from public.usuarios u where u.id = p_usuario_id $function$;
CREATE OR REPLACE FUNCTION public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (select 1 from public.objetivos o join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id and sz.supervisor_id = p_usuario_id)
    else false end $function$;
CREATE OR REPLACE FUNCTION public.alcanza_objetivo_actual(p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)) $function$;

-- Datos: dos zonas, los 21 objetivos de la carga (zona 1 salvo Rapsodia y
-- Teatro, zona 2) y un objetivo de prueba.
insert into public.zonas_operativas (id, nombre) values
  ('00000000-0000-0000-0000-00000000a001', 'Zona 1'), ('00000000-0000-0000-0000-00000000a002', 'Zona 2');
insert into public.objetivos (id, nombre, zona_id) values
  ('ac273ff2-71f6-4de2-ae4e-c0d518795dad','RANDSTAD','00000000-0000-0000-0000-00000000a001'),
  ('335179ef-af0e-41e7-9a38-66a2da661f48','LA CASONA','00000000-0000-0000-0000-00000000a001'),
  ('874fcb68-07ff-4de8-a48c-3405c932a20b','SKATEPARK','00000000-0000-0000-0000-00000000a001'),
  ('790807dd-8283-4e6e-90bc-832226d016df','NACION SERVICIOS ENTRE RIOS','00000000-0000-0000-0000-00000000a001'),
  ('946a50ec-e6cf-4995-80dc-6586178f9e3a','NACION SANTA FE','00000000-0000-0000-0000-00000000a001'),
  ('7109a4cf-0f39-4f1f-8c23-6976bb98838c','RAPSODIA','00000000-0000-0000-0000-00000000a002'),
  ('2ff263d8-a74e-4e36-914f-215b54510a4b','TEATRO LA COMEDIA','00000000-0000-0000-0000-00000000a002'),
  ('66b1b991-8045-4883-86b9-3d2be32914a5','LA CAJA','00000000-0000-0000-0000-00000000a001'),
  ('29fee8f6-493b-4e68-a09d-44808728a319','PSA','00000000-0000-0000-0000-00000000a001'),
  ('722723eb-543a-4a46-b1c3-b87f00c794ca','CIRSE','00000000-0000-0000-0000-00000000a001'),
  ('a006b949-4b99-41a6-951c-22a6be1f7d92','PNC','00000000-0000-0000-0000-00000000a001'),
  ('8f1e4b3c-23bc-464a-a2d3-66de8eb8d545','ACA','00000000-0000-0000-0000-00000000a001'),
  ('cb86521d-2ca2-4095-9110-394b3077d271','ANTENA','00000000-0000-0000-0000-00000000a001'),
  ('76ef2bd4-38aa-45c2-b103-41997e7f77ad','CLUB','00000000-0000-0000-0000-00000000a001'),
  ('8a6b4a85-5276-4c77-921f-b30c64166ad6','jardin de los niños','00000000-0000-0000-0000-00000000a001'),
  ('59b65c62-9a57-4119-84ed-bc4cedf915d2','MUSEO MACRO','00000000-0000-0000-0000-00000000a001'),
  ('78350006-6fcf-43dc-9457-447aa9fba71e','MUSEO CASTAGNINO','00000000-0000-0000-0000-00000000a001'),
  ('0f0f4940-dcfa-4fd4-9d48-071429fa0da1','Polideportivo Lotuf','00000000-0000-0000-0000-00000000a001'),
  ('6fa49177-49ac-464e-99f5-333fdfd05d00','PLAZA DE LA COOPERACIÓN','00000000-0000-0000-0000-00000000a001'),
  ('af0341a8-3c4e-4542-88eb-103e71aef693','PLAZA DE LAS CIENCIAS','00000000-0000-0000-0000-00000000a001'),
  ('900056c3-1e35-4b72-8683-498c9c60fa14','Obrador Baigorria','00000000-0000-0000-0000-00000000a001');
insert into public.puestos (id, objetivo_id, nombre) values
  ('00000000-0000-0000-0000-0000000000b1','790807dd-8283-4e6e-90bc-832226d016df','Vigilador 1'),
  ('00000000-0000-0000-0000-0000000000b2','790807dd-8283-4e6e-90bc-832226d016df','Vigilador 2'),
  ('00000000-0000-0000-0000-0000000000b3','ac273ff2-71f6-4de2-ae4e-c0d518795dad','Principal');

-- Usuarios: auth = 1000..., usuarios.id = 2000...
insert into public.usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, apellido, estado, es_prueba) values
  ('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000001001','admin','gerencia','Gere','Ncia','activo',false),
  ('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000001002','admin','administracion','Admi','Nistra','activo',false),
  ('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000001003','supervisor','jefe_supervisores','Jefe','Sup','activo',false),
  ('00000000-0000-0000-0000-000000002004','00000000-0000-0000-0000-000000001004','supervisor','supervisor','Super','Zona1','activo',false),
  ('00000000-0000-0000-0000-000000002005','00000000-0000-0000-0000-000000001005','supervisor','supervisor','Super','Zona2','activo',false),
  ('00000000-0000-0000-0000-000000002006','00000000-0000-0000-0000-000000001006','guardia','vigilador','Vigi','Randstad','activo',false),
  ('00000000-0000-0000-0000-000000002007','00000000-0000-0000-0000-000000001007','guardia','vigilador','Vigi','Casona','activo',false),
  ('00000000-0000-0000-0000-000000002008','00000000-0000-0000-0000-000000001008','guardia','vigilador','Vigi','SinTurno','activo',false),
  ('00000000-0000-0000-0000-000000002009','00000000-0000-0000-0000-000000001009','guardia','vigilador','Vigi','NSER1','activo',false),
  ('00000000-0000-0000-0000-000000002010','00000000-0000-0000-0000-000000001010','guardia','vigilador','Vigi','NSER2','activo',false),
  ('00000000-0000-0000-0000-000000002011','00000000-0000-0000-0000-000000001011','guardia','vigilador','Vigi','Inactivo','inactivo',false),
  ('00000000-0000-0000-0000-000000002012','00000000-0000-0000-0000-000000001012','guardia','vigilador','Vigi','Anulado','activo',false),
  ('00000000-0000-0000-0000-000000002013','00000000-0000-0000-0000-000000001013','guardia','vigilador','Vigi','Viejo','activo',false);
insert into public.supervisor_zonas values
  ('00000000-0000-0000-0000-000000002004','00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-000000002005','00000000-0000-0000-0000-00000000a002');

-- Turnos relativos a "hoy" en Argentina.
insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado)
select g, o, p, ((now() at time zone 'America/Argentina/Buenos_Aires')::date + d), '07:00', '19:00', e
from (values
  ('00000000-0000-0000-0000-000000002006'::uuid,'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid,'00000000-0000-0000-0000-0000000000b3'::uuid,0,'programado'),
  ('00000000-0000-0000-0000-000000002007','335179ef-af0e-41e7-9a38-66a2da661f48',null,0,'cubierto'),
  ('00000000-0000-0000-0000-000000002009','790807dd-8283-4e6e-90bc-832226d016df','00000000-0000-0000-0000-0000000000b1',1,'programado'),
  ('00000000-0000-0000-0000-000000002010','790807dd-8283-4e6e-90bc-832226d016df','00000000-0000-0000-0000-0000000000b2',-1,'programado'),
  ('00000000-0000-0000-0000-000000002011','ac273ff2-71f6-4de2-ae4e-c0d518795dad',null,0,'programado'),
  ('00000000-0000-0000-0000-000000002012','ac273ff2-71f6-4de2-ae4e-c0d518795dad',null,0,'anulado'),
  ('00000000-0000-0000-0000-000000002013','ac273ff2-71f6-4de2-ae4e-c0d518795dad',null,-3,'cubierto')
) x(g,o,p,d,e);
