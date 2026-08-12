-- ============================================================================
-- OBJETIVOS · Fijos y móviles, con historial de ubicaciones vigentes
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- Hay objetivos que se mudan. Laromet Ruta 34 es uno: su ubicación puede
-- cambiar kilómetros y todas las ubicaciones fueron correctas en su momento.
-- Hoy el sistema no puede expresar eso. `objetivos.lat/lng` guarda dónde está
-- ahora y nada más; la auditoría dice quién tocó qué, en filas sueltas por
-- campo, sin noción de vigencia. No hay forma de responder "dónde estaba este
-- objetivo en marzo".
--
-- Esta migración agrega esa noción sin crear una fuente GPS paralela.
--
-- LA REGLA CENTRAL
--
--   `objetivos.lat/lng/radio_metros` SIGUE SIENDO la ubicación vigente y sigue
--   siendo lo que leen fichajes, rondas, supervisiones y todo lo demás.
--
-- `objetivo_ubicaciones` es el historial: qué ubicación rigió entre qué fechas.
-- Ningún módulo tiene que consultarla para operar. Se la consulta para saber
-- historia, no para saber dónde está el objetivo hoy.
--
-- CÓMO SE EVITA QUE LAS DOS SE DESINCRONICEN
--
-- No alcanza con "acordarse de usar la RPC". Se cierra por privilegios:
--
--   1. Se revoca UPDATE de `objetivos` a `authenticated`.
--   2. Se concede UPDATE columna por columna sobre TODO menos lat, lng y
--      radio_metros.
--   3. Esas tres sólo las puede escribir el dueño de la tabla, y el único que
--      corre como dueño es `establecer_ubicacion_objetivo()`, que es
--      SECURITY DEFINER.
--
-- Un `update objetivos set lat = ...` desde PostgREST pasa a fallar con
-- "permission denied for column lat". No es una convención: es el motor.
--
-- Efecto colateral bienvenido: la política RLS de objetivos sigue siendo la
-- permisiva original (`using (true)`), así que hasta hoy cualquier usuario con
-- sesión podía mover un objetivo. Después de esto, ninguno puede.
--
-- SERVICE_ROLE SIGUE SIENDO LLAVE MAESTRA — decisión explícita.
--
-- No se le revoca nada. Es la llave maestra por diseño y bloquearla suele
-- terminar en que alguien desactiva el candado entero. Hoy NINGUNA ruta /api
-- escribe objetivos (verificado sobre el repositorio).
--
--   REGLA PARA EL FUTURO: cualquier ruta /api o script que necesite cambiar la
--   ubicación o el radio de un objetivo DEBE llamar a
--   `establecer_ubicacion_objetivo()`. Escribir `objetivos.lat/lng/radio_metros`
--   directo con service_role es técnicamente posible y deja el historial de
--   vigencias desincronizado en silencio, que es el único modo en que este
--   diseño puede romperse.
--
-- EL ALTA NO SE TOCA
--
-- Crear un objetivo con su ubicación es legítimo y sigue siendo un INSERT
-- normal. Un trigger AFTER INSERT abre la primera vigencia. Así los dos flujos
-- de alta que ya existen siguen andando sin cambios.
--
-- INCORPORACIÓN INICIAL DE LOS OBJETIVOS QUE YA EXISTEN
--
-- No se usa `created_at` como inicio de la vigencia actual, y es a propósito:
-- sería mentira. Un objetivo creado en 2025 y mudado tres veces tendría una
-- vigencia falsa de un año. La auditoría no permite reconstruirlo (se creó
-- ayer y no tiene el historial anterior).
--
-- Entonces la primera vigencia de cada objetivo existente arranca en la FECHA
-- DE ESTA MIGRACIÓN, con origen 'incorporacion_inicial'. Dice exactamente lo
-- que sabemos: "desde acá conocemos esta ubicación". Lo anterior queda como
-- desconocido, que es la verdad.
--
-- QUÉ NO TOCA
--   * Ni una fila de registros_asistencia. La evidencia histórica no se
--     recalcula nunca: cada fichaje conserva la distancia y el veredicto que
--     se calcularon contra la ubicación vigente en ese momento.
--   * Los puntos de ronda. Mover un objetivo NO mueve sus puntos: son
--     ubicaciones independientes y moverlas es otra decisión.
--   * Ninguna política RLS existente.
-- ============================================================================

