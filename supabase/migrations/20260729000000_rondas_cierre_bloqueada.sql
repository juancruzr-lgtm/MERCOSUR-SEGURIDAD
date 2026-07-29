/*
================================================================================
C3 MÍNIMO — Cierre administrativo de una ronda bloqueada
================================================================================

PROBLEMA QUE RESUELVE
  `registrar_punto_ronda` exige secuencia estricta y foto obligatoria. Si un
  punto es físicamente inalcanzable —portón cerrado, obra, GPS que no fija en un
  sótano, cámara rota— la ejecución queda `en_curso` para siempre. Y como el
  índice parcial `(turno_id, guardia_id) where estado = 'en_curso'` sólo admite
  una ejecución abierta por guardia y turno, ese vigilador no puede ejecutar
  NINGUNA otra ronda de ese puesto durante el resto del turno.

  Hasta hoy la única salida era un UPDATE manual en la base.

QUÉ HACE
  Una RPC que permite a un admin —o al supervisor de la zona del objetivo—
  cerrar esa ejecución dejando constancia de quién la cerró, cuándo y por qué.

QUÉ NO HACE
  No registra puntos, no reabre ejecuciones, no cancela, no toca asistencia,
  turnos, liquidables, evidencias ni Storage. No modifica
  `rondas_ejecucion_json()`, `iniciar_ronda()` ni `registrar_punto_ronda()`:
  el contrato del vigilador queda intacto.

DECISIONES DE MODELO

  1. Estado resultante: `finalizada` + `incompleta`.

     No es una preferencia: `ronda_ejecuciones_resultado_coherente` exige
     `(estado = 'finalizada') = (resultado is not null)`, así que `cancelada`
     con `resultado = 'incompleta'` es imposible por constraint. Y `cancelada`
     con `resultado` null perdería la información de que la ronda quedó a medias.

     Consecuencia asumida y mitigada: un cierre administrativo queda con el
     mismo par (estado, resultado) que una ronda que el vigilador terminó con
     puntos incumplidos. Lo que los distingue es `cerrada_por is not null`.
     Todo listado o reporte que cuente "rondas incompletas" DEBE filtrar por esa
     columna, o va a imputarle al vigilador un cierre que decidió su supervisor.

  2. Puntos pendientes: `omitido` con `registrado_at = now()`.

     `ronda_ejecucion_puntos_registro_coherente` exige
     `(estado = 'pendiente') = (registrado_at is null)`, de modo que un punto
     omitido necesariamente lleva sello temporal. Ese sello es el del cierre, no
     el de una visita: `gps_ok`, `dentro_radio`, `foto_ok` y `distancia_metros`
     quedan en null, que es lo que lo separa de un `incumplido` real.

  3. Los puntos ya resueltos no se tocan. El UPDATE filtra por
     `estado = 'pendiente'`: fotos, GPS, distancias, veredictos y snapshots de
     los puntos cumplidos o incumplidos quedan exactamente como estaban.

  4. Idempotencia. Un reintento sobre una ejecución ya cerrada devuelve
     `ya_cerrada` con los datos del cierre original, sin escribir nada y sin
     pisar `cerrada_por` ni `cerrada_at`.

  5. El índice de ronda abierta se libera solo: es parcial sobre
     `estado = 'en_curso'`, y al pasar a `finalizada` la entrada desaparece.

ROLLBACK
  supabase/rollback/20260729000000_rondas_cierre_bloqueada_rollback.sql
================================================================================
*/

begin;

-- ── Columnas de auditoría del cierre administrativo ─────────────────────────

alter table public.ronda_ejecuciones
  add column cerrada_por    uuid        null references public.usuarios(id) on delete restrict,
  add column cerrada_at     timestamptz null,
  add column cerrada_motivo text        null;

-- Las tres viajan juntas o ninguna: un cierre sin autor, sin hora o sin motivo
-- no es auditable, y media auditoría es peor que ninguna porque parece completa.
alter table public.ronda_ejecuciones
  add constraint ronda_ejecuciones_cierre_admin_completo
    check (num_nonnulls(cerrada_por, cerrada_at, cerrada_motivo) in (0, 3));

-- Un motivo de menos de 10 caracteres no explica nada. El mínimo es deliberado:
-- "ok", "cerrar" o "-" no sirven ante un reclamo del cliente.
alter table public.ronda_ejecuciones
  add constraint ronda_ejecuciones_cierre_admin_motivo_util
    check (cerrada_motivo is null or length(btrim(cerrada_motivo)) >= 10);

-- El cierre administrativo sólo existe sobre una ejecución finalizada.
alter table public.ronda_ejecuciones
  add constraint ronda_ejecuciones_cierre_admin_estado
    check (cerrada_por is null or estado = 'finalizada');

comment on column public.ronda_ejecuciones.cerrada_por is
  'Usuario admin/supervisor que cerró administrativamente una ronda bloqueada. '
  'null = la ronda la cerró el propio vigilador al resolver su último punto. '
  'Los reportes de cumplimiento deben filtrar por esta columna: un cierre '
  'administrativo no es una ronda incompleta del vigilador.';

comment on column public.ronda_ejecuciones.cerrada_motivo is
  'Motivo operativo del cierre, obligatorio y de al menos 10 caracteres. Es la '
  'única explicación de por qué quedaron puntos omitidos.';

-- Sostiene los listados de cierres administrativos sin penalizar la tabla:
-- indexa sólo las filas cerradas a mano, que son la excepción.
create index idx_ronda_ejecuciones_cierre_admin
  on public.ronda_ejecuciones (objetivo_id, cerrada_at desc)
  where cerrada_por is not null;

