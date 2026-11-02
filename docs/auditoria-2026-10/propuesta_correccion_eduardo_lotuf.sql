-- ============================================================================
-- PROPUESTA — NO EJECUTAR SIN AUTORIZACIÓN EXPRESA DE GERENCIA.
-- Termina en ROLLBACK: correrla tal cual sólo muestra el antes y el después.
-- Para aplicarla, quien autorice reemplaza el ROLLBACK final por COMMIT y
-- completa v_autoriza (usuarios.id de quien autoriza) y el motivo.
-- ============================================================================
--
-- Caso: Eduardo Martínez, 29/10/2026, Polideportivo Lotuf 15:00–23:00.
-- Diagnóstico: docs/auditoria-2026-10/turnos_cobertura_liquidacion.md
--
-- Hechos verificados en producción (02/11/2026, solo lectura):
--   · turno 2aeb0d2c… (Eduardo, Lotuf 15–23, planificado 01/10) quedó
--     'cubierto' por una intervención confirmar_asistencia (b45869ac…) del
--     30/10 09:43 AR, de joel juarez (admin), comentario "Si confirmado",
--     confirmacion_reforzada=false. Creó el registro aae7b773… carga_manual,
--     origen confirmacion_supervisor, 8,00 h liquidables, SIN hora de entrada
--     ni salida, SIN GPS, SIN fotos, SIN rondas, SIN actividad de la app de
--     Eduardo en ese turno.
--   · turno e8adb5de… (Nicolás González, mismo puesto df1d2e40…, 15–23)
--     creado el 29/10 15:05 AR por alta directa (sin auditoría), con fichaje
--     15:06:37–23:14:10, fotos de libro y uniforme, ingreso revisado por el
--     supervisor (SABINO ARANDA) con foto. → 8 h liquidables.
--   · turno d31d5b6e… (Eduardo, SRT 07–15): fichaje 06:30:38–15:00:00 dentro
--     de radio, fotos de ingreso → 8 h liquidables (la regla liquida la
--     duración programada; las 8,5 h son tiempo fichado, no liquidable).
--   El intervalo Lotuf 15–23 del 29/10 se liquida hoy DOS veces (16 h).
--
-- Qué hace:
--   1. Anula la cobertura manual sin evidencia de Eduardo en Lotuf (horas 0),
--      CONSERVANDO el registro y su historial (mismos campos que
--      anular_cobertura_manual_operativa; esa RPC no sirve acá porque sólo
--      acepta coberturas 'confirmacion_admin' de confirmar_cubierto).
--   2. Pasa el turno de Eduardo en Lotuf a 'reemplazado' (la obligación la
--      cubrió el turno de González): deja de generar obligación y alertas.
--      guardia_original_id sigue siendo Eduardo (el turno sigue visible en su
--      historial). Alternativa (decisión de Gerencia): 'ausente' + registro
--      de ausencia — ver bloque comentado al final; afecta presentismo.
--   3. Deja constancia en registros_asistencia_auditoria, turnos_auditoria y
--      supervisor_intervenciones (accion 'anulacion_cobertura').
--   4. Si la migración 20261121120000 ya está aplicada, vincula el turno de
--      González con reemplaza_turno_id.
-- No toca: el registro de SRT de Eduardo, el turno ni el registro de
-- González, ni ninguna tabla de liquidación.
--
-- Períodos de liquidación que toca: sólo OCTUBRE 2026 (turno del 29/10, día
-- de inicio). liquidacion_periodo 2026-10 (0ec5a950…) está en 'borrador': sin
-- consolidar, sin exportar, sin envío a Visual, sin días cargados ni ajustes
-- (verificado 02/11/2026). Las horas se calculan en vivo, así que el cambio se
-- refleja al recalcular el borrador. No hay liquidación cerrada que tocar; la
-- precondición de abajo aborta si eso cambió. Eduardo no tiene liquidación
-- final. Su aceptación de planilla del 30/10 (8 h) queda como historial.

begin;

