-- ============================================================================
-- VERIFICACIÓN de 20260729200000_rondas_lectura_politica_foto
-- ============================================================================
-- Ejecutar 1 a 3 ANTES de la migración; 4 a 7 DESPUÉS. Correr como `postgres`
-- (SQL Editor). Sólo el bloque 3 escribe: una tabla de baseline que el 7 elimina.
--
-- NO ejecutar con sesión de vigilador: RLS filtraría `usuarios`, `turnos` y
-- `ronda_puntos`, y los resultados saldrían vacíos por falta de datos.

-- ── 1. PRE — Compatibilidad de datos: la columna y sus valores ───────────────
-- La migración expone `ronda_puntos.politica_foto` tal cual está. Si hubiera
-- nulos o valores fuera del dominio, el JSON los propagaría al cliente.
--
-- Esperado: existe_columna = true, invalidos = 0, nulos_activos = 0.
select
  exists(
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ronda_puntos'
       and column_name = 'politica_foto'
  )                                                                       as existe_columna,
  count(*) filter (
    where rp.politica_foto is not null
      and rp.politica_foto not in ('obligatoria', 'opcional', 'solo_novedad')
  )                                                                       as invalidos,
  count(*) filter (where rp.activo and rp.politica_foto is null)          as nulos_activos,
  count(*) filter (where rp.activo)                                       as puntos_activos
from public.ronda_puntos rp;

-- ── 2. PRE — Coherencia de `requiere_foto` con la política ──────────────────
-- `foto_requerida` es derivada de `politica_foto` por trigger. La migración NO la
-- toca y la sigue enviando: este bloque documenta que hoy son coherentes, así una
-- diferencia posterior no se atribuye a este cambio.
--
-- Esperado: 0 filas.
select rp.id, rp.nombre, rp.politica_foto, rp.foto_requerida
from public.ronda_puntos rp
where rp.activo
  and rp.foto_requerida is distinct from (rp.politica_foto = 'obligatoria');

-- ── 3. PRE — Baseline de la respuesta real, por impersonación ────────────────
-- Interroga a la función tal como está instalada, una vez por vigilador activo.
-- El baseline va a una tabla real porque tiene que sobrevivir a la migración.
--
-- Esperado: al menos un usuario en 'ok'. Sin eso, el bloque 5 no compara ningún
-- punto y la verificación no prueba nada: repetir en una franja con vigiladores
-- en turno sobre un puesto con rondas configuradas.
drop table if exists public._verif_baseline_politica_foto;
create table public._verif_baseline_politica_foto (
  usuario_id uuid, auth_user_id uuid, contexto text, payload jsonb
);

do $$
declare r record; v jsonb;
begin
  for r in select u.id, u.auth_user_id from public.usuarios u
            where u.estado = 'activo' and u.auth_user_id is not null loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    v := public.obtener_rondas_guardia_actual();
    insert into public._verif_baseline_politica_foto values (r.id, r.auth_user_id, v->>'contexto', v);
  end loop;
  perform set_config('request.jwt.claims', null, true);
end $$;

select contexto, count(*) as usuarios
  from public._verif_baseline_politica_foto
 group by 1 order by 2 desc;

-- ── 4. POST — Contrato de la función sin cambios ─────────────────────────────
-- Esperado, idéntico a antes: provolatile = 's', prosecdef = true,
-- retorno = jsonb, authenticated = true, anon = false, public = false.
-- Y delega_turno_vigente = true: la migración no reintrodujo la ventana inline.
select
  p.provolatile,
  p.prosecdef,
  pg_get_function_result(p.oid)                                  as retorno,
  has_function_privilege('authenticated', p.oid, 'execute')      as ejecuta_authenticated,
  has_function_privilege('anon',          p.oid, 'execute')      as ejecuta_anon,
  has_function_privilege('public',        p.oid, 'execute')      as ejecuta_public,
  p.prosrc like '%rondas_turno_vigente%'                         as delega_turno_vigente,
  p.prosrc like '%(t.fecha + t.hora_inicio) <= v_ahora%'         as ventana_inline_debe_ser_false
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'obtener_rondas_guardia_actual';

-- ── 5. POST — Compatibilidad: el payload sólo GANA la clave nueva ────────────
-- Chequeo sustantivo. Repite el recorrido del bloque 3 y compara los payloads
-- después de borrar `politica_foto` de cada punto: si el cambio fue realmente
-- aditivo, lo demás queda idéntico, `requiere_foto` incluido.
--
-- Esperado: 0 filas.
--
-- Correr cerca en el tiempo del bloque 3: si entre ambas corridas un turno cruza
-- hora_inicio u hora_fin, o el supervisor edita una ronda, el payload cambia
-- legítimamente. Ante una fila, descartar eso antes de tratarlo como regresión.
create temp table _post_politica_foto (usuario_id uuid, contexto text, payload jsonb);

do $$
declare r record; v jsonb;
begin
  for r in select usuario_id, auth_user_id from public._verif_baseline_politica_foto loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    v := public.obtener_rondas_guardia_actual();
    insert into _post_politica_foto values (r.usuario_id, v->>'contexto', v);
  end loop;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- Quita 'politica_foto' de todos los puntos de todas las rondas del payload.
create or replace function pg_temp.sin_politica_foto(p jsonb)
returns jsonb language sql immutable as $fn$
  select case
    when p -> 'rondas' is null or jsonb_typeof(p -> 'rondas') <> 'array' then p
    else jsonb_set(p, '{rondas}', (
      select coalesce(jsonb_agg(
        case
          when r -> 'puntos' is null or jsonb_typeof(r -> 'puntos') <> 'array' then r
          else jsonb_set(r, '{puntos}', (
            select coalesce(jsonb_agg(pt - 'politica_foto' order by pt ->> 'orden'), '[]'::jsonb)
            from jsonb_array_elements(r -> 'puntos') pt
          ))
        end
        order by r ->> 'ronda_nombre'
      ), '[]'::jsonb)
      from jsonb_array_elements(p -> 'rondas') r
    ))
  end;
$fn$;

select b.usuario_id, b.contexto as antes, p.contexto as despues,
       b.payload as payload_antes, p.payload as payload_despues
from public._verif_baseline_politica_foto b
join _post_politica_foto p on p.usuario_id = b.usuario_id
where pg_temp.sin_politica_foto(b.payload) is distinct from pg_temp.sin_politica_foto(p.payload);

-- ── 6. POST — La clave nueva llega y es válida en todos los puntos ───────────
-- Esperado: puntos_sin_clave = 0, puntos_invalidos = 0, puntos_totales > 0.
-- Si puntos_totales = 0, ningún vigilador en turno tenía puntos: repetir.
with puntos as (
  select pt
  from _post_politica_foto p,
       jsonb_array_elements(coalesce(p.payload -> 'rondas', '[]'::jsonb)) r,
       jsonb_array_elements(coalesce(r -> 'puntos', '[]'::jsonb)) pt
)
select
  count(*)                                                             as puntos_totales,
  count(*) filter (where not (pt ? 'politica_foto'))                   as puntos_sin_clave,
  count(*) filter (
    where pt ->> 'politica_foto' is null
       or pt ->> 'politica_foto' not in ('obligatoria', 'opcional', 'solo_novedad')
  )                                                                    as puntos_invalidos
from puntos;

-- ── 7. Limpieza ─────────────────────────────────────────────────────────────
drop table if exists public._verif_baseline_politica_foto;
