-- ═══════════════════════════════════════════════════════════════════════════
-- ORIGEN DE LAS REFERENCIAS DE PUNTO
--
-- Qué resuelve
--   Hasta ahora, una foto de ronda confirmada como CORRECTA se promovía a
--   referencia SÓLO si el punto no tenía ninguna. Si ya había una, quedaba
--   congelada para siempre — incluso cuando era una que el propio sistema había
--   promovido meses antes y ya no describe el lugar.
--
--   El bloqueo era deliberado: la automatización no debe pisar una decisión de
--   Administración. Pero no distinguía entre una referencia subida a mano y una
--   auto-promovida, y protegía a las dos por igual.
--
-- Qué habilita
--   manual          → la cargó una persona desde el editor del punto. Intocable.
--   revision_humana → la promovió el sistema tras una confirmación humana. Puede
--                     ser reemplazada por una confirmación posterior, cerrando la
--                     vigencia de la anterior y conservándola como histórica.
--
--   INCORRECTO nunca cambia una referencia. Gemini nunca cambia una referencia
--   sin que una persona haya confirmado antes.
--
-- Naturaleza
--   Aditiva. Una columna con default, un CHECK y un UPDATE que sólo reclasifica
--   lo que se puede demostrar. No borra ni desactiva ninguna referencia.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. La columna ─────────────────────────────────────────────────────────
-- Default 'manual' a propósito: es el valor conservador. Lo que no se pueda
-- demostrar que salió de una confirmación humana queda protegido de por vida.
alter table public.ronda_punto_referencias
  add column if not exists origen text not null default 'manual';

comment on column public.ronda_punto_referencias.origen is
  'De dónde salió esta referencia. manual = la cargó una persona en el editor del punto '
  'y la automatización nunca la reemplaza. revision_humana = la promovió el sistema tras '
  'un CORRECTO en la bandeja, y una confirmación posterior puede sustituirla.';

-- ── 2. Backfill conservador ───────────────────────────────────────────────
-- Sólo se reclasifica lo DEMOSTRABLE. Hacen falta las dos condiciones a la vez:
--
--   a) la descripción es exactamente la que escribe la ruta de promoción, y
--   b) los bytes de la referencia son una copia de una evidencia de ronda que
--      una persona confirmó como CORRECTA — mismo contenido_sha256, mismo punto.
--
-- La condición (b) es la que hace que esto sea una demostración y no una
-- suposición: la referencia contiene literalmente los bytes de una foto que
-- alguien revisó y aprobó. Una referencia subida a mano no puede cumplirla por
-- casualidad salvo que sea, efectivamente, esa misma foto.
--
-- Ante cualquier duda, la fila se queda en 'manual'.
update public.ronda_punto_referencias r
set    origen = 'revision_humana'
where  r.descripcion = 'Tomada de una foto real confirmada como correcta en la revisión.'
  and  r.contenido_sha256 is not null
  and  exists (
         select 1
         from public.evidencia_analisis a
         join public.evidencias ev on ev.id = a.evidencia_id
         join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
         where a.analisis_tipo   = 'punto_control'
           and a.revision_estado = 'CORRECTO'
           and ev.contenido_sha256 = r.contenido_sha256
           and rep.ronda_punto_id  = r.ronda_punto_id
       );

-- ── 3. El dominio ─────────────────────────────────────────────────────────
-- Se agrega DESPUÉS del backfill: si alguna fila quedara fuera del dominio, la
-- migración falla acá y no deja la tabla en un estado a medias.
alter table public.ronda_punto_referencias
  drop constraint if exists ronda_punto_referencias_origen_valido;

alter table public.ronda_punto_referencias
  add constraint ronda_punto_referencias_origen_valido
  check (origen in ('manual', 'revision_humana'));

-- ── 4. Índice de la consulta caliente ─────────────────────────────────────
-- "¿este punto tiene referencia activa y de qué origen?" se pregunta en cada
-- confirmación de la bandeja y en cada análisis de ronda.
create index if not exists idx_ronda_punto_referencias_activa_origen
  on public.ronda_punto_referencias (ronda_punto_id, origen)
  where activo;

commit;