create temp table _p on commit drop as
select
  '2aeb0d2c-f203-4e1e-85d1-474a8dfba353'::uuid as turno_lotuf_edu,
  'aae7b773-617f-410f-b998-4f6df8e67f53'::uuid as registro_confirmacion,
  'b45869ac-5dad-4e5d-a476-1f903ab94f96'::uuid as intervencion_confirmacion,
  'e8adb5de-9270-4316-ba38-8f1ac76b1f9a'::uuid as turno_lotuf_nico,
  'e980a238-ce75-43af-a8d7-4dd0678144b8'::uuid as registro_nico,
  'd31d5b6e-85cc-4825-8b5a-bba850fbefdd'::uuid as turno_srt_edu,
  '0936940e-ed15-4dd2-a802-620c1c5b4c84'::uuid as registro_srt_edu,
  '6df6bdb1-5625-4e53-a247-a2c4ae843933'::uuid as eduardo,
  '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4'::uuid as nicolas,
  '0ec5a950-b9ab-4d7f-998a-b3ef9f5dd49e'::uuid as periodo_octubre,
  -- COMPLETAR antes de aplicar:
  null::uuid as autoriza,  -- usuarios.id de quien autoriza (admin/gerencia)
  'Auditoría 10/2026: confirmación de 8 h sin fichaje ni evidencia; el puesto lo cubrió Nicolás González (fichaje 15:06–23:14 y fotos). Se anula para no liquidar dos veces el mismo intervalo.'::text as motivo;

-- ── ANTES ──────────────────────────────────────────────────────────────────
select 'ANTES' as momento, t.id as turno_id, o.nombre as objetivo, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
       u.apellido as vigilador, r.id as registro_id, r.tipo_registro, r.origen_cobertura,
       r.hora_entrada_real, r.hora_salida_real, r.horas_trabajadas, r.horas_liquidables, r.cobertura_anulada_at
from _p
join public.turnos t on t.id in (_p.turno_lotuf_edu, _p.turno_lotuf_nico, _p.turno_srt_edu)
join public.objetivos o on o.id = t.objetivo_id
left join public.usuarios u on u.id = coalesce(t.guardia_id, t.guardia_original_id)
left join public.registros_asistencia r on r.turno_id = t.id
order by t.fecha, t.hora_inicio, u.apellido;

