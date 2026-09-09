-- ============================================================================
-- IA ANÁLISIS DE IMÁGENES · FASE A — Modelo de datos
-- ============================================================================
--
-- Base de datos del agente visual: configuraciones versionadas con referencias
-- fotográficas, análisis por evidencia, revisión humana append-only y
-- referencias por punto de ronda (preparadas, NO activadas).
--
-- ESTA MIGRACIÓN ES ADITIVA Y REVERSIBLE.
--
-- Rollback:     supabase/rollback/20260811100000_ia_analisis_base_rollback.sql
-- Verificación: supabase/verificacion/20260811100000_ia_analisis_base_pre_post.sql
--
-- ── QUÉ NO TOCA, NI UNA FILA ────────────────────────────────────────────────
--   registros_asistencia   turnos              horas liquidables
--   ronda_alertas          ronda_ejecuciones   ronda_ejecucion_puntos
--   rondas_base            ronda_puntos        supervisiones / supervision_fotos
--   objetivos              usuarios            liquidación / JWM
--   objetos de Storage existentes (ingreso-evidencias, ronda-evidencias)
--   políticas RLS existentes (ni las de `evidencias`, ni las de storage)
--
-- Sobre `evidencias` sólo AGREGA cuatro columnas nullable y un trigger de
-- updated_at. No modifica ninguna fila existente, ni ninguna policy, ni el
-- trigger rondas_validar_evidencia_punto.
--
-- ── POR QUÉ NO SE ENDURECE STORAGE ACÁ ──────────────────────────────────────
-- Las rutas de subida usan `upsert: true` con paths determinísticos y eso es
-- deliberado: un reintento de red reescribe el mismo objeto en lugar de dejar
-- huérfanos. Cambiarlo ahora arriesga el fichaje. Esta fase instala sólo la
-- capacidad de DETECTAR un reemplazo (hash), no de impedirlo. El endurecimiento
-- del reemplazo es una fase posterior y separada.
--
-- ── VOCABULARIOS ────────────────────────────────────────────────────────────
-- Los estados de procesamiento van en minúscula, como en el resto del repo
-- (`pendiente`, `procesando`, …). Las clasificaciones de IA y las decisiones
-- humanas van en MAYÚSCULA porque son vocabulario de dominio que viaja tal cual
-- en el JSON del modelo y en la interfaz; mantenerlas iguales en los dos lados
-- evita una capa de traducción que sólo puede introducir errores.
-- ============================================================================

begin;

-- ── Guardas de dependencia ──────────────────────────────────────────────────
-- Aborta antes de crear nada si falta alguna pieza que estas tablas asumen.
do $$
begin
  if to_regclass('public.evidencias') is null then
    raise exception 'Dependencia faltante: tabla public.evidencias';
  end if;
  if to_regclass('public.ronda_puntos') is null then
    raise exception 'Dependencia faltante: tabla public.ronda_puntos';
  end if;
  if to_regclass('public.app_config') is null then
    raise exception 'Dependencia faltante: tabla public.app_config';
  end if;
  if to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is null then
    raise exception 'Dependencia faltante: puede_administrar_rondas_objetivo(uuid)';
  end if;
  if to_regprocedure('public.rondas_usuario_actual_id()') is null then
    raise exception 'Dependencia faltante: rondas_usuario_actual_id()';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Dependencia faltante: set_updated_at()';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. HELPERS DE ROL
-- ════════════════════════════════════════════════════════════════════════════
-- Mismo patrón que rondas_usuario_actual_id(): SQL, stable, security definer,
-- search_path fijo. Se usan sólo en policies de las tablas de configuración,
-- que no tienen objetivo_id y por lo tanto no pueden usar el helper de zonas.

create or replace function public.ia_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and u.rol = 'admin'
  )
$$;

comment on function public.ia_es_admin() is
  'true si el usuario autenticado es admin activo. Uso: policies de configuración IA.';

create or replace function public.ia_es_operador()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and u.rol in ('admin', 'supervisor')
  )
$$;

comment on function public.ia_es_operador() is
  'true si el usuario autenticado es admin o supervisor activo. El supervisor '
  'necesita LEER los criterios para poder juzgar una foto, aunque no pueda editarlos.';

