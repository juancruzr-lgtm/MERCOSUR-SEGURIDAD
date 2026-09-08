-- ============================================================================
-- BACKFILL PUESTO_ORGANIZACIONAL — ROLES 1 (asignación productiva inicial)
-- ============================================================================
-- POR QUÉ
--   La migración 20260908100000 agregó usuarios.puesto_organizacional NULLABLE
--   sin tocar ninguna fila. Este backfill asigna el puesto canónico al padrón
--   productivo vigente para que capacidades/alcance dejen de depender del
--   fallback por `rol` viejo. Es transitorio y de una sola vez.
--
-- CÓMO IDENTIFICA
--   · Individuos de liderazgo/administración: por usuario_id (UUID) inequívoco.
--     NO por nombre ni por legajo (el legajo tiene rarezas: 'romero ' con
--     espacio, 'joel adm', 'adm 2') que ya causaron un match fallido.
--   · Vigiladores (64): por REGLA, no por nombre — estado activo + rol
--     guardia/vigilador + es_prueba=false + puesto aún null.
--
-- QUÉ NO TOCA
--   · NO cambia usuarios.rol (Sergio/Rodolfo/Facundo/Juan Cruz conservan admin;
--     Aldo conserva supervisor). Sólo escribe puesto_organizacional.
--   · NO toca cuentas es_prueba=true (Facundo 'adm 2', Supervisor Prueba) ni
--     inactivos: quedan puesto_organizacional = null a propósito.
--
-- GUARDAS / IDEMPOTENCIA
--   · Cada UPDATE lleva `puesto_organizacional is null`: re-ejecutar es no-op y
--     nunca pisa un puesto ya asignado.
--
-- ESTADO ESPERADO POST (entre estado='activo', total 78):
--   gerencia 2 · direccion_operativa 1 · jefe_supervisores 1 · supervisor 5 ·
--   administracion 3 · vigilador 64 · null 2 (ambos es_prueba).
--
-- ROLLBACK: supabase/rollback/20260908110000_backfill_puesto_organizacional_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260908110000_backfill_puesto_organizacional_pre_post.sql
-- ============================================================================

begin;

-- GERENCIA (económico/gerencial). Juan Cruz Romero + Facundo Romero (ADM001).
update public.usuarios set puesto_organizacional = 'gerencia'
where puesto_organizacional is null and id in (
  '3a8e3c04-f4f5-48c4-8830-73edccb73667',  -- juan cruz romero (legajo 'romero ')
  '5a8e3f70-77ef-4f89-8332-b9878f32a293'   -- Facundo Romero (ADM001)
);

-- DIRECCIÓN OPERATIVA (operativo global, SIN económico). Rodolfo Romero.
update public.usuarios set puesto_organizacional = 'direccion_operativa'
where puesto_organizacional is null and id = '3731aa27-ce78-4817-8faa-66ad1edfabaa';

-- JEFE DE SUPERVISORES (alcance todas, sin zona ficticia). Aldo Monzón.
update public.usuarios set puesto_organizacional = 'jefe_supervisores'
where puesto_organizacional is null and id = '023769de-9e99-481a-9caa-c604ef56b14b';

-- SUPERVISORES (alcance = zonas asignadas). Sergio conserva rol='admin'.
update public.usuarios set puesto_organizacional = 'supervisor'
where puesto_organizacional is null and id in (
  '7a401cb9-dbbc-45e6-9781-bbde62a66120',  -- CARLOS ACOSTA (S-004, Reconquista)
  '251289de-c16c-4315-969c-c8ee574ff7c1',  -- SABINO ARANDA (Rosario)
  '0376b452-18c8-4ab3-a500-ecef810300aa',  -- WALTER DARIO FULLA (Rosario)
  '69493cc2-15d6-4618-893e-4a9b1d044df8',  -- SERGIO MARTINEZ (rol admin intacto, Rosario)
  'a4084933-c7a8-41bf-9767-2148eb5833bb'   -- CRISTIAN WILHJELM (Rafaela)
);

-- ADMINISTRACIÓN (rama distinta de operación; SIN económico/salarial).
update public.usuarios set puesto_organizacional = 'administracion'
where puesto_organizacional is null and id in (
  'a2cd1908-7e9d-4bf4-8407-ecf644e1f351',  -- joel juarez
  '1384746c-0520-4ebe-8d7b-17788d833cba',  -- Laura M (ADM002)
  'eecd4b5c-095d-4062-be10-25e78ea9f499'   -- Andrea Narvarte (ADM003)
);

-- VIGILADORES (64) — por regla, nunca por nombre.
update public.usuarios set puesto_organizacional = 'vigilador'
where puesto_organizacional is null
  and estado = 'activo'
  and rol in ('guardia', 'vigilador')
  and es_prueba = false;

commit;
