/*
================================================================================
Quitar la sobrecarga vieja pausar_ronda(uuid, text, timestamptz) — sin causa
================================================================================

QUÉ PASA EN PRODUCCIÓN (04/11/2026)
  Conviven dos funciones:
    pausar_ronda(uuid, text, timestamptz)        la de 20260802200000, SIN causa
    pausar_ronda(uuid, text, timestamptz, text)  la de 20260826170000, causa obligatoria
  20260826170000 creó la nueva y le revocó EXECUTE a la vieja para anon y
  authenticated, pero no la borró. Hoy la vieja sólo la pueden ejecutar
  postgres y service_role (proacl {postgres=X, service_role=X}).

POR QUÉ ES SEGURO BORRARLA
  * Código: lib/rondas.ts (pausarRonda) llama a la RPC SIEMPRE con los cuatro
    parámetros con nombre (p_ronda_base_id, p_motivo, p_hasta_at, p_causa);
    `causa` es obligatoria en la firma TypeScript. PostgREST resuelve por
    nombres de parámetro: con p_causa presente sólo calza la de 4 argumentos,
    aunque la causa venga vacía (una cadena vacía sigue siendo el parámetro
    p_causa, y la propia función la rechaza con contexto 'causa_invalida').
  * RondaAlertasPanel.tsx sólo menciona la RPC en comentarios y usa pausarRonda.
  * PWA / service worker (public/): ninguna referencia a pausar_ronda.
  * Otras funciones SQL vivas: ninguna llama a pausar_ronda (pg_proc.prosrc).
  * Cron: ningún job la invoca.
  * Permisos: un usuario de la app ya no puede ejecutarla (sin EXECUTE para
    authenticated). Sólo service_role podría, y ningún código de servidor la usa.
  Lo único que cambia: una llamada con tres parámetros que hoy recibe
  "permission denied" pasará a recibir "function not found". En ambos casos
  la pausa no se hace.

AVISO PARA 20261205120000 (otra fase)
  Si esa migración hace ALTER FUNCTION / REVOKE sobre la firma de 3 argumentos,
  tiene que condicionarlo con to_regprocedure(...) is not null, porque después
  de esta migración la firma ya no existe.

ROLLBACK
  supabase/rollback/20261205100100_quitar_pausar_ronda_sin_causa_rollback.sql
  (la recrea con el texto vivo exacto y los mismos permisos).
================================================================================
*/

begin;

do $do$
begin
  -- No dejar el sistema sin pausar_ronda: la de 4 argumentos tiene que existir.
  if to_regprocedure('public.pausar_ronda(uuid, text, timestamptz, text)') is null then
    raise exception 'falta pausar_ronda(uuid, text, timestamptz, text): no se borra la de 3 argumentos';
  end if;
end $do$;

drop function if exists public.pausar_ronda(uuid, text, timestamptz);

commit;
