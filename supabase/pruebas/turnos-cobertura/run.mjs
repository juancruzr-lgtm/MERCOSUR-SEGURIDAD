// Pruebas de 20261121120000_turnos_cobertura_liquidacion.sql sobre PGlite.
// Esqueleto de producción en prelude.sql (columnas, CHECK, RLS y funciones
// vivas leídas el 02/11/2026). Reproduce el caso Eduardo Martínez / Lotuf
// 29/10/2026 con los horarios y created_at reales.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/turnos-cobertura/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = `${REPO}/supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql`
const RB = `${REPO}/supabase/rollback/20261121120000_turnos_cobertura_liquidacion_rollback.sql`
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, cond ? '' : extra]) }
async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const uno = async (q, p) => (await sql(q, p))[0]

// ── Identidades ──────────────────────────────────────────────────────────────
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const Z1 = id(901), Z2 = id(902)
const ADM = id(1), ADM_A = id(101)           // admin sin puesto (como "joel juarez")
const SUP = id(2), SUP_A = id(102)           // supervisor de zona 1 (como "SABINO ARANDA")
const SUP2 = id(3), SUP2_A = id(103)         // supervisor de zona 2
const EDU = id(10), EDU_A = id(110)          // EDUARDO MARTÍNEZ
const NICO = id(11), NICO_A = id(111)        // Nicolás Federico González
const PRI = id(12), PRI_A = id(112)          // otro vigilador
const OTRO = id(13)
const SRT = id(201), LOTUF = id(202), DEP = id(203), PAUSA = id(204)
const P_SRT = id(301), P_LOTUF = id(302), P_DEP = id(303), P_PAUSA = id(304)

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(`
insert into zonas_operativas (id, nombre) values ('${Z1}', 'Zona 1'), ('${Z2}', 'Zona 2');
insert into usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, apellido) values
 ('${ADM}', '${ADM_A}', 'admin', null, 'joel', 'juarez'),
 ('${SUP}', '${SUP_A}', 'supervisor', null, 'SABINO', 'ARANDA'),
 ('${SUP2}', '${SUP2_A}', 'supervisor', null, 'SUP', 'ZONA2'),
 ('${EDU}', '${EDU_A}', 'guardia', null, 'EDUARDO', 'MARTÍNEZ'),
 ('${NICO}', '${NICO_A}', 'guardia', null, 'Nicolás Federico', 'González'),
 ('${PRI}', '${PRI_A}', 'guardia', null, 'MIGUEL', 'PRINZEN'),
 ('${OTRO}', null, 'guardia', null, 'OTRO', 'VIGILADOR');
insert into supervisor_zonas values ('${SUP}', '${Z1}'), ('${SUP2}', '${Z2}');
insert into objetivos (id, nombre, zona_id, estado) values
 ('${SRT}', 'SRT', '${Z1}', 'activo'), ('${LOTUF}', 'Polideportivo Lotuf', '${Z1}', 'activo'),
 ('${DEP}', 'DEPOSITO FISCAL', '${Z1}', 'activo'), ('${PAUSA}', 'Pausado', '${Z1}', 'inactivo');
insert into puestos (id, objetivo_id, nombre) values
 ('${P_SRT}', '${SRT}', 'Puesto'), ('${P_LOTUF}', '${LOTUF}', 'Puesto'), ('${P_DEP}', '${DEP}', 'Puesto'), ('${P_PAUSA}', '${PAUSA}', 'Puesto');
`)

// Estado previo a la migración, como en producción el 29/10 a las 15:00.
const T_SRT = id(401), T_EDU_LOTUF = id(402)
await sql(`insert into turnos (id, guardia_id, guardia_original_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, created_at) values
  ($1, $3, $3, $4, $5, '2026-10-29', '07:00', '15:00', 'programado', '2026-10-01 02:52:58+00'),
  ($2, $3, $3, $6, $7, '2026-10-29', '15:00', '23:00', 'programado', '2026-10-01 02:42:05+00')`,
  [T_SRT, T_EDU_LOTUF, EDU, SRT, P_SRT, LOTUF, P_LOTUF])