begin;

-- ── Tipo de ubicación ───────────────────────────────────────────────────────

alter table public.objetivos
  add column if not exists tipo_ubicacion text not null default 'fijo';

alter table public.objetivos
  add constraint objetivos_tipo_ubicacion_valido
  check (tipo_ubicacion in ('fijo', 'movil'));

comment on column public.objetivos.tipo_ubicacion is
  'fijo = su ubicación no cambia; si los fichajes caen lejos, está mal cargada. '
  'movil = se traslada legítimamente, y las ubicaciones anteriores no fueron '
  'errores. Cambia cómo se diagnostica: un móvil se analiza sólo con los '
  'fichajes posteriores a su vigencia actual.';

-- ── Historial de vigencias ──────────────────────────────────────────────────

create table public.objetivo_ubicaciones (
  id             uuid primary key default gen_random_uuid(),
  objetivo_id    uuid not null references public.objetivos(id) on delete cascade,

  lat            numeric not null,
  lng            numeric not null,
  radio_metros   integer not null,

  vigente_desde  timestamptz not null,
  vigente_hasta  timestamptz,

  origen         text not null,
  firma          text,

  creado_por     uuid references public.usuarios(id),
  created_at     timestamptz not null default now(),

  constraint objetivo_ubicaciones_origen_valido
    check (origen in ('incorporacion_inicial', 'alta', 'manual', 'diagnostico_gps')),

  constraint objetivo_ubicaciones_firma_coherente
    check ((origen = 'diagnostico_gps') = (firma is not null)),

  constraint objetivo_ubicaciones_lat_valida
    check (lat between -90 and 90),
  constraint objetivo_ubicaciones_lng_valida
    check (lng between -180 and 180),
  constraint objetivo_ubicaciones_radio_valido
    check (radio_metros > 0),

  constraint objetivo_ubicaciones_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

comment on table public.objetivo_ubicaciones is
  'Historial de ubicaciones de cada objetivo, con vigencia. NO es la fuente que '
  'consultan los módulos para operar: esa sigue siendo objetivos.lat/lng, que '
  'es la vigencia abierta. Se escribe únicamente desde '
  'establecer_ubicacion_objetivo() y desde el trigger de alta.';

-- Una sola vigencia abierta por objetivo. Es la invariante del historial y da
-- el error más claro cuando algo intenta abrir una segunda.
create unique index uq_objetivo_ubicaciones_vigente
  on public.objetivo_ubicaciones (objetivo_id)
  where vigente_hasta is null;

-- Sin solapamientos, tampoco entre vigencias ya cerradas.
--
-- El índice único de arriba impide dos vigencias ABIERTAS, pero no impide que
-- dos cerradas se pisen: [ene, mar) y [feb, abr) pasarían. Con eso, preguntar
-- "dónde estaba el objetivo en febrero" tendría dos respuestas.
--
-- Un EXCLUDE sobre el rango lo hace imposible de forma declarativa. Necesita
-- btree_gist para poder combinar la igualdad de objetivo_id (btree) con el
-- solapamiento de rangos (gist) en el mismo índice.
create extension if not exists btree_gist with schema extensions;

alter table public.objetivo_ubicaciones
  add constraint objetivo_ubicaciones_sin_solapamiento
  exclude using gist (
    objetivo_id with =,
    tstzrange(vigente_desde, vigente_hasta) with &&
  );

create index idx_objetivo_ubicaciones_objetivo
  on public.objetivo_ubicaciones (objetivo_id, vigente_desde desc);

alter table public.objetivo_ubicaciones enable row level security;

revoke all on table public.objetivo_ubicaciones from public;
revoke all on table public.objetivo_ubicaciones from anon;
revoke all on table public.objetivo_ubicaciones from authenticated;

grant select on table public.objetivo_ubicaciones to authenticated;

create policy "Admin supervisor lee ubicaciones de objetivos de su alcance"
on public.objetivo_ubicaciones
for select
to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

-- ── Incorporación inicial ───────────────────────────────────────────────────
-- Los objetivos que ya tienen ubicación estrenan su primera vigencia HOY, no
-- en su created_at. Ver la explicación de la cabecera.

-- Sólo objetivos con ubicación GPS COMPLETA: latitud, longitud y radio. Un
-- objetivo a medio configurar no estrena una vigencia con un radio inventado;
-- se queda sin vigencia hasta que alguien le cargue la ubicación de verdad, y
-- ahí la RPC le abre la primera.

insert into public.objetivo_ubicaciones (
  objetivo_id, lat, lng, radio_metros, vigente_desde, origen
)
select o.id, o.lat, o.lng, o.radio_metros, now(), 'incorporacion_inicial'
from public.objetivos o
where o.lat is not null
  and o.lng is not null
  and o.radio_metros is not null
  and o.radio_metros > 0;

-- ── Alta de objetivos: abre la primera vigencia sola ────────────────────────
-- Así los dos flujos de alta que ya existen siguen funcionando sin cambios.

create or replace function public.objetivos_abrir_vigencia_alta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Ubicación incompleta: no se abre vigencia. Nada de radios inventados; el
  -- objetivo queda sin vigencia hasta que se le configure una de verdad.
  if new.lat is null
     or new.lng is null
     or new.radio_metros is null
     or new.radio_metros <= 0 then
    return new;
  end if;

  insert into public.objetivo_ubicaciones (
    objetivo_id, lat, lng, radio_metros, vigente_desde, origen, creado_por
  ) values (
    new.id, new.lat, new.lng, new.radio_metros, now(), 'alta',
    (select u.id from public.usuarios u
      where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1)
  );

  return new;
end;
$$;

revoke all on function public.objetivos_abrir_vigencia_alta() from public;
revoke all on function public.objetivos_abrir_vigencia_alta() from anon;
revoke all on function public.objetivos_abrir_vigencia_alta() from authenticated;

drop trigger if exists trg_objetivos_vigencia_alta on public.objetivos;
create trigger trg_objetivos_vigencia_alta
  after insert on public.objetivos
  for each row execute function public.objetivos_abrir_vigencia_alta();

-- ── Ruta autoritativa única para mover un objetivo ──────────────────────────

create or replace function public.establecer_ubicacion_objetivo(
  p_objetivo_id   uuid,
  p_lat           double precision,
  p_lng           double precision,
  p_radio_metros  integer,
  p_vigente_desde timestamptz default null,
  p_origen        text default 'manual',
  p_firma         text default null
)
returns public.objetivos
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo public.objetivos;
  v_usuario  uuid;
  v_desde    timestamptz;
  v_actual   public.objetivo_ubicaciones;
begin
  -- ── Autorización ─────────────────────────────────────────────────────────
  -- La función es SECURITY DEFINER: corre con los privilegios del dueño y por
  -- lo tanto RLS no la frena. Toda la autorización se resuelve acá, ANTES de
  -- tocar una sola fila, y contra auth.uid() — nunca contra un parámetro que
  -- venga del cliente. `search_path` está fijado en la definición para que
  -- nadie pueda anteponer un esquema propio y secuestrar estas llamadas.

  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  -- FOR UPDATE serializa: dos ediciones simultáneas del mismo objetivo se
  -- ordenan en vez de pisarse, y es lo que impide que queden dos vigencias
  -- abiertas por carrera. El lock se toma antes de leer la vigencia vigente.
  select o.* into v_objetivo
  from public.objetivos o
  where o.id = p_objetivo_id
  for update;

  if not found then
    raise exception 'Objetivo no encontrado';
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    raise exception 'No autorizado para mover este objetivo';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'La ubicacion necesita latitud y longitud';
  end if;
  if p_lat < -90 or p_lat > 90 then
    raise exception 'Latitud fuera de rango';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'Longitud fuera de rango';
  end if;
  if p_radio_metros is null or p_radio_metros <= 0 then
    raise exception 'El radio debe ser mayor que cero';
  end if;
  if p_origen not in ('manual', 'diagnostico_gps') then
    raise exception 'Origen de cambio no reconocido (%)', p_origen;
  end if;
  if (p_origen = 'diagnostico_gps') <> (p_firma is not null) then
    raise exception 'Solo un cambio por diagnostico lleva firma, y siempre la lleva';
  end if;

  -- Sólo un objetivo móvil puede declarar desde cuándo rige la ubicación: en
  -- uno fijo, una ubicación nueva es una corrección de algo que estaba mal, y
  -- corregir no tiene fecha de inicio.
  if v_objetivo.tipo_ubicacion = 'movil' then
    v_desde := coalesce(p_vigente_desde, now());
  else
    v_desde := now();
  end if;

  if v_desde > now() then
    raise exception 'La vigencia no puede empezar en el futuro';
  end if;

  select u.* into v_actual
  from public.objetivo_ubicaciones u
  where u.objetivo_id = p_objetivo_id
    and u.vigente_hasta is null
  limit 1;

  if found and v_desde <= v_actual.vigente_desde then
    raise exception
      'La nueva vigencia (%) tiene que empezar despues de la actual (%)',
      v_desde, v_actual.vigente_desde;
  end if;

  select u.id into v_usuario
  from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;

  -- 1) Se cierra la vigencia anterior en el mismo instante en que empieza la
  --    nueva: el historial no queda con huecos ni con solapamientos.
  update public.objetivo_ubicaciones
  set vigente_hasta = v_desde
  where objetivo_id = p_objetivo_id
    and vigente_hasta is null;

  -- 2) Se abre la nueva.
  insert into public.objetivo_ubicaciones (
    objetivo_id, lat, lng, radio_metros, vigente_desde, origen, firma, creado_por
  ) values (
    p_objetivo_id, p_lat, p_lng, p_radio_metros, v_desde, p_origen, p_firma, v_usuario
  );

  -- 3) Se actualiza el objetivo, que es lo que lee todo el sistema. El contexto
  --    viaja en el mismo UPDATE para que la auditoría distinga manual de
  --    diagnóstico; el trigger lo consume y lo deja en NULL.
  update public.objetivos
  set lat = p_lat,
      lng = p_lng,
      radio_metros = p_radio_metros,
      ctx_cambio_origen = p_origen,
      ctx_cambio_firma = p_firma
  where id = p_objetivo_id
  returning * into v_objetivo;

  return v_objetivo;
