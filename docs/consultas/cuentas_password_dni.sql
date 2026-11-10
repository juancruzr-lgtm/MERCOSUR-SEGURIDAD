-- ============================================================================
-- Seguimiento: cuentas que todavía entran con la contraseña inicial = DNI
-- ============================================================================
-- SÓLO LECTURA. Devuelve CONTEOS por puesto y estado: no muestra nombres, DNI ni
-- contraseñas. Compara el DNI con el hash bcrypt de Supabase Auth
-- (extensions.crypt); tarda unos segundos (un bcrypt por cuenta).
-- Correr en el SQL Editor de Supabase antes y durante la migración a
-- contraseñas personales (docs/seguridad/CONTRASENA-INICIAL-DNI.md).
--
-- Foto 06/11/2026: 66 de 70 cuentas activas con contraseña = DNI
-- (3/3 Administración, 1/2 Gerencia, 1/1 Dirección Operativa, 2/2 jefes,
--  4/4 supervisores, 55/58 vigiladores).
-- ============================================================================
select coalesce(u.puesto_organizacional, 'rol:' || u.rol) as puesto,
       u.estado,
       count(*) as cuentas,
       count(*) filter (
         where a.encrypted_password is not null and a.encrypted_password <> ''
           and extensions.crypt(regexp_replace(coalesce(u.dni, ''), '\s', '', 'g'), a.encrypted_password) = a.encrypted_password
       ) as password_igual_dni,
       count(*) filter (where a.encrypted_password is null or a.encrypted_password = '') as sin_password_aun,
       count(*) filter (where a.last_sign_in_at > now() - interval '30 days') as ingresaron_30_dias,
       count(*) filter (where a.banned_until > now()) as bloqueadas
  from public.usuarios u
  join auth.users a on a.id = u.auth_user_id
 where not u.es_prueba
 group by 1, 2
 order by 2, 1;
