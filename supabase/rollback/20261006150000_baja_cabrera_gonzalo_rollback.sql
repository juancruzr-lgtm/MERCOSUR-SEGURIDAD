-- Rollback de 20261006150000_baja_cabrera_gonzalo
update public.usuarios set estado = 'activo'
 where id = '5752531b-3eaf-464b-85fb-49acd7a9ad5e';
