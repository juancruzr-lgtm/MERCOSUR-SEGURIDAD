-- Agrega campo CUIL a la tabla usuarios.
-- El CUIL es el identificador fiscal único del empleado en Argentina (XX-XXXXXXXX-X).
-- Se usa como identificador visible en planillas, reportes y exportaciones.

alter table public.usuarios
  add column if not exists cuil text;

-- Índice único parcial: si existe CUIL, debe ser único.
create unique index if not exists usuarios_cuil_unique
  on public.usuarios (cuil)
  where cuil is not null;

comment on column public.usuarios.cuil is
  'CUIL del empleado (XX-XXXXXXXX-X). Identificador fiscal visible en planillas y exportaciones.';
