-- ROLLBACK de 20260920120000_restaurar_admin_pleno_sergio.sql
-- Vuelve a Sergio Martinez al puesto 'jefe_supervisores' (estado previo a la
-- restauración). Su rol='admin' y su zona (Rosario) no se tocan.
update public.usuarios
   set puesto_organizacional = 'jefe_supervisores'
 where id = '69493cc2-15d6-4618-893e-4a9b1d044df8'
   and lower(rol) = 'admin';
