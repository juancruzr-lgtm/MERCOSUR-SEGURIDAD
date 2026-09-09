-- ============================================================================
-- ROLLBACK · 20260811100000_ia_analisis_base
-- ============================================================================
--
-- Deshace por completo la FASE A del agente visual.
--
-- QUÉ RESTITUYE:
--   - elimina las 6 tablas nuevas y sus índices/policies/triggers
--   - elimina la RPC y los 2 helpers de rol
--   - elimina las 4 columnas agregadas a `evidencias` y su trigger
--   - elimina el bucket `ia-referencias` (sólo si está vacío)
--   - elimina las 7 claves de app_config
--
-- QUÉ NO TOCA (igual que la migración): registros_asistencia, turnos,
-- ronda_alertas, ronda_puntos, rondas_base, evidencias (filas), objetivos,
-- usuarios, supervisiones, liquidación, y los buckets ingreso-evidencias y
-- ronda-evidencias.
--
-- ⚠️  PÉRDIDA DE DATOS: si ya se corrieron análisis o revisiones humanas,
--     este rollback los borra. Antes de ejecutarlo con datos reales, archivar:
--
--       create table ia_archivo_analisis_20260811   as select * from public.evidencia_analisis;
--       create table ia_archivo_revisiones_20260811 as select * from public.evidencia_analisis_revisiones;
--       create table ia_archivo_config_20260811     as select * from public.ia_configuraciones;
--
--     Mismo criterio que ronda_alertas_archivo_20260801.
-- ============================================================================

begin;

-- ── Guarda: avisar si se está por perder trabajo real ───────────────────────
do $$
declare
  v_analisis   bigint := 0;
  v_revisiones bigint := 0;
begin
  if to_regclass('public.evidencia_analisis') is not null then
    select count(*) into v_analisis from public.evidencia_analisis;
  end if;
  if to_regclass('public.evidencia_analisis_revisiones') is not null then
    select count(*) into v_revisiones from public.evidencia_analisis_revisiones;
  end if;

  raise notice 'ROLLBACK IA — se van a borrar % análisis y % revisiones humanas.',
    v_analisis, v_revisiones;

  -- Descomentar para convertir el aviso en un freno duro:
  -- if v_revisiones > 0 then
  --   raise exception 'ABORTA: hay % revisiones humanas. Archivar antes de continuar.', v_revisiones;
  -- end if;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. RPC y helpers                                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

drop function if exists public.ia_registrar_revision(uuid, text, text);
drop function if exists public.ia_es_operador();
drop function if exists public.ia_es_admin();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Tablas nuevas  (orden inverso a las FK)                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Los índices, triggers y policies caen con la tabla; no hace falta dropearlos
-- uno por uno. Sin CASCADE a propósito: si algo externo llegara a depender de
-- estas tablas, queremos que el rollback falle en lugar de arrastrarlo.

drop table if exists public.evidencia_analisis_revisiones;
drop table if exists public.evidencia_analisis;
drop table if exists public.ia_lotes;
drop table if exists public.ronda_punto_referencias;
drop table if exists public.ia_referencia_imagenes;
drop table if exists public.ia_configuraciones;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Columnas agregadas a `evidencias`                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

drop trigger if exists trg_evidencias_updated_at on public.evidencias;

alter table public.evidencias
  drop constraint if exists evidencias_contenido_sha256_formato;
alter table public.evidencias
  drop constraint if exists evidencias_bytes_positivo;

alter table public.evidencias
  drop column if exists contenido_sha256,
  drop column if exists bytes,
  drop column if exists content_type,
  drop column if exists updated_at;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Bucket de referencias                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Sólo se borra si está vacío. Con objetos adentro el DELETE falla por la FK
-- de storage.objects, y eso es lo correcto: no queremos que un rollback
-- destruya fotos de referencia cargadas por la operación.

do $$
declare
  v_objetos bigint;
begin
  select count(*) into v_objetos
    from storage.objects
   where bucket_id = 'ia-referencias';

  if v_objetos = 0 then
    delete from storage.buckets where id = 'ia-referencias';
    raise notice 'Bucket ia-referencias eliminado (estaba vacío).';
  else
    raise notice 'Bucket ia-referencias CONSERVADO: tiene % objetos. Vaciarlo antes si se quiere eliminar.', v_objetos;
  end if;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Claves de app_config                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

delete from public.app_config
 where key in (
   'ia_analisis_enabled',
   'ia_modo_por_defecto',
   'ia_lote_max',
   'ia_max_intentos',
   'ia_muestra_normales_por_dia',
   'ia_activacion_desde',
   'ia_tipos_activos'
 );


notify pgrst, 'reload schema';

commit;
