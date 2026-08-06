-- Rollback — Estado Publicado para la programación mensual

DROP FUNCTION IF EXISTS public.publicar_turnos_programacion(uuid, uuid[], text);

DROP TABLE IF EXISTS public.programacion_publicaciones;

ALTER TABLE public.turnos DROP COLUMN IF EXISTS publicado_por;
ALTER TABLE public.turnos DROP COLUMN IF EXISTS publicado_at;
ALTER TABLE public.turnos DROP COLUMN IF EXISTS publicado;
