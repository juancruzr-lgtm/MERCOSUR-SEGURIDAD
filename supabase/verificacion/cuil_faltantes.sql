-- ════════════════════════════════════════════════════════════════════════════
-- Consulta: usuarios activos sin CUIL cargado
-- Ejecutar en Supabase SQL Editor para identificar quiénes necesitan
-- que se les cargue el CUIL.
-- ════════════════════════════════════════════════════════════════════════════

select
  u.id,
  u.legajo,
  u.apellido,
  u.nombre,
  u.dni,
  u.rol,
  u.estado
from public.usuarios u
where u.estado = 'activo'
  and (u.cuil is null or u.cuil = '')
order by u.apellido, u.nombre;
