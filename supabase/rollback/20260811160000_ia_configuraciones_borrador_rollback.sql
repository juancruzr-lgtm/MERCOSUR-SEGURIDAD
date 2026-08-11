-- ============================================================================
-- ROLLBACK · 20260811160000_ia_configuraciones_borrador
-- ============================================================================
--
-- Restituye NOT NULL en ia_configuraciones.modelo y .prompt.
--
-- ⚠️  FALLA A PROPÓSITO si ya existe alguna configuración en borrador (modelo o
--     prompt en NULL). En ese caso hay que decidir explícitamente qué hacer con
--     esas filas antes de revertir: no las voy a rellenar con un valor inventado
--     desde un rollback.
-- ============================================================================

begin;

do $$
declare
  v_borradores bigint;
begin
  select count(*) into v_borradores
    from public.ia_configuraciones
   where modelo is null or prompt is null;

  if v_borradores > 0 then
    raise exception
      'ABORTA: hay % configuración(es) en borrador (modelo o prompt NULL). '
      'Completarlas o eliminarlas antes de revertir esta migración.', v_borradores;
  end if;
end $$;

alter table public.ia_configuraciones alter column modelo set not null;
alter table public.ia_configuraciones alter column prompt set not null;

comment on column public.ia_configuraciones.modelo is null;
comment on column public.ia_configuraciones.prompt is null;

notify pgrst, 'reload schema';

commit;