-- ── Lectura: ejecuciones en curso de un objetivo ────────────────────────────
-- Mínimo indispensable para que el supervisor pueda decidir. No es la vista de
-- la Etapa 3.3: no hay historial, ni evidencias, ni detalle por punto.

create or replace function public.listar_ejecuciones_en_curso_objetivo(p_objetivo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ahora timestamp;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecuciones', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'ejecuciones', jsonb_build_array());
  end if;

  v_ahora := (now() at time zone 'America/Argentina/Buenos_Aires');

  return jsonb_build_object(
    'contexto', 'ok',
    'ejecuciones', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',               e.id,
          'ronda_nombre',     e.snap_ronda_nombre,
          'guardia_nombre',   u.apellido || ', ' || u.nombre,
          'puesto_nombre',    p.nombre,
          'fecha_operativa',  e.fecha_operativa,
          'iniciada_at',      e.iniciada_at,
          'puntos_total',     e.puntos_total,
          'puntos_pendientes', (
            select count(*) from public.ronda_ejecucion_puntos ep
             where ep.ronda_ejecucion_id = e.id and ep.estado = 'pendiente'
          ),
          -- Una ejecución cuya ventana de turno ya terminó está abandonada, no
          -- en progreso. Es el dato que justifica cerrarla.
          'turno_vencido', v_ahora >= (
            t.fecha + t.hora_fin
            + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end
          )
        ) order by e.iniciada_at
      )
      from public.ronda_ejecuciones e
      join public.turnos   t on t.id = e.turno_id
      join public.usuarios u on u.id = e.guardia_id
      join public.puestos  p on p.id = e.puesto_id
      where e.objetivo_id = p_objetivo_id
        and e.estado = 'en_curso'
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_ejecuciones_en_curso_objetivo(uuid) from public;
revoke all on function public.listar_ejecuciones_en_curso_objetivo(uuid) from anon;
grant execute on function public.listar_ejecuciones_en_curso_objetivo(uuid) to authenticated;

-- ── Escritura: cerrar una ronda bloqueada ───────────────────────────────────

create or replace function public.cerrar_ronda_bloqueada(
  p_ejecucion_id uuid,
  p_motivo       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id  uuid;
  v_ejecucion   record;
  v_motivo      text;
  v_omitidos    integer := 0;
  v_conservados integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select u.id into v_usuario_id
    from public.usuarios u
   where u.auth_user_id = auth.uid()
     and u.estado = 'activo'
   limit 1;

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecucion', null);
  end if;

  if p_ejecucion_id is null then
    return jsonb_build_object('contexto', 'ejecucion_no_encontrada', 'ejecucion', null);
  end if;

  -- El lock serializa dos supervisores cerrando la misma ejecución a la vez: el
  -- segundo espera y encuentra el cierre del primero, en lugar de pisarlo.
  select e.* into v_ejecucion
    from public.ronda_ejecuciones e
   where e.id = p_ejecucion_id
     for update;

  if not found then
    return jsonb_build_object('contexto', 'ejecucion_no_encontrada', 'ejecucion', null);
  end if;

  -- Autorización sobre el objetivo real de la ejecución, no sobre uno que el
  -- cliente pueda sugerir. Misma regla que el resto del módulo de rondas.
  if not public.puede_administrar_rondas_objetivo(v_ejecucion.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'ejecucion', null);
  end if;

  -- Idempotencia: un reintento sobre una ejecución ya cerrada a mano devuelve
  -- el cierre original intacto. No se pisa autor, hora ni motivo.
  if v_ejecucion.cerrada_por is not null then
    return jsonb_build_object(
      'contexto', 'ya_cerrada',
      'ejecucion', jsonb_build_object(
        'id',             v_ejecucion.id,
        'estado',         v_ejecucion.estado,
        'resultado',      v_ejecucion.resultado,
        'cerrada_at',     v_ejecucion.cerrada_at,
        'cerrada_motivo', v_ejecucion.cerrada_motivo
      )
    );
  end if;

  -- Una ronda que el vigilador terminó por sus propios medios no está
  -- bloqueada. Cerrarla a mano sería reescribir un resultado legítimo.
  if v_ejecucion.estado <> 'en_curso' then
    return jsonb_build_object('contexto', 'ejecucion_no_bloqueada', 'ejecucion', null);
  end if;

  v_motivo := btrim(coalesce(p_motivo, ''));
  if length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_invalido', 'ejecucion', null);
  end if;

  -- Sólo los pendientes. Los puntos ya resueltos conservan estado, veredicto,
  -- GPS, distancia, foto y snapshot sin ninguna modificación.
  update public.ronda_ejecucion_puntos
     set estado        = 'omitido',
         registrado_at = now()
   where ronda_ejecucion_id = v_ejecucion.id
     and estado = 'pendiente';

  get diagnostics v_omitidos = row_count;

  select count(*) into v_conservados
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion.id
     and ep.estado <> 'omitido';

  update public.ronda_ejecuciones
     set estado         = 'finalizada',
         resultado      = 'incompleta',
         finalizada_at  = now(),
         cerrada_por    = v_usuario_id,
         cerrada_at     = now(),
         cerrada_motivo = v_motivo
   where id = v_ejecucion.id
     and estado = 'en_curso';

  return jsonb_build_object(
    'contexto', 'cerrada',
    'ejecucion', jsonb_build_object(
      'id',                v_ejecucion.id,
      'estado',            'finalizada',
      'resultado',         'incompleta',
      'puntos_omitidos',   v_omitidos,
      'puntos_conservados', v_conservados,
      'cerrada_motivo',    v_motivo
    )
  );
end;
$$;

revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from public;
revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from anon;
grant execute on function public.cerrar_ronda_bloqueada(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