const R_SRT = id(501)
await sql(`insert into registros_asistencia (id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, horas_trabajadas, gps_ingreso_estado, gps_egreso_estado, alerta_entrada)
  values ($1, $2, $3, '06:30:38', '15:00:00', 8.5, 'dentro_radio', 'dentro_radio', 'anticipada')`, [R_SRT, T_SRT, EDU])

// ── Migración (dos veces: idempotente) ───────────────────────────────────────
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración aplica y es idempotente', true)
const triggers = (await sql(`select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass, 'public.registros_asistencia'::regclass) and not tgisinternal order by 1`)).map(r => r.tgname)
ok('triggers nuevos presentes', ['registros_asistencia_consumir_excepcion', 'registros_asistencia_validar_liquidable', 'turnos_historial_registrar', 'turnos_validar_superposicion'].every(t => triggers.includes(t)), triggers.join(','))

const insTurno = (uid, t) => como(uid, () => sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, created_at, reemplaza_turno_id)
  values ($1, $2, $3, $4, $5, $6, coalesce($7, 'programado'), coalesce($8::timestamptz, now()), $9) returning id`,
  [t.guardia, t.objetivo, t.puesto, t.fecha, t.ini, t.fin, t.estado ?? null, t.creado ?? null, t.reemplaza ?? null]))
const nuevo = async (uid, t) => (await insTurno(uid, t))[0].id
const cobertura = async (uid, turno) => (await como(uid, () => sql(`select public.cobertura_real_turno($1) as c`, [turno])))[0].c

// ── 1) Reemplazo que cubre efectivamente el puesto (caso Lotuf) ─────────────
// El turno de González se crea a las 15:05 (hora AR) en el mismo puesto.
const T_NICO = await nuevo(SUP_A, { guardia: NICO, objetivo: LOTUF, puesto: P_LOTUF, fecha: '2026-10-29', ini: '15:00', fin: '23:00', creado: '2026-10-29 18:05:20+00' })
ok('alta del turno de reemplazo (otro vigilador, mismo puesto) permitida', !!T_NICO)
const [{ id: R_NICO }] = await como(NICO_A, () => sql(`insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real, gps_ingreso_estado, alerta_entrada)
  values ($1, $2, '15:06:37', 'fuera_radio', 'tarde') returning id`, [T_NICO, NICO]))
await como(NICO_A, () => sql(`update registros_asistencia set hora_salida_real = '23:14:10', horas_trabajadas = 8.13, gps_egreso_estado = 'fuera_radio' where id = $1`, [R_NICO]))
await sql(`insert into evidencias (turno_id, guardia_id, objetivo_id, proceso_tipo, proceso_id, tipo_evidencia) values ($1, $2, $3, 'ingreso', $4, 'libro_guardia')`, [T_NICO, NICO, LOTUF, R_NICO])
ok('el vigilador ficha su ingreso y egreso por la app (escritura directa permitida)', true)

let c = await cobertura(SUP_A, T_EDU_LOTUF)
ok('cobertura real del turno de Eduardo: cubierto por reemplazo, 8 h con evidencia, sin doble liquidación',
  c.estado === 'cubierto_reemplazo' && Number(c.horas_cubiertas_con_evidencia) === 8 && Number(c.horas_liquidadas) === 8 && Number(c.horas_doble_liquidacion) === 0, JSON.stringify(c))
ok('la cobertura lista titular sin registro y reemplazo con fichaje',
  c.coberturas.length === 2 && c.coberturas.some(x => x.rol === 'titular' && x.evidencia === 'sin_registro') && c.coberturas.some(x => x.rol === 'reemplazo' && x.evidencia === 'fichaje' && x.guardia_id === NICO), JSON.stringify(c.coberturas))
ok('fecha de atribución = día de inicio', c.fecha === '2026-10-29')
ok('cobertura_real_turno respeta alcance (supervisor de otra zona)', await falla(() => cobertura(SUP2_A, T_EDU_LOTUF), /No autorizado/))

// ── 2) No doble liquidación: confirmar a Eduardo sobre lo que cubrió González ─
const confirmar = (uid, turno, guardia, origen = 'confirmacion_supervisor', comentario = 'Si confirmado') =>
  como(uid, () => sql(`select public.registrar_cobertura($1, $2, $3, null, null, null, $4) as r`, [turno, guardia, origen, comentario]))
ok('confirmación del titular sobre un intervalo ya cubierto por el reemplazo → rechazada',
  await falla(() => confirmar(ADM_A, T_EDU_LOTUF, EDU), /DOBLE_LIQUIDACION/))
ok('…y es atómica: el turno no pasó a cubierto ni quedó registro',
  (await uno(`select estado from turnos where id = $1`, [T_EDU_LOTUF])).estado === 'programado'
  && (await uno(`select count(*)::int n from registros_asistencia where turno_id = $1`, [T_EDU_LOTUF])).n === 0)
const opExcEdu = id(601)
const rExcEdu = await como(ADM_A, () => sql(`select public.autorizar_excepcion_asistencia($1, $2, $3) as r`, [opExcEdu, T_EDU_LOTUF, 'Supervisor informa por teléfono que estuvo en el puesto']))
ok('ni con excepción autorizada se liquida dos veces el mismo intervalo',
  rExcEdu[0].r.estado === 'creada' && await falla(() => confirmar(ADM_A, T_EDU_LOTUF, EDU), /DOBLE_LIQUIDACION/))
ok('la excepción no usada queda sin consumir', (await uno(`select consumida_registro_id from asistencia_excepciones_autorizadas where operacion_id = $1`, [opExcEdu])).consumida_registro_id === null)

// ── 3) Confirmación manual sin evidencia → rechazada ────────────────────────
const T_PRI = await nuevo(SUP_A, { guardia: PRI, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-30', ini: '07:00', fin: '15:00', creado: '2026-10-01 00:00+00' })
ok('confirmación de supervisor sin fichaje, fotos ni rondas → rechazada',
  await falla(() => confirmar(SUP_A, T_PRI, PRI), /CONFIRMACION_SIN_EVIDENCIA/))
ok('…sin efectos parciales (turno sigue programado)', (await uno(`select estado from turnos where id = $1`, [T_PRI])).estado === 'programado')
ok('confirmación admin (confirmar_cubierto → confirmacion_admin) también exige evidencia',
  await falla(() => confirmar(ADM_A, T_PRI, PRI, 'confirmacion_admin'), /CONFIRMACION_SIN_EVIDENCIA/))

// ── 4) Excepción autorizada → aceptada y auditada ───────────────────────────
const autorizar = (uid, op, turno, motivo) => como(uid, () => sql(`select public.autorizar_excepcion_asistencia($1, $2, $3) as r`, [op, turno, motivo]))
const MOTIVO = 'Celular roto; el supervisor lo verificó en el puesto a las 08:30 y hay acta firmada'
ok('un supervisor de zona no puede autorizarse la excepción', await falla(() => autorizar(SUP_A, id(602), T_PRI, MOTIVO), /No autorizado/))
ok('motivo corto → rechazado', await falla(() => autorizar(ADM_A, id(603), T_PRI, 'ok'), /mínimo 20/))
const ex1 = (await autorizar(ADM_A, id(604), T_PRI, MOTIVO))[0].r
const ex1b = (await autorizar(ADM_A, id(604), T_PRI, MOTIVO))[0].r
ok('la autorización es idempotente por operacion_id', ex1.estado === 'creada' && ex1b.estado === 'existente' && ex1.excepcion_id === ex1b.excepcion_id)
ok('reusar operacion_id con otro motivo → rechazado', await falla(() => autorizar(ADM_A, id(604), T_PRI, MOTIVO + ' (otro)'), /otro contexto/))
const reg = (await confirmar(SUP_A, T_PRI, PRI, 'confirmacion_supervisor', 'Verificado en el puesto'))[0].r
const fila = await uno(`select excepcion_asistencia_id, horas_liquidables::float h from registros_asistencia where id = $1`, [reg])
ok('con excepción vigente la confirmación se acepta (8 h) y queda ligada a la excepción', fila.excepcion_asistencia_id === ex1.excepcion_id && fila.h === 8, JSON.stringify(fila))
const exc = await uno(`select * from asistencia_excepciones_autorizadas where id = $1`, [ex1.excepcion_id])
ok('la excepción guarda rol, motivo, quién y cuándo, y queda consumida por ese registro',
  exc.autorizado_por === ADM && exc.autorizado_rol === 'admin' && exc.motivo === MOTIVO && exc.autorizado_at && exc.consumida_registro_id === reg && exc.consumida_at)
const aud = await uno(`select * from registros_asistencia_auditoria where registro_id = $1 and campo = 'excepcion_sin_evidencia'`, [reg])
ok('auditoría del registro con la excepción (quién autorizó y motivo)', aud && aud.modificado_por === ADM && aud.comentario.includes(MOTIVO) && aud.valor_nuevo === ex1.excepcion_id, JSON.stringify(aud))
ok('excepción consumida: no se edita ni se borra',
  await falla(() => sql(`update asistencia_excepciones_autorizadas set motivo = 'x' where id = $1`, [ex1.excepcion_id]), /único consumo/)
  && await falla(() => sql(`delete from asistencia_excepciones_autorizadas where id = $1`, [ex1.excepcion_id]), /no se borran/))
c = await cobertura(ADM_A, T_PRI)
ok('cobertura con excepción: cubierto_titular, evidencia excepcion_autorizada', c.estado === 'cubierto_titular' && c.coberturas[0].evidencia === 'excepcion_autorizada', JSON.stringify(c))
ok('el cliente no puede escribir excepciones directamente', await falla(() => como(ADM_A, () => sql(`insert into asistencia_excepciones_autorizadas (operacion_id, turno_id, guardia_id, motivo, autorizado_por, autorizado_rol) values ($1, $2, $3, $4, $5, 'admin')`, [id(605), T_PRI, PRI, MOTIVO, ADM])), /permission denied/))

// ── 5) Con evidencia (fotos de ingreso) no hace falta excepción ─────────────
const T_FOTO = await nuevo(SUP_A, { guardia: OTRO, objetivo: SRT, puesto: P_SRT, fecha: '2026-10-31', ini: '07:00', fin: '15:00', creado: '2026-10-01 00:00+00' })
await sql(`insert into evidencias (turno_id, guardia_id, objetivo_id, proceso_tipo, tipo_evidencia) values ($1, $2, $3, 'ingreso', 'uniforme')`, [T_FOTO, OTRO, SRT])
const regFoto = (await confirmar(SUP_A, T_FOTO, OTRO))[0].r
ok('confirmación con fotos de ingreso del vigilador → aceptada sin excepción', !!regFoto && (await uno(`select excepcion_asistencia_id from registros_asistencia where id = $1`, [regFoto])).excepcion_asistencia_id === null)

// ── 5b) Constatación del supervisor en el lugar (supervisión durante el turno) ─
// Regla: las horas se reconocen con respaldo del vigilador o con una supervisión
// cargada en el objetivo durante el turno. El comentario de la confirmación no alcanza.
const T_SUPV = await nuevo(SUP_A, { guardia: PRI, objetivo: DEP, puesto: P_DEP, fecha: '2026-11-03', ini: '07:00', fin: '15:00', creado: '2026-10-01 00:00+00' })
await sql(`insert into supervisiones (objetivo_id, supervisor_id, estado, created_at) values ($1, $2, 'ok', '2026-11-03 12:00+00')`, [DEP, SUP])
const regSupv = (await confirmar(SUP_A, T_SUPV, PRI, 'confirmacion_supervisor', 'Lo vi en el puesto durante la supervisión'))[0].r
ok('supervisión cargada en el objetivo durante el turno → confirmación aceptada sin excepción',
  !!regSupv && (await uno(`select excepcion_asistencia_id from registros_asistencia where id = $1`, [regSupv])).excepcion_asistencia_id === null)
c = await cobertura(ADM_A, T_SUPV)
ok('la cobertura muestra la evidencia constatacion_supervisor', c.estado === 'cubierto_titular' && c.coberturas[0].evidencia === 'constatacion_supervisor', JSON.stringify(c))
const T_SUPV_FUERA = await nuevo(SUP_A, { guardia: PRI, objetivo: DEP, puesto: P_DEP, fecha: '2026-11-04', ini: '07:00', fin: '15:00', creado: '2026-10-01 00:00+00' })
// 06:00 AR (antes del turno) y 15:30 AR (después): no constatan este turno.
await sql(`insert into supervisiones (objetivo_id, supervisor_id, estado, created_at) values ($1, $2, 'ok', '2026-11-04 09:00+00'), ($1, $2, 'ok', '2026-11-04 18:30+00')`, [DEP, SUP])
ok('supervisión fuera del horario del turno no respalda → rechazada',
  await falla(() => confirmar(SUP_A, T_SUPV_FUERA, PRI), /CONFIRMACION_SIN_EVIDENCIA/))
ok('el mensaje de rechazo menciona la supervisión como respaldo posible',
  /supervisión en el objetivo/.test(String(await falla(() => confirmar(SUP_A, T_SUPV_FUERA, PRI), /NADA/))))
ok('puedo_autorizar_excepcion_asistencia: admin sí, supervisor de zona no',
  (await como(ADM_A, () => uno(`select public.puedo_autorizar_excepcion_asistencia() v`))).v === true
  && (await como(SUP_A, () => uno(`select public.puedo_autorizar_excepcion_asistencia() v`))).v === false)

// ── 6) Superposición rechazada ──────────────────────────────────────────────
ok('mismo vigilador en dos turnos simultáneos (alta directa del supervisor) → rechazada',
  await falla(() => insTurno(SUP_A, { guardia: EDU, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-29', ini: '14:00', fin: '22:00' }), /TURNO_SUPERPUESTO/))
const T_E30A = await nuevo(SUP_A, { guardia: EDU, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-30', ini: '07:00', fin: '15:00' })
const T_E30B = await nuevo(SUP_A, { guardia: EDU, objetivo: LOTUF, puesto: P_LOTUF, fecha: '2026-10-30', ini: '15:00', fin: '23:00' })
ok('turnos consecutivos en objetivos distintos [07–15) y [15–23) → permitidos (la app advierte traslado)', !!T_E30A && !!T_E30B)
ok('extender un turno sobre el siguiente (UPDATE hora_fin) → rechazado',
  await falla(() => como(SUP_A, () => sql(`update turnos set hora_fin = '16:00' where id = $1`, [T_E30A])), /TURNO_SUPERPUESTO/))
const T_E31 = await nuevo(SUP_A, { guardia: EDU, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-31', ini: '07:00', fin: '15:00' })
await como(SUP_A, () => sql(`update turnos set estado = 'anulado' where id = $1`, [T_E31]))
const T_E31B = await nuevo(SUP_A, { guardia: EDU, objetivo: SRT, puesto: P_SRT, fecha: '2026-10-31', ini: '08:00', fin: '12:00' })
ok('un turno anulado no cuenta para la superposición', !!T_E31B)
ok('reactivar el turno anulado que ahora se superpone → rechazado',
  await falla(() => como(SUP_A, () => sql(`update turnos set estado = 'programado' where id = $1`, [T_E31])), /TURNO_SUPERPUESTO/))
await nuevo(SUP_A, { guardia: PRI, objetivo: PAUSA, puesto: P_PAUSA, fecha: '2026-11-01', ini: '07:00', fin: '15:00' })
ok('un turno en objetivo pausado no bloquea', !!(await nuevo(SUP_A, { guardia: PRI, objetivo: DEP, puesto: P_DEP, fecha: '2026-11-01', ini: '08:00', fin: '16:00' })))
ok('la escritura por servicio (service_role) también pasa por el trigger',
  await falla(async () => { await db.exec('set role service_role'); try { await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values ($1, $2, $3, '2026-10-29', '10:00', '12:00')`, [EDU, DEP, P_DEP]) } finally { await db.exec('reset role') } }, /TURNO_SUPERPUESTO/))

