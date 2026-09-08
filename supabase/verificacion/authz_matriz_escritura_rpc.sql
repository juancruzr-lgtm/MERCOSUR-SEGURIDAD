-- ============================================================================
-- MATRIZ DE AUTORIZACIÓN — enforcement de ESCRITURA (RPC) por persona
-- ============================================================================
-- Simula el contexto de auth de cada persona (set_config request.jwt.claims) y
-- llama cada RPC de escritura sobre un objetivo/turno DENTRO y FUERA de su zona,
-- clasificando el resultado de seguridad. Debe correr en UNA transacción que
-- termina en ROLLBACK: no modifica datos productivos. Correr contra producción
-- con las funciones de 20260908130000 ya aplicadas (o prependiendo esa migración
-- para probar antes de aplicar).
--
-- Esperado: Sergio (puesto supervisor) BLOQUEADO_SCOPE fuera de su zona y
-- NO_BLOQUEADO dentro; Aldo/Gerencia (alcance 'todas') NO_BLOQUEADO; vigilador
-- BLOQUEADO_ENTRY. Todas las filas => res = OK.
--
-- NOTA: los IDs de personas/objetivos/turnos son del padrón de producción al
-- 08/09/2026; actualizar si cambian. asignar_vigilador_turnos comparte el
-- mecanismo de loop de anular_turnos_lote; crear_turnos_programacion_parcial
-- comparte el gate top-level de publicar/crear_posicion.
-- ============================================================================
begin;
-- Clasifica un mensaje de error en el resultado de SEGURIDAD.
create or replace function pg_temp._clasif(msg text) returns text language sql immutable as $c$
  select case
    when msg ilike '%fuera de la zona%' or msg ilike '%fuera del alcance%' or msg ilike '%no pertenece a su zona%'
      then 'BLOQUEADO_SCOPE'
    when msg ilike '%No autorizado%' or msg ilike '%No autenticado%'
      then 'BLOQUEADO_ENTRY'
    else 'NO_BLOQUEADO'  -- pasó el gate (falló luego por params benignos, o sin error)
  end
$c$;

create temp table _authz(persona text, accion text, caso text, esperado text, obtenido text) on commit drop;

do $harness$
declare
  IN_OBJ   constant uuid := '0f0f4940-dcfa-4fd4-9d48-071429fa0da1';
  OUT_OBJ  constant uuid := 'cbe31d2c-d424-4228-b8d5-9dd8cd5fb7cf';
  IN_TUR   constant uuid := 'f0320bb5-d228-4389-afef-9e89bd87bf7a';
  OUT_TUR  constant uuid := '8f045840-d015-4cca-b9bb-ebc74b2cfadc';
  SERGIO   constant text := '{"sub":"67c2f633-b87c-432e-a372-7f842c923f30","role":"authenticated"}';
  ALDO     constant text := '{"sub":"d872e592-33c8-4f96-a5ef-64da0192c684","role":"authenticated"}';
  GERENCIA constant text := '{"sub":"c110bb0e-f0e4-42dd-af05-a1056f931d14","role":"authenticated"}';
  VIGILA   constant text := '{"sub":"680ccf43-c43e-4f9a-92db-be7173a8fe0a","role":"authenticated"}';
  FECHAS   constant jsonb := '["2026-12-15"]'::jsonb;
  v_ret text;
