-- ============================================================================
-- IA · FASE B — Configuración en estado borrador
-- ============================================================================
--
-- En 20260811100000, `ia_configuraciones.modelo` y `.prompt` quedaron NOT NULL.
-- Eso asumía que la configuración nacía completa. La realidad del plan por fases
-- es otra: en FASE B Administración carga los CRITERIOS y las FOTOS DE
-- REFERENCIA, y la parte técnica (modelo, prompt, schema) recién se completa en
-- FASE C, cuando se elija el modelo de Gemini.
--
-- La alternativa era escribir un valor de relleno ('pendiente', '') en el alta.
-- Se descarta: ese valor terminaría copiado en evidencia_analisis.modelo si algo
-- llegara a ejecutarse, y ensuciaría exactamente el rastro de auditoría que este
-- diseño existe para proteger.
--
-- ── QUÉ CAMBIA ──────────────────────────────────────────────────────────────
--   modelo  NOT NULL  →  NULL permitido
--   prompt  NOT NULL  →  NULL permitido
--
-- ── QUÉ NO CAMBIA ───────────────────────────────────────────────────────────
--   El CHECK ia_configuraciones_modelo_no_vacio sigue vigente y sigue rechazando
--   cadenas vacías: `length(btrim(NULL)) > 0` evalúa a NULL, y un CHECK sólo
--   falla con FALSE. O sea que NULL pasa y '' sigue rechazado. Es el
--   comportamiento que queremos, sin tocar la constraint.
--
--   Ninguna otra columna, tabla, policy, índice o dato.
--
-- ── SEGURIDAD OPERATIVA ─────────────────────────────────────────────────────
-- NO se agrega un CHECK que impida activar una configuración sin modelo.
-- `activo` es una marca OPERATIVA ("ésta es la referencia que la empresa
-- considera correcta hoy") y Administración tiene que poder usarla en FASE B,
-- cuando todavía no hay modelo. La validación técnica es responsabilidad del
-- worker de FASE C, que debe rechazar con error explícito una configuración con
-- modelo o prompt en NULL antes de intentar cualquier llamada.
--
-- Aditiva, reversible, sin reescritura de tabla (DROP NOT NULL sólo toca
-- catálogo). La tabla está vacía: 0 filas afectadas.
--
-- Rollback:     supabase/rollback/20260811160000_ia_configuraciones_borrador_rollback.sql
-- Verificación: al final de este archivo.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.ia_configuraciones') is null then
    raise exception 'Dependencia faltante: public.ia_configuraciones (aplicar 20260811100000 primero)';
  end if;
end $$;

alter table public.ia_configuraciones alter column modelo drop not null;
alter table public.ia_configuraciones alter column prompt drop not null;

comment on column public.ia_configuraciones.modelo is
  'Modelo del proveedor. NULL = configuración en borrador (FASE B): criterios y '
  'referencias cargados, parte técnica pendiente. El worker debe rechazar NULL.';

comment on column public.ia_configuraciones.prompt is
  'Prompt del análisis. NULL = borrador. Se completa en FASE C.';

notify pgrst, 'reload schema';

commit;


-- ── VERIFICACIÓN (ejecutar aparte, después del commit) ──────────────────────
--
-- SELECT column_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='ia_configuraciones'
--   AND column_name IN ('modelo','prompt');
-- -- Esperado: is_nullable = 'YES' en las dos.
--
-- SELECT count(*) AS filas FROM public.ia_configuraciones;
-- -- Esperado: sin cambios respecto de antes (0 si nadie cargó nada todavía).
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid='public.ia_configuraciones'::regclass AND conname LIKE '%modelo%';
-- -- Esperado: ia_configuraciones_modelo_no_vacio sigue presente.
