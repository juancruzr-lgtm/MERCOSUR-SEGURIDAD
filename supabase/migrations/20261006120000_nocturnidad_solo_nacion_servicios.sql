-- 20261006120000_nocturnidad_solo_nacion_servicios
-- Nocturnidad SÓLO en los objetivos del cliente NACION SERVICIOS (ventana 22:00-06:00).
-- Se apaga en todos los demás (estaban prendidos los 4 LAROMET: ARMSTRONG, CORREA,
-- ROSARIO 2, TORTUGAS). Regla JC 06/10: sólo nación servicios paga nocturnidad.

-- Apagar la nocturnidad donde NO es nación servicios.
update public.objetivos
   set nocturnidad_activa = false
 where coalesce(cliente, '') <> 'NACION SERVICIOS' and nocturnidad_activa = true;

-- Prender (22:00-06:00) en nación servicios.
update public.objetivos
   set nocturnidad_activa = true,
       nocturnidad_desde = '22:00',
       nocturnidad_hasta = '06:00'
 where cliente = 'NACION SERVICIOS';
