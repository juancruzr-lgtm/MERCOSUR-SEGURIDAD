-- ============================================================================
-- RONDAS · Reset de alertas acumuladas durante implementación y validación
-- ============================================================================
--
-- POR QUÉ
--
-- Las alertas actuales no describen incumplimientos reales: se acumularon
-- mientras el módulo estaba en implementación, con tres defectos activos que
-- las migraciones 20260801140000 y 20260801150000 corrigen —objetivos de
-- prueba sin filtrar, rondas suspendidas que igual generaban `no_iniciada`, y
-- cierres administrativos que devolvían 'resuelta' sin resolver—. Además, en
-- La Casona hay `no_iniciada` sobre rondas que SÍ se realizaron, así que el
-- conjunto tampoco es confiable en objetivos reales. Se descarta entero y la
-- medición arranca de cero.
--
-- QUÉ TOCA
--
--   BORRA:  public.ronda_alertas                    (todas las filas)
--   BORRA:  public.ronda_alerta_intervenciones      (por CASCADE — ver abajo)
--
--   NO TOCA, ni una fila:
--     public.ronda_ejecuciones          public.ronda_ejecucion_puntos
--     public.rondas_base                public.ronda_puntos
--     public.evidencias                 objetos de Storage (fotos)
--     public.turnos                     public.registros_asistencia
--     asistencia, liquidables, JWM
--
-- SOBRE LAS INTERVENCIONES  ← LEER
--
-- `ronda_alerta_intervenciones.ronda_alerta_id` tiene ON DELETE CASCADE
-- (20260731100000, línea 83). Es IMPOSIBLE borrar las alertas y dejar sus
-- intervenciones en la tabla viva: la base las arrastra. La consigna de no
-- eliminar intervenciones se cumple por otra vía: ANTES de borrar, las dos
-- tablas se copian íntegras a tablas de archivo. Nada se pierde y el rollback
-- restituye ambas exactamente como estaban.
--
--   public.ronda_alertas_archivo_20260801
--   public.ronda_alerta_intervenciones_archivo_20260801
--
-- Mismo criterio que `turnos_puesto_backfill_20260728`, ya usado en este repo.
-- Las tablas de archivo no se exponen a PostgREST ni a clientes.
--
-- GUARDAS
--
--   G1 · Aborta si `ronda_alertas` tiene más de 500 filas. Protege contra
--        correr este archivo meses después, ya con datos operativos reales.
--   G2 · Aborta si el archivo ya existe con filas: evita pisar un reset previo.
--   G3 · Aborta si después del borrado quedara alguna fila.
--
-- ORDEN DE APLICACIÓN RECOMENDADO
--
--   1. 20260801130000 … 20260801170000   (las cinco correctivas)
--   2. ESTA migración
--
-- Va última a propósito. Si se borra primero y las correctivas se aplican
-- después, el cron puede correr en el medio y regenerar exactamente la basura
-- recién borrada —objetivos de prueba y ruido por suspensión— porque el
-- evaluador viejo sigue instalado. Con las correctivas ya aplicadas, lo que el
-- cron genere después del reset ya es medición limpia.
--
-- Conviene igual pausar el scheduler externo mientras se aplica el conjunto.

begin;

-- ── Guardas previas ─────────────────────────────────────────────────────────
do $$
declare
  v_alertas       bigint;
  v_intervenciones bigint;
begin
  select count(*) into v_alertas        from public.ronda_alertas;
  select count(*) into v_intervenciones from public.ronda_alerta_intervenciones;

  raise notice 'Reset de alertas de rondas — a borrar: % alertas, % intervenciones',
    v_alertas, v_intervenciones;

  -- G1
  if v_alertas > 500 then
    raise exception
      'ABORTA: ronda_alertas tiene % filas (>500). Esta migración es un reset de implementación, no una purga de datos operativos. Revisar antes de correr.',
      v_alertas;
  end if;

  -- G2
  if to_regclass('public.ronda_alertas_archivo_20260801') is not null
     and (select count(*) from public.ronda_alertas_archivo_20260801) > 0 then
    raise exception
      'ABORTA: ya existe un archivo con filas en ronda_alertas_archivo_20260801. El reset ya se aplicó una vez; pisarlo destruiría el respaldo anterior.';
  end if;
