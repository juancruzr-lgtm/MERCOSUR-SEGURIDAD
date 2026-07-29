-- ============================================================================
-- VERIFICACIÓN de 20260729190000_unificar_turno_vigente
-- ============================================================================
-- Ejecutar 1 y 2 ANTES de la migración; 3 a 7 DESPUÉS. Correr como `postgres`
-- (SQL Editor). Sólo el bloque 2 escribe: una tabla de baseline que el 7 elimina.

-- ── 1. PRE — Estado de partida: dos definiciones de la ventana ───────────────
-- Esperado: existe_turno_vigente = true
--           lectura_tiene_ventana_inline = true   (la copia que se va a eliminar)
--           lectura_delega = false
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'rondas_turno_vigente')      as existe_turno_vigente,
  (select p.prosrc like '%(t.fecha + t.hora_inicio) <= v_ahora%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obtener_rondas_guardia_actual')   as lectura_tiene_ventana_inline,
  (select p.prosrc like '%rondas_turno_vigente%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obtener_rondas_guardia_actual')   as lectura_delega;

-- ── 2. PRE — Baseline de la respuesta real, por impersonación ────────────────
-- Interroga a la función TAL COMO ESTÁ INSTALADA, una vez por vigilador activo,
-- fijando `request.jwt.claims` para que auth.uid() resuelva.
--
-- Es la única forma de validar lo desplegado: `rondas_turno_vigente()` depende de
-- auth.uid(), así que comparar copias del predicado ejecutadas como admin no
-- prueba nada sobre la función viva —dos textos idénticos siempre coinciden—.
--
-- NO ejecutar con sesión de vigilador: RLS filtraría `usuarios` y `turnos`, y el
-- resultado saldría vacío por falta de datos, no por equivalencia.
--
-- El baseline va a una tabla real porque tiene que sobrevivir a la migración.
--
-- Esperado: al menos un usuario en 'ok' o 'puesto_sin_rondas'. Si todos caen en
-- 'sin_turno_vigente' no hay nadie en turno y el baseline no cubre el camino que
-- importa: repetir en una franja con vigiladores activos.
drop table if exists public._verif_baseline_rondas;
create table public._verif_baseline_rondas (
  usuario_id uuid, auth_user_id uuid, contexto text,
  turno_id uuid, puesto_id uuid, cantidad_rondas int, payload jsonb
);

do $$
declare r record; v jsonb;
begin
  for r in select u.id, u.auth_user_id from public.usuarios u
            where u.estado = 'activo' and u.auth_user_id is not null loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    v := public.obtener_rondas_guardia_actual();
    insert into public._verif_baseline_rondas values (
      r.id, r.auth_user_id, v->>'contexto', (v->>'turno_id')::uuid,
      (v->>'puesto_id')::uuid, jsonb_array_length(coalesce(v->'rondas','[]'::jsonb)), v);
  end loop;
  perform set_config('request.jwt.claims', null, true);
end $$;

select contexto, count(*) as usuarios
  from public._verif_baseline_rondas
 group by 1 order by 2 desc;

-- ── 3. POST — La duplicación quedó eliminada ────────────────────────────────
-- Esperado: lectura_tiene_ventana_inline = false
--           lectura_delega = true
--           turno_vigente_intacta = true
select
  (select p.prosrc like '%(t.fecha + t.hora_inicio) <= v_ahora%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obtener_rondas_guardia_actual')   as lectura_tiene_ventana_inline,
  (select p.prosrc like '%rondas_turno_vigente%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'obtener_rondas_guardia_actual')   as lectura_delega,
  (select p.prosrc like '%(t.fecha + t.hora_inicio) <= v_ahora%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rondas_turno_vigente')            as turno_vigente_intacta;

-- ── 4. POST — Contrato de la función sin cambios ─────────────────────────────
-- Esperado, idéntico a antes de la migración:
--   provolatile = 's' (stable), prosecdef = true, tipo de retorno = jsonb,
--   ejecuta_authenticated = true, ejecuta_anon = false, ejecuta_public = false
select
  p.provolatile,
  p.prosecdef,
  pg_get_function_result(p.oid)                                        as retorno,
  has_function_privilege('authenticated', p.oid, 'execute')            as ejecuta_authenticated,
  has_function_privilege('anon',          p.oid, 'execute')            as ejecuta_anon,
  has_function_privilege('public',        p.oid, 'execute')            as ejecuta_public
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'obtener_rondas_guardia_actual';

-- ── 5. POST — Equivalencia de la respuesta contra el baseline ────────────────
-- Chequeo sustantivo de la migración: repite el recorrido del bloque 2 sobre la
-- función ya migrada y compara el JSON completo, rondas y puntos incluidos.
--
-- Esperado: 0 filas.
--
-- Correr cerca en el tiempo del bloque 2. Si entre ambas corridas un turno cruza
-- hora_inicio u hora_fin, el payload de ese vigilador cambia legítimamente; ante
-- una fila, descartar primero el cruce de borde antes de tratarlo como regresión.
create temp table _post_rondas (usuario_id uuid, contexto text, payload jsonb);

do $$
declare r record; v jsonb;
begin
  for r in select usuario_id, auth_user_id from public._verif_baseline_rondas loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    v := public.obtener_rondas_guardia_actual();
    insert into _post_rondas values (r.usuario_id, v->>'contexto', v);
  end loop;
  perform set_config('request.jwt.claims', null, true);
end $$;

select b.usuario_id,
       b.contexto as contexto_antes, p.contexto as contexto_despues,
       b.payload  as payload_antes,  p.payload  as payload_despues
  from public._verif_baseline_rondas b
  join _post_rondas p on p.usuario_id = b.usuario_id
 where b.payload is distinct from p.payload;

-- ── 6. POST — Humo sin sesión ───────────────────────────────────────────────
-- Sin JWT, auth.uid() es null y la identidad no resuelve. Esperado: 'sin_usuario'
-- (mismo valor que devolvía antes: la resolución de identidad no se movió).
select public.obtener_rondas_guardia_actual() -> 'contexto' as contexto_sin_sesion;

-- ── 7. Limpieza ─────────────────────────────────────────────────────────────
drop table if exists public._verif_baseline_rondas;