begin
  -- ===== PUBLICAR (programación) — gate top-level, matriz de personas =====
  perform set_config('request.jwt.claims', SERGIO, true);
  begin perform public.publicar_turnos_programacion(OUT_OBJ,'{}'::uuid[],null);
        insert into _authz values('Sergio','publicar','out_zone','BLOQUEADO_SCOPE','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','publicar','out_zone','BLOQUEADO_SCOPE',pg_temp._clasif(SQLERRM)); end;
  begin perform public.publicar_turnos_programacion(IN_OBJ,'{}'::uuid[],null);
        insert into _authz values('Sergio','publicar','in_zone','NO_BLOQUEADO','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','publicar','in_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;
  perform set_config('request.jwt.claims', ALDO, true);
  begin perform public.publicar_turnos_programacion(OUT_OBJ,'{}'::uuid[],null);
        insert into _authz values('Aldo','publicar','out_zone','NO_BLOQUEADO','NO_BLOQUEADO');
  exception when others then insert into _authz values('Aldo','publicar','out_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;
  perform set_config('request.jwt.claims', GERENCIA, true);
  begin perform public.publicar_turnos_programacion(OUT_OBJ,'{}'::uuid[],null);
        insert into _authz values('Gerencia','publicar','out_zone','NO_BLOQUEADO','NO_BLOQUEADO');
  exception when others then insert into _authz values('Gerencia','publicar','out_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;
  perform set_config('request.jwt.claims', VIGILA, true);
  begin perform public.publicar_turnos_programacion(IN_OBJ,'{}'::uuid[],null);
        insert into _authz values('Vigilador','publicar','in_zone','BLOQUEADO_ENTRY','NO_BLOQUEADO');
  exception when others then insert into _authz values('Vigilador','publicar','in_zone','BLOQUEADO_ENTRY',pg_temp._clasif(SQLERRM)); end;

  -- ===== CREAR_TURNOS_POSICION_OBJETIVO (gate top-level; params válidos) =====
  perform set_config('request.jwt.claims', SERGIO, true);
  begin perform public.crear_turnos_posicion_objetivo(gen_random_uuid(),OUT_OBJ,gen_random_uuid(),'00:00'::time,'01:00'::time,FECHAS,false,null);
        insert into _authz values('Sergio','crear_posicion','out_zone','BLOQUEADO_SCOPE','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','crear_posicion','out_zone','BLOQUEADO_SCOPE',pg_temp._clasif(SQLERRM)); end;
  begin perform public.crear_turnos_posicion_objetivo(gen_random_uuid(),IN_OBJ,gen_random_uuid(),'00:00'::time,'01:00'::time,FECHAS,false,null);
        insert into _authz values('Sergio','crear_posicion','in_zone','NO_BLOQUEADO','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','crear_posicion','in_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;

  -- ===== CERRAR_TURNO (gate top-level) =====
  perform set_config('request.jwt.claims', SERGIO, true);
  begin perform public.cerrar_turno(OUT_TUR, '[]'::jsonb, 'test');
        insert into _authz values('Sergio','cerrar','out_zone','BLOQUEADO_SCOPE','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','cerrar','out_zone','BLOQUEADO_SCOPE',pg_temp._clasif(SQLERRM)); end;
  begin perform public.cerrar_turno(IN_TUR, '[]'::jsonb, 'test');
        insert into _authz values('Sergio','cerrar','in_zone','NO_BLOQUEADO','NO_BLOQUEADO');
  exception when others then insert into _authz values('Sergio','cerrar','in_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;

  -- ===== ANULAR_TURNOS_LOTE (loop: el scope se ve en el jsonb de retorno) =====
  perform set_config('request.jwt.claims', SERGIO, true);
  begin
    v_ret := public.anular_turnos_lote(gen_random_uuid(), ARRAY[OUT_TUR]::uuid[], 'anular', 'test')::text;
    insert into _authz values('Sergio','anular','out_zone','BLOQUEADO_SCOPE',
      case when v_ret ilike '%fuera de la zona%' then 'BLOQUEADO_SCOPE' else 'NO_BLOQUEADO' end);
  exception when others then insert into _authz values('Sergio','anular','out_zone','BLOQUEADO_SCOPE',pg_temp._clasif(SQLERRM)); end;
  begin
    v_ret := public.anular_turnos_lote(gen_random_uuid(), ARRAY[IN_TUR]::uuid[], 'anular', 'test')::text;
    insert into _authz values('Sergio','anular','in_zone','NO_BLOQUEADO',
      case when v_ret ilike '%fuera de la zona%' then 'BLOQUEADO_SCOPE' else 'NO_BLOQUEADO' end);
  exception when others then insert into _authz values('Sergio','anular','in_zone','NO_BLOQUEADO',pg_temp._clasif(SQLERRM)); end;

  perform set_config('request.jwt.claims', null, true);
end
$harness$;

select persona, accion, caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FAIL' end as res
from _authz order by accion, persona, caso;
rollback;