end;
$$;

comment on function public.establecer_ubicacion_objetivo(uuid, double precision, double precision, integer, timestamptz, text, text) is
  'Única ruta para cambiar la ubicación o el radio de un objetivo. Cierra la '
  'vigencia anterior, abre la nueva y actualiza objetivos, todo en la misma '
  'transacción. Las columnas lat/lng/radio_metros no se pueden escribir por '
  'fuera de acá: authenticated no tiene privilegio sobre ellas.';

revoke all on function public.establecer_ubicacion_objetivo(uuid, double precision, double precision, integer, timestamptz, text, text) from public;
revoke all on function public.establecer_ubicacion_objetivo(uuid, double precision, double precision, integer, timestamptz, text, text) from anon;
grant execute on function public.establecer_ubicacion_objetivo(uuid, double precision, double precision, integer, timestamptz, text, text) to authenticated;

-- ── EL CANDADO ──────────────────────────────────────────────────────────────
-- Sin esto, todo lo anterior es una convención que alguien va a saltear sin
-- querer. Con esto, saltearla es imposible.

revoke update on table public.objetivos from authenticated;

grant update (
  nombre,
  cliente,
  direccion,
  estado,
  checklist_plantilla_id,
  frecuencia_supervision_horas,
  zona_id,
  es_prueba,
  tipo_ubicacion
) on table public.objetivos to authenticated;

-- lat, lng, radio_metros y las columnas de contexto quedan deliberadamente
-- afuera: sólo las escribe establecer_ubicacion_objetivo(), que corre como
-- dueño de la tabla.

notify pgrst, 'reload schema';

commit;