revoke all on function public.ia_es_admin()     from public;
revoke all on function public.ia_es_admin()     from anon;
revoke all on function public.ia_es_operador()  from public;
revoke all on function public.ia_es_operador()  from anon;
grant execute on function public.ia_es_admin()    to authenticated;
grant execute on function public.ia_es_operador() to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. COLUMNAS NUEVAS EN `evidencias`  (aditivas, nullable)
-- ════════════════════════════════════════════════════════════════════════════
-- contenido_sha256 / bytes / content_type los va a poblar la FASE C desde las
-- rutas de subida, que ya tienen el Buffer en memoria. Quedan NULL en las 2.046
-- filas históricas: eso es correcto y es lo que las mantiene fuera del pipeline
-- de producción (forward-only) sin necesidad de ninguna otra marca.
--
-- updated_at NO lleva default: una fila con updated_at IS NULL es una fila que
-- nunca fue modificada desde que existe la columna. Poner default now() en el
-- ALTER escribiría una fecha falsa en las 2.046 filas históricas y destruiría
-- justamente la señal que queremos.

alter table public.evidencias
  add column if not exists contenido_sha256 text,
  add column if not exists bytes            integer,
  add column if not exists content_type     text,
  add column if not exists updated_at       timestamptz;

comment on column public.evidencias.contenido_sha256 is
  'SHA-256 hex de los bytes al momento de escribir. NULL en evidencias previas a 2026-08.';
comment on column public.evidencias.updated_at is
  'NULL = nunca modificada desde que existe la columna. Sin default a propósito.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evidencias_contenido_sha256_formato'
      and conrelid = 'public.evidencias'::regclass
  ) then
    alter table public.evidencias
      add constraint evidencias_contenido_sha256_formato
      check (contenido_sha256 is null or contenido_sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evidencias_bytes_positivo'
      and conrelid = 'public.evidencias'::regclass
  ) then
    alter table public.evidencias
      add constraint evidencias_bytes_positivo
      check (bytes is null or bytes > 0);
  end if;
end $$;

-- El trigger sólo escribe updated_at. No puede fallar y no valida nada, así que
-- no introduce ninguna vía nueva de error en el INSERT/upsert del fichaje.
-- Convive con trg_rondas_validar_evidencia_punto: tocan columnas distintas.
drop trigger if exists trg_evidencias_updated_at on public.evidencias;
create trigger trg_evidencias_updated_at
  before update on public.evidencias
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 3. STORAGE — bucket privado de referencias
-- ════════════════════════════════════════════════════════════════════════════
-- Mismo criterio que ronda-evidencias (20260728223000): privado, con límite de
-- tamaño y MIME a nivel de bucket, y SIN policies para authenticated. La carga
-- y la lectura pasan por rutas de servidor con service_role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ia-referencias',
  'ia-referencias',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. `ia_configuraciones` — criterios + config técnica, versionados
-- ════════════════════════════════════════════════════════════════════════════
-- Una fila = una versión completa de "cómo se analiza este tipo de evidencia":
-- los criterios que la operación edita desde Administración Y la config técnica
-- (proveedor, modelo, schema, umbrales). Van juntos a propósito: si Mercosur
-- cambia el criterio de uniforme en diciembre, eso ES una versión nueva, y los
-- análisis de agosto tienen que seguir apuntando a la de agosto.

