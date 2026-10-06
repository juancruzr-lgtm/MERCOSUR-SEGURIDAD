-- 20261006150000_baja_cabrera_gonzalo
-- Baja (estado inactivo) de CABRERA GONZALO (dni 44761525), indicado por JC junto
-- con el resto de las bajas de #265. Sin CUIL, por eso se da por id.
update public.usuarios set estado = 'inactivo'
 where id = '5752531b-3eaf-464b-85fb-49acd7a9ad5e' and estado = 'activo';
