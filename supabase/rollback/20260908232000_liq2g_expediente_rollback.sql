begin;
drop table if exists public.liquidacion_expediente cascade;
-- Nota: los permanentes 111/993 migrados no se recrean automáticamente
-- (quedaron como expedientes); re-seed manual si se revierte.
commit;
