-- Rollback de 20261006120000_nocturnidad_solo_nacion_servicios
-- Restaura el estado previo: nocturnidad en los 4 LAROMET (22-06) y apagada en nación.
update public.objetivos set nocturnidad_activa = false where cliente = 'NACION SERVICIOS';
update public.objetivos
   set nocturnidad_activa = true, nocturnidad_desde = '22:00', nocturnidad_hasta = '06:00'
 where nombre in ('LAROMET ARMSTRONG','LAROMET CORREA','LAROMET ROSARIO 2','LAROMET TORTUGAS');
