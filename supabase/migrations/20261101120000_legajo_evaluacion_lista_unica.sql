-- Legajos y evaluaciones de supervisores: UNA sola lista de autorizaciones.
--
-- ── Decisión de JC (19/10/2026, corrección A) ────────────────────────────────
-- Únicamente estas 7 personas consultan los legajos operativos Y las
-- evaluaciones de todos los supervisores:
--   Juan Cruz Romero (Gerencia) · Facundo Romero (Gerencia) · Rodolfo Romero
--   (Dirección) · Aldo Monzón (Jefe de supervisores) · Laura M. · Joel Juárez ·
--   Andrea Narvarte (Administración).
-- La autorización es INDIVIDUAL e independiente del cargo, del rol y de los
-- permisos operativos: no alcanza con ser Gerencia, Dirección, Administración
-- ni tener la vista administrativa. Sergio Martínez no tiene acceso por ahora;
-- habilitarlo más adelante es agregar una fila a la lista, sin tocar su rol:
--
--   insert into public.legajo_supervisores_accesos (usuario_id, motivo, otorgado_por)
--   values ('69493cc2-15d6-4618-893e-4a9b1d044df8', '…', '…');
--
-- ── Qué cambia respecto de 20261030120000 (#328) y 20261028120000 (#325) ────
--  1. Se suman a la lista Juan Cruz, Facundo y Rodolfo (antes entraban por
--     puesto). Carga verificada: id + email + puesto + estado; si algo no
--     coincide, la migración aborta.
--  2. puede_ver_legajo_supervisores(uuid) = usuario activo Y en la lista.
--     Se quitan: el acceso por puesto, por delegación gerencial y la exclusión
--     por zona asignada (esa regla impedía habilitar a Sergio).
--  3. puede_evaluar_supervisores_actual() (ranking y detalle de la Etapa 1)
--     usa la MISMA lista: legajos y evaluaciones no pueden divergir.
--
-- ── Qué NO cambia ────────────────────────────────────────────────────────────
-- Ningún permiso operativo: GPS, mapas, supervisiones, alertas, vista
-- administrativa, capacidades por puesto. Las funciones de datos de E1 y del
-- legajo siguen igual (preguntan a estas dos funciones). La tabla de
-- autorizaciones sigue sin acceso desde la app.
--
-- Rollback: supabase/rollback/20261101120000_legajo_evaluacion_lista_unica_rollback.sql
-- Verificación: supabase/verificacion/legajo_evaluacion_lista_unica_post_migracion.sql

begin;

-- 1. Juan Cruz, Facundo y Rodolfo pasan a la lista (identidad verificada).
do $carga$
declare
  r record;
begin
  for r in
    select * from (values
      ('3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid, 'admin@mercosur.com',              'gerencia',            'Gerencia: legajos y evaluaciones de supervisores'),
      ('5a8e3f70-77ef-4f89-8332-b9878f32a293'::uuid, 'facundomromero@gmail.com',        'gerencia',            'Gerencia: legajos y evaluaciones de supervisores'),
      ('3731aa27-ce78-4817-8faa-66ad1edfabaa'::uuid, 'rodolfofederico2002@hotmail.com', 'direccion_operativa', 'Dirección: legajos y evaluaciones de supervisores')
    ) as t(id, email, puesto, motivo)
  loop
    if not exists (
      select 1 from public.usuarios u
       where u.id = r.id and lower(u.email) = r.email and u.puesto_organizacional = r.puesto
         and u.estado = 'activo' and coalesce(u.es_prueba, false) = false
    ) then
      raise exception 'legajo_supervisores_accesos: % (%) no coincide con usuarios; no se carga nada', r.email, r.id;
    end if;
    insert into public.legajo_supervisores_accesos (usuario_id, motivo, otorgado_por)
    values (r.id, r.motivo, 'JC 19/10/2026 (corrección A)')
    on conflict (usuario_id) do nothing;
  end loop;
end
$carga$;

-- 2. Permiso por usuario: sólo la lista (usuario activo).
create or replace function public.puede_ver_legajo_supervisores(p_usuario_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
      join public.legajo_supervisores_accesos a on a.usuario_id = u.id
     where u.id = p_usuario_id and u.estado = 'activo'
  )
$$;

-- 3. Evaluación (Etapa 1) = la misma lista.
create or replace function public.puede_evaluar_supervisores_actual()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select public.puede_ver_legajo_supervisores_actual()
$$;

-- Permisos (los mismos que ya tenían; se reafirman).
revoke all on function public.puede_ver_legajo_supervisores(uuid)  from public, anon, authenticated;
revoke all on function public.puede_evaluar_supervisores_actual()   from public, anon;
grant execute on function public.puede_evaluar_supervisores_actual() to authenticated;

commit;