-- Horas liquidables del 29/10 por vigilador ANTES (esperado hoy: Eduardo 16, González 8).
select 'ANTES' as momento, u.apellido, t.fecha,
       sum(case
             when coalesce(t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then 0
             when r.cobertura_anulada_at is not null then 0
             when r.horas_liquidables is not null then round(r.horas_liquidables * 2) / 2
             when r.hora_entrada_real is not null and r.hora_salida_real is not null
               then public.calcular_horas_liquidables(t.hora_inicio, t.hora_fin, t.hora_inicio, t.hora_fin)
             else 0 end) as horas_liquidables_29_10
from _p
join public.turnos t on t.fecha = '2026-10-29' and coalesce(t.guardia_id, t.guardia_original_id) in (_p.eduardo, _p.nicolas)
join public.usuarios u on u.id = coalesce(t.guardia_id, t.guardia_original_id)
left join public.registros_asistencia r on r.turno_id = t.id and coalesce(r.tipo_registro, '') <> 'ausencia'
group by 1, u.apellido, t.fecha
order by 2;

-- ── Precondiciones: si algo cambió desde la auditoría, no se aplica ───────
do $$
declare p record;
begin
  select * into p from _p;
  if p.autoriza is null then
    raise notice 'autoriza sin completar: la propuesta corre igual para mostrar el después, pero NO debe aplicarse así';
  elsif not exists (select 1 from public.usuarios u where u.id = p.autoriza and u.estado = 'activo'
                    and (u.puesto_organizacional in ('administracion', 'gerencia', 'direccion_operativa', 'jefe_supervisores')
                         or (u.puesto_organizacional is null and lower(u.rol) = 'admin'))) then
    raise exception 'autoriza no es un usuario activo con rol para autorizar';
  end if;
  if not exists (select 1 from public.registros_asistencia r where r.id = p.registro_confirmacion
                 and r.turno_id = p.turno_lotuf_edu and r.guardia_id = p.eduardo and r.tipo_registro = 'carga_manual'
                 and r.origen_cobertura = 'confirmacion_supervisor' and r.horas_liquidables = 8.00
                 and r.hora_entrada_real is null and r.cobertura_anulada_at is null and r.registro_anulado_at is null) then
    raise exception 'El registro de confirmación ya no está como en la auditoría: revisar antes de corregir';
  end if;
  if exists (select 1 from public.evidencias e where e.turno_id = p.turno_lotuf_edu)
     or exists (select 1 from public.ronda_ejecuciones x where x.turno_id = p.turno_lotuf_edu) then
    raise exception 'Apareció evidencia en el turno de Eduardo en Lotuf: revisar antes de corregir';
  end if;
  if not exists (select 1 from public.registros_asistencia r where r.id = p.registro_nico and r.turno_id = p.turno_lotuf_nico
                 and r.hora_entrada_real = '15:06:37' and r.hora_salida_real = '23:14:10' and r.cobertura_anulada_at is null) then
    raise exception 'El fichaje de González cambió: revisar antes de corregir';
  end if;
  if not exists (select 1 from public.liquidacion_periodo lp where lp.id = p.periodo_octubre and lp.mes = '2026-10'
                 and lp.estado = 'borrador' and lp.cerrado_at is null and lp.consolidado_at is null and lp.exportada_at is null) then
    raise exception 'La liquidación de octubre ya no está en borrador: NO corregir sin decisión de Gerencia';
  end if;
  if exists (select 1 from public.liquidacion_periodo lp where lp.mes = '2026-10' and lp.id <> p.periodo_octubre
             and lp.estado not in ('anulado')) then
    raise exception 'Hay otro período de octubre vigente: revisar';
  end if;
end $$;

-- ── 1. Anular la cobertura manual sin evidencia (se conserva el registro) ──
update public.registros_asistencia r
   set horas_liquidables_antes_anulacion = r.horas_liquidables,
       horas_liquidables = 0,
       cobertura_anulada_at = clock_timestamp(),
       cobertura_anulada_por = _p.autoriza,
       cobertura_anulada_motivo = _p.motivo,
       cobertura_intervencion_origen_id = _p.intervencion_confirmacion
  from _p
 where r.id = _p.registro_confirmacion
   and r.cobertura_anulada_at is null;

insert into public.registros_asistencia_auditoria (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
select _p.registro_confirmacion, _p.turno_lotuf_edu, _p.autoriza, x.campo, x.antes, x.despues, _p.motivo
from _p, (values ('horas_liquidables', '8.00', '0'), ('cobertura_anulada_at', null, clock_timestamp()::text)) x(campo, antes, despues);

-- ── 2. El turno de Eduardo en Lotuf pasa a 'reemplazado' ──────────────────
insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
select t.id, _p.autoriza, x.campo, x.antes, x.despues, _p.motivo
from _p join public.turnos t on t.id = _p.turno_lotuf_edu,
     lateral (values ('estado', t.estado, 'reemplazado'), ('guardia_id', t.guardia_id::text, null)) x(campo, antes, despues);

update public.turnos t
   set estado = 'reemplazado',
       guardia_original_id = coalesce(t.guardia_original_id, t.guardia_id),
       guardia_id = null,
       motivo_reemplazo = 'Cubierto por Nicolás González (turno e8adb5de…); auditoría 10/2026'
  from _p
 where t.id = _p.turno_lotuf_edu;

-- ── 3. Constancia en Revisión Operativa ───────────────────────────────────
insert into public.supervisor_intervenciones
  (id, operacion_id, turno_id, registro_asistencia_id, supervisor_id, supervisor_intervino_id, tipo_alerta, accion,
   motivo, guardia_anterior_id, guardia_nuevo_id, estado_anterior, estado_nuevo, zona,
   cobertura_origen_intervencion_id, solicitud_json, resultado_json)
select gen_random_uuid(), gen_random_uuid(), _p.turno_lotuf_edu, null, _p.autoriza, _p.autoriza, 'sin_fichar', 'anulacion_cobertura',
       _p.motivo, _p.eduardo, _p.nicolas, 'cubierto', 'reemplazado', z.nombre,
       _p.intervencion_confirmacion,
       jsonb_build_object('accion', 'anulacion_cobertura', 'intervencion_origen_id', _p.intervencion_confirmacion,
                          'motivo', _p.motivo, 'origen', 'correccion_auditoria_2026_10'),
       jsonb_build_object('estado', 'aplicada', 'registro_cobertura_id', _p.registro_confirmacion,
                          'horas_liquidables_antes', 8.00, 'horas_liquidables_despues', 0, 'estado_turno', 'reemplazado',
                          'turno_reemplazo_id', _p.turno_lotuf_nico)
from _p
join public.turnos t on t.id = _p.turno_lotuf_edu
join public.objetivos o on o.id = t.objetivo_id
left join public.zonas_operativas z on z.id = o.zona_id;

-- ── 4. Vínculo explícito (sólo si 20261121120000 ya está aplicada) ────────
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'turnos' and column_name = 'reemplaza_turno_id') then
    execute $q$update public.turnos set reemplaza_turno_id = '2aeb0d2c-f203-4e1e-85d1-474a8dfba353'
              where id = 'e8adb5de-9270-4316-ba38-8f1ac76b1f9a' and reemplaza_turno_id is null$q$;
  end if;
end $$;

-- ── DESPUÉS ────────────────────────────────────────────────────────────────
select 'DESPUÉS' as momento, t.id as turno_id, o.nombre as objetivo, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
       u.apellido as vigilador, r.id as registro_id, r.tipo_registro, r.origen_cobertura,
       r.hora_entrada_real, r.hora_salida_real, r.horas_trabajadas, r.horas_liquidables,
       r.horas_liquidables_antes_anulacion, r.cobertura_anulada_at
from _p
join public.turnos t on t.id in (_p.turno_lotuf_edu, _p.turno_lotuf_nico, _p.turno_srt_edu)
join public.objetivos o on o.id = t.objetivo_id
left join public.usuarios u on u.id = coalesce(t.guardia_id, t.guardia_original_id)
left join public.registros_asistencia r on r.turno_id = t.id
order by t.fecha, t.hora_inicio, u.apellido;

-- Horas liquidables del 29/10 por vigilador (regla de lib/liquidacion.ts):
-- esperado Eduardo 8 (SRT) y González 8 (Lotuf). Antes: Eduardo 16.
select 'DESPUÉS' as momento, u.apellido, t.fecha,
       sum(case
             when coalesce(t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then 0
             when r.cobertura_anulada_at is not null then 0
             when r.horas_liquidables is not null then round(r.horas_liquidables * 2) / 2
             when r.hora_entrada_real is not null and r.hora_salida_real is not null
               then public.calcular_horas_liquidables(t.hora_inicio, t.hora_fin, t.hora_inicio, t.hora_fin)
             else 0 end) as horas_liquidables_29_10
from _p
join public.turnos t on t.fecha = '2026-10-29' and coalesce(t.guardia_id, t.guardia_original_id) in (_p.eduardo, _p.nicolas)
join public.usuarios u on u.id = coalesce(t.guardia_id, t.guardia_original_id)
left join public.registros_asistencia r on r.turno_id = t.id and coalesce(r.tipo_registro, '') <> 'ausencia'
group by 1, u.apellido, t.fecha
order by 2;

-- Con 20261121120000 aplicada, además:
--   select public.cobertura_real_turno('2aeb0d2c-f203-4e1e-85d1-474a8dfba353');   -- estado sin_obligacion
--   select public.cobertura_real_turno('e8adb5de-9270-4316-ba38-8f1ac76b1f9a');   -- cubierto_titular, 8 h
--   select * from public.detectar_doble_liquidacion('2026-10-29', '2026-10-29');  -- sin filas para Lotuf

-- Período de liquidación afectado (debe seguir en borrador):
select id, mes, estado, cerrado_at, consolidado_at, exportada_at from public.liquidacion_periodo where mes = '2026-10' order by created_at;

ROLLBACK;  -- ← por defecto. Reemplazar por COMMIT sólo con autorización expresa.

-- ── Alternativa (decisión de Gerencia): registrar la AUSENCIA de Eduardo ──
-- En lugar del paso 2, dejar el turno como 'ausente' y crear el registro de
-- ausencia (0 h). Ojo: 'ausente' NO está en los estados sin obligación, así
-- que el turno seguiría sumando 8 h programadas pendientes junto a las 8 h
-- del turno de González (doble obligación en el puesto). Sólo tiene sentido
-- si Gerencia quiere el efecto en presentismo y acepta ese pendiente.
--   update public.turnos set estado = 'ausente' where id = '2aeb0d2c-f203-4e1e-85d1-474a8dfba353';
--   insert into public.registros_asistencia (turno_id, guardia_id, tipo_registro, horas_trabajadas, horas_liquidables, observacion)
--   values ('2aeb0d2c-f203-4e1e-85d1-474a8dfba353', '6df6bdb1-5625-4e53-a247-a2c4ae843933', 'ausencia', 0, 0, '<motivo>');
