-- ============================================================================
-- PROPUESTA — Corrección de coordenadas y radios de 13 puntos de ronda
-- Auditoría octubre 2026 · NO EJECUTADA · requiere autorización expresa
-- ============================================================================
--
-- Evidencia (consulta de solo lectura del 02/11/2026, lecturas desde 15/09 con
-- precisión ≤ 20 m):
--   * "QR"   = centro de las lecturas GPS tomadas al escanear el cartel QR del
--              punto (el cartel está físicamente en el punto).
--   * "foto" = centro de las lecturas con foto aceptada por la IA contra la
--              referencia del punto.
--
-- Nivel A — ACREDITADO (QR y foto coinciden a ≤ 12 m, ≥ 30 escaneos QR):
--   se corrige la coordenada al centro de los escaneos QR.
-- Nivel B — COORDENADA CORRECTA (≤ 17 m), RADIO IMPOSIBLE: el radio de 10 m es
--   menor que la precisión típica del GPS de los teléfonos (p50 16–20 m).
--   Se lleva al estándar de la flota (30 m). No se mueve el punto.
-- Nivel C — PROBABLE, SÓLO FOTOS: no hay QR que lo confirme. Queda preparado
--   para validación física (un supervisor en el lugar con la app, o instalar
--   el QR primero y repetir esta consulta). NO se ejecuta sin esa validación.
--
-- Trazabilidad: el trigger trg_ronda_puntos_zz_auditoria registra cada campo
-- cambiado en ronda_puntos_auditoria (origen 'manual', valor anterior y nuevo).
-- Las rondas ya iniciadas conservan su snapshot: el cambio NO es retroactivo.
--
-- Uso: revisar, cambiar ROLLBACK por COMMIT al final y ejecutar como
-- service_role / editor SQL. Sólo la sección del nivel autorizado.
-- ============================================================================

begin;

-- ── Respaldo visible (valores actuales) ─────────────────────────────────────
select o.nombre as objetivo, rp.nombre as punto, rp.id, rp.latitud, rp.longitud, rp.radio_metros
  from public.ronda_puntos rp
  join public.rondas_base rb on rb.id = rp.ronda_base_id
  join public.objetivos o on o.id = rb.objetivo_id
 where rp.id in (
   '1a85ff2e-0768-4766-a209-109f0fc0fc0a','05961f92-e473-48cf-8e89-25f281123023',
   'fe339ba5-31f5-48f1-8ce9-c529eff2f65e','49a3b84c-35cd-462e-b34c-a9ca270f6413',
   '284454b9-3644-4d2f-854c-0f73057d8dc8','ce1e7b78-fbe8-4e83-9cb1-e79dd9378acd',
   'ff1f4184-041d-4ba9-b68e-56f969e35c31','c3a8d75b-a70a-402a-aa7f-3e90934be2a9',
   'a9f4092f-e492-4174-b967-7945b0adda14','b8543b75-a0d2-4baf-8296-dc8164a30f1e',
   '940dd44d-2cf9-4f1a-bc97-c4eb7d0dd4f7','e0d5069d-c21e-4fcf-a273-a25b2cc692b9',
   'ed84ed68-a5d4-439f-b03f-7aee94ccba17');

-- ── NIVEL A — acreditado por QR + foto ──────────────────────────────────────
-- CIRSE · Muelle: hoy -32.902898,-60.6787349 · QR n=47 a 150 m · foto n=77 a 144 m · QR↔foto 7 m
update public.ronda_puntos set latitud = -32.9021802, longitud = -60.6800948
 where id = '1a85ff2e-0768-4766-a209-109f0fc0fc0a'
   and latitud = -32.902898 and longitud = -60.6787349;
-- CIRSE · Pluma: hoy -32.9033349,-60.6783433 · QR n=45 a 154 m · foto n=98 a 160 m · QR↔foto 8 m
update public.ronda_puntos set latitud = -32.9026482, longitud = -60.6797725
 where id = '05961f92-e473-48cf-8e89-25f281123023'
   and latitud = -32.9033349 and longitud = -60.6783433;