end;
$$;

-- ── Archivo íntegro de las dos tablas ───────────────────────────────────────
-- `including all` no: son copias planas de respaldo, sin constraints ni FK, para
-- que restituir no dependa del orden ni de que los objetivos sigan existiendo.

create table if not exists public.ronda_alertas_archivo_20260801
  (like public.ronda_alertas);

create table if not exists public.ronda_alerta_intervenciones_archivo_20260801
  (like public.ronda_alerta_intervenciones);

alter table public.ronda_alertas_archivo_20260801
  add column if not exists archivado_at timestamptz not null default now();
alter table public.ronda_alerta_intervenciones_archivo_20260801
  add column if not exists archivado_at timestamptz not null default now();

comment on table public.ronda_alertas_archivo_20260801 is
  'Respaldo de ronda_alertas previo al reset de implementación (20260801190000). '
  'No es una tabla operativa: existe para poder revertir el reset.';
comment on table public.ronda_alerta_intervenciones_archivo_20260801 is
  'Respaldo de ronda_alerta_intervenciones previo al reset de implementación '
  '(20260801190000). Se archiva porque el borrado de alertas las arrastra por CASCADE.';

-- Las intervenciones primero: si algo fallara, las alertas todavía están vivas.
insert into public.ronda_alerta_intervenciones_archivo_20260801
  (id, ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, created_at)
select id, ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, created_at
from public.ronda_alerta_intervenciones;

insert into public.ronda_alertas_archivo_20260801
  (id, objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
   tipo, ventana_inicio, ventana_fin, vencimiento_at, estado, detectada_at,
   resuelta_por, resuelta_at, accion, comentario, created_at, updated_at, motivo_vigilador)
select id, objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
       tipo, ventana_inicio, ventana_fin, vencimiento_at, estado, detectada_at,
       resuelta_por, resuelta_at, accion, comentario, created_at, updated_at, motivo_vigilador
from public.ronda_alertas;

-- Las tablas de archivo no son API. Sin grants, no las ve ningún cliente.
revoke all on table public.ronda_alertas_archivo_20260801               from anon, authenticated;
revoke all on table public.ronda_alerta_intervenciones_archivo_20260801 from anon, authenticated;

-- ── Verificación del archivo ANTES de borrar ────────────────────────────────
do $$
declare
  v_a bigint; v_aa bigint; v_i bigint; v_ia bigint;
begin
  select count(*) into v_a  from public.ronda_alertas;
  select count(*) into v_aa from public.ronda_alertas_archivo_20260801;
  select count(*) into v_i  from public.ronda_alerta_intervenciones;
  select count(*) into v_ia from public.ronda_alerta_intervenciones_archivo_20260801;

  if v_a <> v_aa or v_i <> v_ia then
    raise exception
      'ABORTA: el archivo no coincide con el origen (alertas %/%; intervenciones %/%). No se borra nada.',
      v_aa, v_a, v_ia, v_i;
  end if;

  raise notice 'Archivo verificado: % alertas y % intervenciones respaldadas.', v_aa, v_ia;
end;
$$;

-- ── Borrado ─────────────────────────────────────────────────────────────────
-- Explícito sobre las intervenciones aunque el CASCADE las arrastraría igual:
-- deja el hecho escrito en la migración en lugar de delegarlo en la FK.
delete from public.ronda_alerta_intervenciones;
delete from public.ronda_alertas;

-- ── G3 · La tabla quedó vacía ───────────────────────────────────────────────
do $$
declare
  v_a bigint; v_i bigint;
begin
  select count(*) into v_a from public.ronda_alertas;
  select count(*) into v_i from public.ronda_alerta_intervenciones;

  if v_a <> 0 or v_i <> 0 then
    raise exception 'ABORTA: quedaron filas (alertas %, intervenciones %).', v_a, v_i;
  end if;

  raise notice 'Reset completo. La medición de alertas de rondas arranca de cero.';
end;
$$;

commit;