create table if not exists public.ia_configuraciones (
  id                uuid primary key default gen_random_uuid(),

  analisis_tipo     text not null check (analisis_tipo in ('uniforme', 'libro_guardia', 'punto_control')),
  version           text not null,
  nombre            text not null,
  descripcion       text,

  -- Criterios visibles para la operación (prendas requeridas, campos del libro).
  -- Se edita desde la UI de Referencias IA; no vive escondido en un prompt.
  criterios         jsonb not null default '{}'::jsonb,

  -- Umbrales: qué motivos elevan a REVISAR, confianza mínima. Separado de
  -- `criterios` porque cambiar un umbral NO exige volver a llamar al modelo:
  -- se recalcula `clasificacion_efectiva` desde `resultado_json` ya guardado.
  umbrales          jsonb not null default '{}'::jsonb,

  -- Config técnica.
  proveedor         text not null default 'gemini',
  modelo            text not null,
  prompt            text not null,
  prompt_sha256     text,
  schema_json       jsonb not null default '{}'::jsonb,

  -- Vigencia (§15 del pedido).
  activo            boolean not null default false,
  vigente_desde     timestamptz not null default now(),
  vigente_hasta     timestamptz,

  created_at        timestamptz not null default now(),
  created_by        uuid references public.usuarios(id) on delete set null,
  updated_at        timestamptz not null default now(),

  constraint ia_configuraciones_version_no_vacia
    check (length(btrim(version)) > 0),
  constraint ia_configuraciones_nombre_no_vacio
    check (length(btrim(nombre)) > 0),
  constraint ia_configuraciones_modelo_no_vacio
    check (length(btrim(modelo)) > 0),
  constraint ia_configuraciones_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta > vigente_desde),
  constraint ia_configuraciones_prompt_sha256_formato
    check (prompt_sha256 is null or prompt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ia_configuraciones_tipo_version_unica
    unique (analisis_tipo, version)
);

comment on table public.ia_configuraciones is
  'Versión completa de criterios + config técnica por tipo de análisis. '
  'Cambiar un criterio = insertar una versión nueva, nunca editar la vigente.';

-- Una sola configuración activa por tipo, garantizado por la base.
create unique index if not exists uq_ia_configuraciones_activa_por_tipo
  on public.ia_configuraciones (analisis_tipo)
  where activo;

create index if not exists idx_ia_configuraciones_tipo_vigencia
  on public.ia_configuraciones (analisis_tipo, vigente_desde desc);

drop trigger if exists trg_ia_configuraciones_updated_at on public.ia_configuraciones;
create trigger trg_ia_configuraciones_updated_at
  before update on public.ia_configuraciones
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 5. `ia_referencia_imagenes` — fotos de referencia de uniforme y libro
-- ════════════════════════════════════════════════════════════════════════════
-- Tabla hija, no una columna: §12 y §13 piden "una o varias fotografías".
-- Toda imagen tiene fila; no hay archivos sueltos en el bucket (§27).