-- CIRSE · Mantenimiento: hoy -32.9021864,-60.6805211 · QR n=31 a 68 m · foto n=112 a 67 m · QR↔foto 4 m
update public.ronda_puntos set latitud = -32.902797, longitud = -60.6805394
 where id = 'fe339ba5-31f5-48f1-8ce9-c529eff2f65e'
   and latitud = -32.9021864 and longitud = -60.6805211;
-- LA CASONA · Zona de arco: hoy -32.9285279,-60.6594053 r10 · QR n=119 a 37 m · foto n=110 a 25 m · QR↔foto 12 m
update public.ronda_puntos set latitud = -32.9282988, longitud = -60.6591192, radio_metros = 30
 where id = '49a3b84c-35cd-462e-b34c-a9ca270f6413'
   and latitud = -32.9285279 and longitud = -60.6594053 and radio_metros = 10;

-- ── NIVEL B — coordenada correcta, radio 10 m → 30 m ────────────────────────
-- LA CASONA · Guardia: foto n=91 a 14 m del punto actual
update public.ronda_puntos set radio_metros = 30
 where id = '284454b9-3644-4d2f-854c-0f73057d8dc8' and radio_metros = 10;
-- LA CASONA · Mástil: foto n=137 a 17 m del punto actual
update public.ronda_puntos set radio_metros = 30
 where id = 'ce1e7b78-fbe8-4e83-9cb1-e79dd9378acd' and radio_metros = 10;

-- ── NIVEL C — PREPARADO, requiere validación física (comentado) ─────────────
-- DEPOSITO FISCAL · Portería: hoy r10, origen manual · foto n=158 a 49 m
-- update public.ronda_puntos set latitud = -32.9195498, longitud = -60.7070162, radio_metros = 30
--  where id = 'ff1f4184-041d-4ba9-b68e-56f969e35c31' and radio_metros = 10;
-- SKATEPARK · Portón oeste: hoy r10 · foto n=94 a 51 m
-- update public.ronda_puntos set latitud = -32.9296512, longitud = -60.6606918, radio_metros = 30
--  where id = 'a9f4092f-e492-4174-b967-7945b0adda14' and radio_metros = 10;
-- SKATEPARK · Perímetro sur: hoy r10 · foto n=101 a 52 m
-- update public.ronda_puntos set latitud = -32.9299425, longitud = -60.6602849, radio_metros = 30
--  where id = 'c3a8d75b-a70a-402a-aa7f-3e90934be2a9' and radio_metros = 10;
-- SKATEPARK · Portón estr: hoy r10 · foto n=66 a 60 m
-- update public.ronda_puntos set latitud = -32.9297608, longitud = -60.6597861, radio_metros = 30
--  where id = 'b8543b75-a0d2-4baf-8296-dc8164a30f1e' and radio_metros = 10;
-- ANTENA · Porton San Diego y Pileton sector este: HOY ESTÁN A 6 m UNO DEL OTRO
-- (posible copia de coordenadas). Foto n=40 → 35 m; n=59 → 34 m.
-- update public.ronda_puntos set latitud = -33.0191552, longitud = -60.6311575
--  where id = '940dd44d-2cf9-4f1a-bc97-c4eb7d0dd4f7';
-- update public.ronda_puntos set latitud = -33.018735, longitud = -60.6308095
--  where id = 'e0d5069d-c21e-4fcf-a273-a25b2cc692b9';
-- ANTENA · Porteria: coordenada correcta (foto a 9 m). Sin cambios.

-- ── Verificación ────────────────────────────────────────────────────────────
select a.created_at, rp.nombre, a.campo, a.valor_anterior, a.valor_nuevo, a.origen
  from public.ronda_puntos_auditoria a
  join public.ronda_puntos rp on rp.id = a.ronda_punto_id
 where a.created_at > now() - interval '5 minutes'
 order by a.created_at;

rollback;  -- cambiar a COMMIT sólo con autorización

-- Post-verificación (a los 7 días): % de visitas dentro del radio por punto.
-- Esperado nivel A/B: > 80 %. Ver anexo_sql.sql, consulta B1.