// Pares superpuestos heredados (hay 1 en producción, 03/10) no traban otras operaciones.
await sql(`alter table turnos disable trigger turnos_validar_superposicion`)
const [{ id: H1 }] = await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values ($1, $2, $3, '2026-10-03', '09:30', '17:00') returning id`, [OTRO, DEP, P_DEP])
await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values ($1, $2, $3, '2026-10-03', '09:30', '17:00')`, [OTRO, SRT, P_SRT])
await sql(`alter table turnos enable trigger turnos_validar_superposicion`)
await como(SUP_A, () => sql(`update turnos set estado = 'cubierto', observacion = 'x' where id = $1`, [H1]))
ok('un par superpuesto heredado admite cambios que no tocan horario/vigilador', (await uno(`select estado from turnos where id = $1`, [H1])).estado === 'cubierto')
ok('reemplaza_turno_id hacia otro objetivo → rechazado',
  await falla(() => insTurno(SUP_A, { guardia: OTRO, objetivo: SRT, puesto: P_SRT, fecha: '2026-10-29', ini: '15:00', fin: '23:00', reemplaza: T_EDU_LOTUF }), /REEMPLAZO_INVALIDO/))

// ── 7) Turno nocturno que cruza la medianoche ───────────────────────────────
const T_NOCHE = await nuevo(SUP_A, { guardia: NICO, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-30', ini: '19:00', fin: '07:00', creado: '2026-10-01 02:14:07+00' })
ok('nocturno 30/10 19–07 vs 31/10 06–14 del mismo vigilador → superposición rechazada',
  await falla(() => insTurno(SUP_A, { guardia: NICO, objetivo: SRT, puesto: P_SRT, fecha: '2026-10-31', ini: '06:00', fin: '14:00' }), /TURNO_SUPERPUESTO/))
ok('31/10 07–15 empieza justo al terminar el nocturno → permitido', !!(await nuevo(SUP_A, { guardia: NICO, objetivo: SRT, puesto: P_SRT, fecha: '2026-10-31', ini: '07:00', fin: '15:00' })))
const [{ id: R_NOCHE }] = await como(NICO_A, () => sql(`insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real) values ($1, $2, '18:55:18') returning id`, [T_NOCHE, NICO]))
await como(NICO_A, () => sql(`update registros_asistencia set hora_salida_real = '07:01:20', horas_trabajadas = 12.1 where id = $1`, [R_NOCHE]))
c = await cobertura(SUP_A, T_NOCHE)
ok('el nocturno pertenece al día de inicio (30/10) y liquida 12 h', c.fecha === '2026-10-30' && Number(c.horas_programadas) === 12 && Number(c.horas_liquidadas) === 12 && c.estado === 'cubierto_titular', JSON.stringify(c))

// ── 8) Escrituras directas que intentaban saltear validaciones ──────────────
const [{ id: R_E30 }] = await como(EDU_A, () => sql(`insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real) values ($1, $2, '06:55') returning id`, [T_E30A, EDU]))
ok('el vigilador no puede fijarse horas liquidables en su propio registro',
  await falla(() => como(EDU_A, () => sql(`update registros_asistencia set horas_liquidables = 24 where id = $1`, [R_E30])), /CAMPO_PROTEGIDO/))
ok('el vigilador no puede crearse una "confirmación" manual',
  await falla(() => como(EDU_A, () => sql(`insert into registros_asistencia (turno_id, guardia_id, tipo_registro, origen_cobertura, horas_liquidables) values ($1, $2, 'carga_manual', 'confirmacion_supervisor', 8)`, [T_E30B, EDU])), /CAMPO_PROTEGIDO/))
ok('ni un admin por PostgREST directo (debe usar la RPC)',
  await falla(() => como(ADM_A, () => sql(`update registros_asistencia set horas_liquidables = 12 where id = $1`, [R_E30])), /CAMPO_PROTEGIDO/))
await como(EDU_A, () => sql(`update registros_asistencia set hora_salida_real = '15:00', horas_trabajadas = 8.08 where id = $1`, [R_E30]))
ok('el egreso normal del vigilador sigue funcionando', (await uno(`select hora_salida_real from registros_asistencia where id = $1`, [R_E30])).hora_salida_real === '15:00:00')
ok('_registro_liquidable_validar no se puede invocar fuera del trigger',
  await falla(() => como(ADM_A, () => sql(`select public._registro_liquidable_validar('INSERT', '{}'::jsonb, null, false)`)), /trigger/))

// ── 9) Historial append-only de turnos ──────────────────────────────────────
const hist = await sql(`select operacion, campos_cambiados, actor_usuario_id, actor_db_role from turnos_historial where turno_id = $1 order by id`, [T_E31])
ok('alta y cambio de un turno quedan en el historial con el actor (escritura directa)',
  hist.length === 2 && hist[0].operacion === 'INSERT' && hist[1].operacion === 'UPDATE' && hist[1].campos_cambiados.includes('estado')
  && hist.every(h => h.actor_usuario_id === SUP && h.actor_db_role === 'authenticated'), JSON.stringify(hist))
const histRpc = await sql(`select actor_usuario_id, actor_db_role, campos_cambiados from turnos_historial where turno_id = $1 and operacion = 'UPDATE'`, [T_PRI])
ok('el cambio hecho por una RPC también queda (actor = quien llamó)', histRpc.length === 1 && histRpc[0].actor_usuario_id === SUP && histRpc[0].campos_cambiados.includes('estado'), JSON.stringify(histRpc))
ok('el historial no se edita ni se borra',
  await falla(() => sql(`update turnos_historial set operacion = 'INSERT'`), /append-only/)
  && await falla(() => sql(`delete from turnos_historial`), /append-only/)
  && await falla(() => sql(`truncate turnos_historial`), /append-only/))
ok('no se puede fabricar historial por RPC', await falla(() => como(ADM_A, () => sql(`select public._turnos_historial_insertar($1, 'INSERT', '{}', null, null, 'x')`, [T_PRI])), /trigger/))
await sql(`delete from turnos where id = $1`, [T_E31B])
ok('borrar un turno no borra su historial (queda la fila DELETE)', (await sql(`select operacion from turnos_historial where turno_id = $1 order by id`, [T_E31B])).map(r => r.operacion).join(',') === 'INSERT,DELETE')
ok('el vigilador no lee historial de turnos', (await como(EDU_A, () => sql(`select count(*)::int n from turnos_historial`)))[0].n === 0)

// ── 10) Datos heredados: la confirmación del 30/10 que ya está en producción ─
await sql(`alter table registros_asistencia disable trigger registros_asistencia_validar_liquidable`)
const [{ id: R_EDU_MANUAL }] = await sql(`insert into registros_asistencia (turno_id, guardia_id, tipo_registro, origen_cobertura, horas_liquidables, observacion, created_at)
  values ($1, $2, 'carga_manual', 'confirmacion_supervisor', 8.00, 'Si confirmado', '2026-10-30 12:43:19+00') returning id`, [T_EDU_LOTUF, EDU])
await sql(`update turnos set estado = 'cubierto' where id = $1`, [T_EDU_LOTUF])
await sql(`alter table registros_asistencia enable trigger registros_asistencia_validar_liquidable`)
const dobles = await como(ADM_A, () => sql(`select turno_id, guardia_id, horas_programadas::float p, horas_liquidadas::float l, horas_doble::float d from detectar_doble_liquidacion('2026-10-29', '2026-10-29')`))
ok('detectar_doble_liquidacion encuentra el turno de Eduardo en Lotuf: 16 h liquidadas sobre 8 programadas',
  dobles.length === 1 && dobles[0].turno_id === T_EDU_LOTUF && dobles[0].guardia_id === EDU && dobles[0].p === 8 && dobles[0].l === 16 && dobles[0].d === 8, JSON.stringify(dobles))
ok('…filtrado por alcance (supervisor de otra zona no lo ve)', (await como(SUP2_A, () => sql(`select * from detectar_doble_liquidacion('2026-10-29', '2026-10-29')`))).length === 0)
ok('…y vedado a vigiladores', await falla(() => como(EDU_A, () => sql(`select * from detectar_doble_liquidacion('2026-10-29', '2026-10-29')`)), /No autorizado/))
c = await cobertura(ADM_A, T_EDU_LOTUF)
ok('cobertura real marca doble_liquidacion y la evidencia del titular como sin_evidencia', c.estado === 'doble_liquidacion' && c.coberturas.find(x => x.rol === 'titular').evidencia === 'sin_evidencia', JSON.stringify(c))
const horas = async (t, g) => Number((await uno(`select public.turno_horas_liquidadas($1, $2) h`, [t, g])).h)
ok('horas SRT de Eduardo = 8 (fichaje 06:30–15:00 → duración programada)', await horas(T_SRT, EDU) === 8)

// Corrección propuesta (docs/auditoria-2026-10/propuesta_correccion_eduardo_lotuf.sql):
// anular la cobertura sin evidencia conservando el registro.
await sql(`update registros_asistencia set horas_liquidables_antes_anulacion = horas_liquidables, horas_liquidables = 0,
  cobertura_anulada_at = now(), cobertura_anulada_motivo = 'Auditoría 10/2026' where id = $1`, [R_EDU_MANUAL])
ok('tras anular la confirmación sin evidencia no queda doble liquidación', (await como(ADM_A, () => sql(`select * from detectar_doble_liquidacion('2026-10-29', '2026-10-29')`))).length === 0)
ok('se preservan las horas de SRT (8) y de González (8)', await horas(T_SRT, EDU) === 8 && await horas(T_NICO, NICO) === 8 && await horas(T_EDU_LOTUF, EDU) === 0)
ok('el registro anulado se conserva', (await uno(`select count(*)::int n from registros_asistencia where id = $1`, [R_EDU_MANUAL])).n === 1)

// ── 11) Rollback ─────────────────────────────────────────────────────────────
const histAntes = (await uno(`select count(*)::int n from turnos_historial`)).n
await db.exec(readFileSync(RB, 'utf8'))
const triggersRb = (await sql(`select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass, 'public.registros_asistencia'::regclass) and not tgisinternal order by 1`)).map(r => r.tgname)
ok('rollback quita los triggers nuevos', triggersRb.join(',') === 'trg_turnos_completar_puesto,turnos_updated_at', triggersRb.join(','))
ok('rollback conserva historial, excepciones, turnos y registros',
  (await uno(`select count(*)::int n from turnos_historial`)).n === histAntes
  && (await uno(`select count(*)::int n from asistencia_excepciones_autorizadas`)).n === 2
  && (await uno(`select count(*)::int n from registros_asistencia where id = any($1)`, [[R_SRT, R_NICO, R_EDU_MANUAL]])).n === 3)
ok('tras el rollback el historial sigue inmutable', await falla(() => sql(`delete from turnos_historial`), /append-only/))
ok('tras el rollback se vuelve al comportamiento previo (sin validación de superposición)',
  !!(await nuevo(SUP_A, { guardia: EDU, objetivo: DEP, puesto: P_DEP, fecha: '2026-10-29', ini: '14:00', fin: '22:00' })))

// ── Resultado ───────────────────────────────────────────────────────────────
for (const [estado, nombre, extra] of resultados) console.log(`${estado} ${nombre}${extra ? `\n      ${extra}` : ''}`)
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