create table if not exists public.ia_referencia_imagenes (
  id                uuid primary key default gen_random_uuid(),
  configuracion_id  uuid not null references public.ia_configuraciones(id) on delete cascade,

  bucket            text not null default 'ia-referencias',
  storage_path      text not null,
  contenido_sha256  text,
  bytes             integer,
  content_type      text,

  descripcion       text,
  orden             integer not null default 1,
  activo            boolean not null default true,

  created_at        timestamptz not null default now(),
  created_by        uuid references public.usuarios(id) on delete set null,

  constraint ia_referencia_imagenes_bucket_valido
    check (bucket = 'ia-referencias'),
  constraint ia_referencia_imagenes_path_no_vacio
    check (length(btrim(storage_path)) > 0),
  constraint ia_referencia_imagenes_sha256_formato
    check (contenido_sha256 is null or contenido_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ia_referencia_imagenes_bytes_positivo
    check (bytes is null or bytes > 0),
  constraint ia_referencia_imagenes_orden_valido
    check (orden between 1 and 100),
  constraint ia_referencia_imagenes_path_unico
    unique (bucket, storage_path)
);

comment on table public.ia_referencia_imagenes is
  'Fotos de referencia asociadas a una versión de configuración. ON DELETE CASCADE: '
  'borrar una configuración borra sus filas de imagen (los objetos de Storage se '
  'limpian aparte, desde la ruta de servidor).';

create index if not exists idx_ia_referencia_imagenes_config
  on public.ia_referencia_imagenes (configuracion_id, activo, orden);


-- ════════════════════════════════════════════════════════════════════════════
-- 6. `ronda_punto_referencias` — preparado, NO activado
-- ════════════════════════════════════════════════════════════════════════════
-- §37: tabla separada, no una columna, para soportar varias referencias por
-- punto aunque la UI inicial cargue una sola.
--
-- §38: es metadata nueva. NO cambia obligación, GPS, politica_foto, alertas,
-- ejecución ni cumplimiento. Ninguna función viva de rondas lee esta tabla.

create table if not exists public.ronda_punto_referencias (
  id                uuid primary key default gen_random_uuid(),
  ronda_punto_id    uuid not null references public.ronda_puntos(id) on delete cascade,

  bucket            text not null default 'ia-referencias',
  storage_path      text not null,
  contenido_sha256  text,
  bytes             integer,
  content_type      text,

  descripcion       text,
  activo            boolean not null default true,
  vigente_desde     timestamptz not null default now(),
  vigente_hasta     timestamptz,

  created_at        timestamptz not null default now(),
  created_by        uuid references public.usuarios(id) on delete set null,

  constraint ronda_punto_referencias_bucket_valido
    check (bucket = 'ia-referencias'),
  constraint ronda_punto_referencias_path_no_vacio
    check (length(btrim(storage_path)) > 0),
  constraint ronda_punto_referencias_sha256_formato
    check (contenido_sha256 is null or contenido_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ronda_punto_referencias_bytes_positivo
    check (bytes is null or bytes > 0),
  constraint ronda_punto_referencias_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta > vigente_desde),
  constraint ronda_punto_referencias_path_unico
    unique (bucket, storage_path)
);

comment on table public.ronda_punto_referencias is
  'Fotos de referencia por punto de control. Metadata para análisis futuro: '
  'NINGUNA función de rondas la lee. No afecta obligación, GPS ni cumplimiento.';

create index if not exists idx_ronda_punto_referencias_punto
  on public.ronda_punto_referencias (ronda_punto_id, activo, vigente_desde desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 7. `ia_lotes` — selección manual de fotos para análisis (§22, §23)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ia_lotes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  descripcion       text,

  modo              text not null default 'prueba'
                    check (modo in ('prueba', 'produccion')),

  -- Filtros con los que se armó el lote: rango, objetivo, vigilador, tipo,
  -- límite. Se guarda tal cual para poder repetir exactamente la misma
  -- selección con otra configuración y comparar.
  filtros           jsonb not null default '{}'::jsonb,

  configuracion_id  uuid references public.ia_configuraciones(id) on delete restrict,

  total_solicitado  integer not null default 0,
  total_encolado    integer not null default 0,

  created_at        timestamptz not null default now(),
  created_by        uuid references public.usuarios(id) on delete set null,
  cerrado_at        timestamptz,

  constraint ia_lotes_nombre_no_vacio
    check (length(btrim(nombre)) > 0),
  constraint ia_lotes_totales_no_negativos
    check (total_solicitado >= 0 and total_encolado >= 0)
);

create index if not exists idx_ia_lotes_created
  on public.ia_lotes (created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 8. `evidencia_analisis` — el núcleo
-- ════════════════════════════════════════════════════════════════════════════
-- FK REAL a evidencias, a diferencia de evidencias.proceso_id, que es
-- polimórfico y por eso no puede tenerla (§20 del snapshot de producción).
--
-- objetivo_id / guardia_id / turno_id son SNAPSHOT denormalizado, no joins:
--   1. la RLS de esta tabla se resuelve sin salto polimórfico;
--   2. la fila sigue siendo legible si el proceso de origen desaparece
--      (ya pasó: 8 evidencias de ronda quedaron huérfanas el 28-29/07).

create table if not exists public.evidencia_analisis (
  id                     uuid primary key default gen_random_uuid(),

  -- ── vínculo ──────────────────────────────────────────────────────────────
  evidencia_id           uuid not null references public.evidencias(id) on delete restrict,
  analisis_tipo          text not null check (analisis_tipo in ('uniforme', 'libro_guardia', 'punto_control')),
  configuracion_id       uuid not null references public.ia_configuraciones(id) on delete restrict,
  configuracion_version  text not null,

  -- ── modo ─────────────────────────────────────────────────────────────────
  modo                   text not null default 'prueba' check (modo in ('prueba', 'produccion')),
  lote_id                uuid references public.ia_lotes(id) on delete set null,

  -- ── snapshot de contexto ─────────────────────────────────────────────────
  objetivo_id            uuid not null references public.objetivos(id) on delete restrict,
  guardia_id             uuid references public.usuarios(id) on delete set null,
  turno_id               uuid references public.turnos(id) on delete set null,
  evidencia_created_at   timestamptz not null,

  -- ── integridad de la evidencia (§28) ─────────────────────────────────────
  -- 'sin_hash' es un estado legítimo, no un error: las 2.046 evidencias
  -- históricas no tienen hash de origen y aun así se pueden analizar en modo
  -- prueba. sha256_analizado deja registro de QUÉ bytes se analizaron.
  sha256_esperado        text,
  sha256_analizado       text,
  integridad             text check (integridad is null or integridad in ('coincide', 'divergente', 'sin_hash')),

  -- ── procesamiento (§31) ──────────────────────────────────────────────────
  estado                 text not null default 'pendiente'
                         check (estado in ('pendiente', 'procesando', 'completado', 'error', 'error_definitivo')),
  intentos               integer not null default 0,
  proximo_intento_at     timestamptz,
  error_clase            text check (error_clase is null or error_clase in ('transitorio', 'permanente')),
  ultimo_error           text,

  -- ── resultado del modelo ─────────────────────────────────────────────────
  proveedor              text,
  modelo                 text,
  resultado_json         jsonb,
  clasificacion_ia       text check (clasificacion_ia is null or clasificacion_ia in
                           ('SIN_OBSERVACIONES', 'REVISAR', 'EVIDENCIA_INSUFICIENTE')),
  evaluable              boolean,
  confianza              numeric(4,3),
  motivos                text[] not null default '{}'::text[],
  resumen                text,

  -- Clasificación efectiva tras aplicar `umbrales`. Se guarda aparte para que
  -- mover un umbral sea un recálculo local y no 3.000 llamadas al proveedor.
  -- La opinión original del modelo nunca se pisa.
  clasificacion_efectiva text check (clasificacion_efectiva is null or clasificacion_efectiva in
                           ('SIN_OBSERVACIONES', 'REVISAR', 'EVIDENCIA_INSUFICIENTE')),

  -- ── muestra de control (§7) ──────────────────────────────────────────────
  -- Marca estable: una foto SIN_OBSERVACIONES sorteada para revisión humana.
  -- Estable y no recalculada en cada consulta, si no la bandeja nunca se vacía
  -- y los falsos negativos no se pueden medir.
  en_muestra_control     boolean not null default false,

  -- ── consumo ──────────────────────────────────────────────────────────────
  tokens_entrada         integer,
  tokens_salida          integer,
  costo_estimado_usd     numeric(12,6),

  -- ── revisión humana (estado actual; el historial va en su propia tabla) ───
  revision_estado        text not null default 'PENDIENTE'
                         check (revision_estado in ('PENDIENTE', 'CORRECTO', 'INCORRECTO')),
  revisado_por           uuid references public.usuarios(id) on delete set null,
  revisado_at            timestamptz,
  revision_comentario    text,

  solicitado_at          timestamptz not null default now(),
  analizado_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- ── coherencia ───────────────────────────────────────────────────────────
  constraint evidencia_analisis_completado_coherente
    check ((estado = 'completado') = (analizado_at is not null)),
  constraint evidencia_analisis_completado_clasifica
    check (estado <> 'completado' or clasificacion_ia is not null),
  constraint evidencia_analisis_revision_coherente
    check ((revision_estado = 'PENDIENTE') = (revisado_at is null)),
  constraint evidencia_analisis_intentos_no_negativos
    check (intentos >= 0),
  constraint evidencia_analisis_confianza_rango
    check (confianza is null or confianza between 0 and 1),
  constraint evidencia_analisis_sha256_esperado_formato
    check (sha256_esperado is null or sha256_esperado ~ '^[0-9a-f]{64}$'),
  constraint evidencia_analisis_sha256_analizado_formato
    check (sha256_analizado is null or sha256_analizado ~ '^[0-9a-f]{64}$'),
  -- Un lote sólo tiene sentido en modo prueba.
  constraint evidencia_analisis_lote_solo_prueba
    check (lote_id is null or modo = 'prueba')
);

comment on table public.evidencia_analisis is
  'Un análisis de IA sobre una evidencia. La revisión humana escribe en columnas '
  'propias y NUNCA modifica resultado_json, clasificacion_ia, motivos ni resumen.';

comment on column public.evidencia_analisis.clasificacion_ia is
  'Lo que dijo el modelo. Inmutable una vez escrito.';
comment on column public.evidencia_analisis.clasificacion_efectiva is
  'Lo que el sistema concluye tras aplicar umbrales. Recalculable sin volver a llamar al modelo.';
comment on column public.evidencia_analisis.en_muestra_control is
  'SIN_OBSERVACIONES sorteada para revisión humana: sirve para medir falsos negativos.';

-- ── Idempotencia (§32) ──────────────────────────────────────────────────────
-- Producción: una sola fila por (evidencia, tipo, versión). Un doble evento,
-- un refresh, un deploy en medio de un lote o dos workers solapados no pueden
-- duplicar. Cambiar de versión hace reaparecer la evidencia como no analizada:
-- ése es el mecanismo de reanálisis deliberado, sin flags ni borrados.
create unique index if not exists uq_evidencia_analisis_produccion
  on public.evidencia_analisis (evidencia_id, analisis_tipo, configuracion_version)
  where modo = 'produccion';

-- Prueba: una sola fila por lote, para poder comparar la misma foto con dos
-- configuraciones distintas sin chocar contra el índice de producción.
create unique index if not exists uq_evidencia_analisis_prueba
  on public.evidencia_analisis (evidencia_id, analisis_tipo, configuracion_version, lote_id)
  where modo = 'prueba' and lote_id is not null;

-- ── Índices de trabajo ──────────────────────────────────────────────────────
create index if not exists idx_evidencia_analisis_evidencia
  on public.evidencia_analisis (evidencia_id);

-- Cola del worker: sólo lo pendiente o reintentable.
create index if not exists idx_evidencia_analisis_cola
  on public.evidencia_analisis (proximo_intento_at nulls first, created_at)
  where estado in ('pendiente', 'error');

-- Bandeja de revisión, ordenada y con alcance por objetivo.
create index if not exists idx_evidencia_analisis_bandeja
  on public.evidencia_analisis (objetivo_id, revision_estado, evidencia_created_at desc);

-- Pendientes de revisión: lo primero que abre el humano cada mañana.
create index if not exists idx_evidencia_analisis_pendientes
  on public.evidencia_analisis (evidencia_created_at desc)
  where revision_estado = 'PENDIENTE' and estado = 'completado';

-- Métricas y matriz de calidad por tipo/versión.
create index if not exists idx_evidencia_analisis_metricas
  on public.evidencia_analisis (analisis_tipo, configuracion_version, clasificacion_efectiva, revision_estado);

-- Informe diario.
create index if not exists idx_evidencia_analisis_fecha
  on public.evidencia_analisis (evidencia_created_at desc);

create index if not exists idx_evidencia_analisis_lote
  on public.evidencia_analisis (lote_id)
  where lote_id is not null;

drop trigger if exists trg_evidencia_analisis_updated_at on public.evidencia_analisis;
create trigger trg_evidencia_analisis_updated_at
  before update on public.evidencia_analisis
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 9. `evidencia_analisis_revisiones` — historial append-only (§21)
-- ════════════════════════════════════════════════════════════════════════════
-- Mismo patrón que ronda_alerta_intervenciones, con una diferencia deliberada:
-- ON DELETE RESTRICT, no CASCADE. Acá nunca queremos poder borrar el análisis
-- y arrastrarnos el historial de decisiones humanas.

create table if not exists public.evidencia_analisis_revisiones (
  id               uuid primary key default gen_random_uuid(),
  analisis_id      uuid not null references public.evidencia_analisis(id) on delete restrict,
  usuario_id       uuid not null references public.usuarios(id) on delete restrict,

  decision         text not null check (decision in ('CORRECTO', 'INCORRECTO')),
  comentario       text,

  estado_anterior  text not null,
  estado_nuevo     text not null,

  created_at       timestamptz not null default now()
);

comment on table public.evidencia_analisis_revisiones is
  'Historial completo (append-only) de decisiones humanas. Cambiar de opinión '
  'agrega una fila; no se edita ni se borra ninguna.';

create index if not exists idx_evidencia_analisis_revisiones_analisis
  on public.evidencia_analisis_revisiones (analisis_id, created_at);

create index if not exists idx_evidencia_analisis_revisiones_usuario
  on public.evidencia_analisis_revisiones (usuario_id, created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 10. RLS
-- ════════════════════════════════════════════════════════════════════════════
-- Estas tablas nacen con alcance por zona (§29). NO se copia la RLS de
-- `evidencias`, que hoy da lectura global a cualquier supervisor.
--
-- Escritura: ninguna policy de INSERT/UPDATE/DELETE para `authenticated`.
-- Escriben service_role (worker, rutas de servidor) y la RPC SECURITY DEFINER.
-- Mismo criterio que ronda_alertas.

alter table public.ia_configuraciones            enable row level security;
alter table public.ia_referencia_imagenes        enable row level security;
alter table public.ronda_punto_referencias       enable row level security;
alter table public.ia_lotes                      enable row level security;
alter table public.evidencia_analisis            enable row level security;
alter table public.evidencia_analisis_revisiones enable row level security;

-- ── Configuración y referencias: lectura admin + supervisor ─────────────────
drop policy if exists "IA configuraciones lectura operativa" on public.ia_configuraciones;
create policy "IA configuraciones lectura operativa"
on public.ia_configuraciones
for select to authenticated
using (public.ia_es_operador());

drop policy if exists "IA referencia imagenes lectura operativa" on public.ia_referencia_imagenes;
create policy "IA referencia imagenes lectura operativa"
on public.ia_referencia_imagenes
for select to authenticated
using (public.ia_es_operador());

-- ── Referencias de punto: alcance por zona, vía punto → ronda → objetivo ────
drop policy if exists "IA referencias de punto por alcance" on public.ronda_punto_referencias;
create policy "IA referencias de punto por alcance"
on public.ronda_punto_referencias
for select to authenticated
using (
  exists (
    select 1
    from public.ronda_puntos rp
    join public.rondas_base rb on rb.id = rp.ronda_base_id
    where rp.id = ronda_punto_referencias.ronda_punto_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

-- ── Lotes: sólo administración ─────────────────────────────────────────────
drop policy if exists "IA lotes lectura admin" on public.ia_lotes;
create policy "IA lotes lectura admin"
on public.ia_lotes
for select to authenticated
using (public.ia_es_admin());

-- ── Análisis: alcance por zona sobre el objetivo denormalizado ─────────────
drop policy if exists "IA analisis lectura por alcance" on public.evidencia_analisis;
create policy "IA analisis lectura por alcance"
on public.evidencia_analisis
for select to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

-- ── Revisiones: heredan el alcance del análisis padre ──────────────────────
drop policy if exists "IA revisiones lectura por alcance" on public.evidencia_analisis_revisiones;
create policy "IA revisiones lectura por alcance"
on public.evidencia_analisis_revisiones
for select to authenticated
using (
  exists (
    select 1
    from public.evidencia_analisis a
    where a.id = evidencia_analisis_revisiones.analisis_id
      and public.puede_administrar_rondas_objetivo(a.objetivo_id)
  )
);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- `anon` ya está cubierto por M1-bis (default privileges revocados), pero se
-- revoca explícito igual: defensa en profundidad, coste cero.
-- `authenticated` sólo SELECT. El vigilador tiene el GRANT pero ninguna policy
-- lo alcanza, así que no ve ni una fila.

revoke all on table public.ia_configuraciones            from anon, authenticated;
revoke all on table public.ia_referencia_imagenes        from anon, authenticated;
revoke all on table public.ronda_punto_referencias       from anon, authenticated;
revoke all on table public.ia_lotes                      from anon, authenticated;
revoke all on table public.evidencia_analisis            from anon, authenticated;
revoke all on table public.evidencia_analisis_revisiones from anon, authenticated;

grant select on table public.ia_configuraciones            to authenticated;
grant select on table public.ia_referencia_imagenes        to authenticated;
grant select on table public.ronda_punto_referencias       to authenticated;
grant select on table public.ia_lotes                      to authenticated;
grant select on table public.evidencia_analisis            to authenticated;
grant select on table public.evidencia_analisis_revisiones to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 11. RPC de revisión humana — único camino de escritura autorizado
-- ════════════════════════════════════════════════════════════════════════════
-- Atómica, deriva identidad de auth.uid(), valida rol y alcance en el servidor
-- (AGENTS.md). Un clic del supervisor = una fila de historial + la
-- desnormalización, en la misma transacción.
--
-- Re-decidir está permitido: agrega otra fila de historial. Eso es lo que
-- permite medir si un revisor cambia de criterio con el tiempo.

create or replace function public.ia_registrar_revision(
  p_analisis_id uuid,
  p_decision    text,
  p_comentario  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id uuid;
  v_analisis   record;
  v_anterior   text;
  v_comentario text;
begin
  if p_decision is null or p_decision not in ('CORRECTO', 'INCORRECTO') then
    raise exception 'Decisión inválida: %', coalesce(p_decision, '(null)');
  end if;

  v_usuario_id := public.rondas_usuario_actual_id();
  if v_usuario_id is null then
    raise exception 'Sesión no válida';
  end if;

  select ea.id, ea.objetivo_id, ea.revision_estado, ea.estado
    into v_analisis
    from public.evidencia_analisis ea
   where ea.id = p_analisis_id
     for update;

  if not found then
    raise exception 'Análisis inexistente';
  end if;

  if not public.puede_administrar_rondas_objetivo(v_analisis.objetivo_id) then
    raise exception 'Sin alcance sobre el objetivo de esta evidencia';
  end if;

  if v_analisis.estado <> 'completado' then
    raise exception 'El análisis no está completado (estado actual: %)', v_analisis.estado;
  end if;

  v_anterior   := v_analisis.revision_estado;
  v_comentario := nullif(btrim(coalesce(p_comentario, '')), '');

  insert into public.evidencia_analisis_revisiones (
    analisis_id, usuario_id, decision, comentario, estado_anterior, estado_nuevo
  ) values (
    p_analisis_id, v_usuario_id, p_decision, v_comentario, v_anterior, p_decision
  );

  -- Sólo columnas de revisión. resultado_json, clasificacion_ia, motivos y
  -- resumen quedan intactos: es el requisito central del pedido.
  update public.evidencia_analisis
     set revision_estado     = p_decision,
         revisado_por        = v_usuario_id,
         revisado_at         = now(),
         revision_comentario = v_comentario
   where id = p_analisis_id;

  return jsonb_build_object(
    'ok',              true,
    'analisis_id',     p_analisis_id,
    'estado_anterior', v_anterior,
    'estado_nuevo',    p_decision,
    'revisado_por',    v_usuario_id
  );
end;
$$;

comment on function public.ia_registrar_revision(uuid, text, text) is
  'Registra una decisión humana CORRECTO/INCORRECTO. Append-only + desnormalización '
  'atómica. No modifica el resultado original de la IA.';

revoke all on function public.ia_registrar_revision(uuid, text, text) from public;
revoke all on function public.ia_registrar_revision(uuid, text, text) from anon;
grant execute on function public.ia_registrar_revision(uuid, text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 12. Parámetros operativos en `app_config`
-- ════════════════════════════════════════════════════════════════════════════
-- ON CONFLICT DO NOTHING: idempotente, no pisa ajustes manuales posteriores.
-- Arranca TODO apagado y en modo prueba. Nada se analiza solo.

insert into public.app_config (key, value, description) values
  ('ia_analisis_enabled', 'false',
   'Interruptor general del agente visual. false = no se procesa nada, ni manual ni automático.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_modo_por_defecto', 'prueba',
   'Modo con el que se encolan los análisis nuevos. Pasa a produccion recién tras calibrar.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_lote_max', '10',
   'Máximo de imágenes por lote/invocación. Tope de servidor para acotar cuota y gasto.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_max_intentos', '5',
   'Reintentos antes de marcar error_definitivo.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_muestra_normales_por_dia', '10',
   'Cuántas fotos SIN_OBSERVACIONES se sortean por día para revisión humana (mide falsos negativos).')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_activacion_desde', '',
   'Corte forward-only para produccion. Vacío = no se procesa ninguna evidencia en modo produccion.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('ia_tipos_activos', 'uniforme,libro_guardia',
   'Tipos de evidencia habilitados. punto_control queda fuera hasta autorización explícita.')
on conflict (key) do nothing;


notify pgrst, 'reload schema';

commit;
