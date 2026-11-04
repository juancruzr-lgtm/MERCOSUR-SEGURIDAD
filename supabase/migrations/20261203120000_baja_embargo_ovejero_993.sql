-- Baja del embargo de suma fija $44.540,52 (slot 993) de Ovejero.
-- Pedido por JC (04/11/2026): queda vigente sólo el expediente de slot 111
-- ($148.468,43). Dato puntual ya corregido en el padrón de liquidación.
-- El rollback vive aparte en supabase/rollback/.
update public.liquidacion_expediente
   set estado = 'baja',
       vigencia_hasta = '2026-10-31'
 where id = '0fd553d7-616f-4398-93a0-76706acf1642'
   and estado = 'activo';
