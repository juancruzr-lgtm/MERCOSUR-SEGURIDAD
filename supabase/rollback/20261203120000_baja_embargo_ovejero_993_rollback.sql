-- Rollback de 20261203120000: reactiva el embargo 993 de Ovejero.
update public.liquidacion_expediente
   set estado = 'activo',
       vigencia_hasta = null
 where id = '0fd553d7-616f-4398-93a0-76706acf1642'
   and estado = 'baja';
