// Pruebas de 20261024120000_tareas_turno.sql sobre PGlite: activación sólo
// por Gerencia desde controles aprobados de una versión vigente, sin
// duplicados, el vigilador registra sólo en sus turnos, inmutabilidad,
// alcance de supervisores, evidencia en `evidencias` y que nada toque
// calificaciones ni rondas.
// Uso: node supabase/pruebas/tareas-turno/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5), VIG = AUTH(6), VIG_CASONA = AUTH(7), VIG_ANUL = AUTH(12)
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', CASONA = '335179ef-af0e-41e7-9a38-66a2da661f48'
const VIG_ID = '00000000-0000-0000-0000-000000002006'

async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const rpc = async (nombre, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await sql(`select public.${nombre}(${ph}) as r`, args))[0].r
}
const rango = (texto, cita) => {
  const idx = texto.indexOf(cita)
  if (idx < 0) throw new Error('cita no encontrada')
  const inicio = Array.from(texto.slice(0, idx)).length
  return { inicio, fin: inicio + Array.from(cita).length }
}

// ── Carga ───────────────────────────────────────────────────────────────────
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(new URL('../protocolo-controles/prelude.sql', import.meta.url), 'utf8'))
await db.exec(`
create table public.evidencias (
  id uuid primary key default gen_random_uuid(), proceso_tipo text not null, proceso_id uuid not null,
  turno_id uuid references public.turnos(id), guardia_id uuid references public.usuarios(id),
  objetivo_id uuid references public.objetivos(id), tipo_evidencia text not null, bucket text not null,
  storage_path text not null, created_at timestamptz not null default now(),
  constraint evidencias_proceso_tipo_check check (proceso_tipo in ('ingreso','egreso','supervision','ronda','cambio_guardia','reemplazo','protocolo')));
create table public.supervisiones (id uuid primary key default gen_random_uuid(), objetivo_id uuid, supervisor_id uuid, plantilla_id uuid, estado text);
create or replace function public.validar_supervision_plantilla() returns trigger language plpgsql as $f$ begin return new; end; $f$;`)
for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial',
  '20261023120000_protocolo_controles_propuestos', '20261023130000_protocolo_controles_correcciones']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}
const MIG = `${REPO}/supabase/migrations/20261024120000_tareas_turno.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)
const huellaRondas = async () => (await sql(`select md5(coalesce((select string_agg(r::text,'|' order by id) from rondas_base r),'') || coalesce((select string_agg(p::text,'|' order by id) from ronda_puntos p),'')) h`))[0].h
const rondasAntes = await huellaRondas()

ok('Grants: sólo SELECT para authenticated, nada para anon', (await sql(`select count(*)::int n from information_schema.role_table_grants
  where table_name in ('tareas_turno_definiciones','tareas_turno_registros') and grantee in ('anon','authenticated')
  and (grantee = 'anon' or privilege_type <> 'SELECT')`))[0].n === 0)

// ── Preparar: Randstad vigente con una instrucción y una tarea aprobada ─────
const v = (await sql(`select id, texto from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0]
const CITA_ALARMA = 'Constatada la normalidad en las oficinas se procede a activar la alarma cerrando cada piso.'
const CITA_VISITAS = 'el vigilador registrará los datos de identidad en el libro de novedades.'
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [v.id]) })
await como(GER, async () => { await rpc('protocolo_publicar', [v.id]) })
let ids
await como(JEFE, async () => {
  const r = await rpc('protocolo_instrucciones_registrar', [v.id, JSON.stringify([rango(v.texto, CITA_VISITAS), rango(v.texto, CITA_ALARMA)])])
  ids = r.ids
  await rpc('protocolo_registrar_corrida_ia', [v.id, 'prueba', 1, 1, JSON.stringify([
    { instruccion_id: ids[0], clasificacion: 'obligacion', quien: 'vigilador', cuando: 'cada ingreso de externos', destino: 'checklist_supervision',
      texto_item: 'Libro de visitas con datos de identidad', criticidad: 'normal', foto_obligatoria: false, motivo: 'm', existente_tipo: null, existente_id: null },
    { instruccion_id: ids[1], clasificacion: 'obligacion', quien: 'vigilador', cuando: 'al retirarse el personal', destino: 'tarea_turno',
      texto_item: 'Activar la alarma piso por piso', criticidad: 'alta', foto_obligatoria: false, motivo: 'm', existente_tipo: null, existente_id: null },
  ]), null])
  for (const i of ids) await rpc('protocolo_instruccion_validar', [i, 'obligacion', 'vigilador', null])
})
const ctrlTarea = (await sql(`select id from protocolo_controles_propuestos where instruccion_id = $1`, [ids[1]]))[0].id
const ctrlCheck = (await sql(`select id from protocolo_controles_propuestos where instruccion_id = $1`, [ids[0]]))[0].id

await como(GER, async () => {
  ok('No se activa una tarea sin aprobar', await falla(() => rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'egreso' }])]), /aprobadas/))
})
await como(JEFE, async () => {
  await rpc('protocolo_control_aprobar', [ctrlTarea])
  await rpc('protocolo_control_aprobar', [ctrlCheck])
  const p = await rpc('tareas_turno_panel', [RANDSTAD, 7])
  ok('Panel: la tarea aprobada aparece para activar, Aldo no puede activar', p.para_activar.length === 1 && p.permisos.activar === false)
  ok('Jefe (Aldo): no activa tareas', await falla(() => rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'egreso' }])]), /Solo Gerencia/))
})
await como(ADM, async () => {
  ok('Administración: no activa tareas', await falla(() => rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'egreso' }])]), /Solo Gerencia/))
})
await como(GER, async () => {
  ok('Un control de checklist no se activa como tarea', await falla(() => rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlCheck, momento: 'egreso' }])]), /tareas del turno aprobadas/))
  ok('Momento inválido: rechazado', await falla(() => rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'siempre' }])]), /Momento invalido/))
  const a = await rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'egreso', evidencia: 'foto' }])])
  ok('Gerencia: activa la tarea de egreso con foto', a.ok && a.nuevas === 1)
})
const def = (await sql(`select * from tareas_turno_definiciones where objetivo_id = $1`, [RANDSTAD]))[0]
ok('La tarea guarda su origen (instrucción y control)', def.instruccion_id === ids[1] && def.control_id === ctrlTarea && def.momento === 'egreso')
ok('El control quedó activado y apunta a la tarea', (await sql(`select estado, tarea_definicion_id from protocolo_controles_propuestos where id = $1`, [ctrlTarea]))[0].tarea_definicion_id === def.id)

// Duplicado: otra instrucción que pide lo mismo reutiliza la tarea activa.
let ctrlDup
{
  // Tercera instrucción manual para el duplicado.
  const CITA = 'Si a las 19,30 hs todo el personal de Randstad se ha retirado'
  await sql(`insert into protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256, clasificacion, validada_por, validada_at)
    values ($1, $2, 3, $3, $4, repeat('0',64), 'obligacion', '00000000-0000-0000-0000-000000002003', now())`,
    [v.id, RANDSTAD, rango(v.texto, CITA).inicio, rango(v.texto, CITA).fin])
  await sql(`update protocolo_instrucciones set texto_sha256 = encode(sha256(convert_to(substr($2, inicio + 1, fin - inicio), 'UTF8')), 'hex') where version_id = $1 and orden = 3`, [v.id, v.texto])
  const i3 = (await sql(`select id from protocolo_instrucciones where version_id = $1 and orden = 3`, [v.id]))[0].id
  await como(JEFE, async () => {
    const pr = await rpc('protocolo_control_proponer', [i3, 'tarea_turno', 'Activar la alarma, piso por piso', 'normal', false])
    ctrlDup = pr.id
  })
  // La deduplicación de aprobación compara texto exacto normalizado: este texto
  // normalizado es igual a la tarea, así que se aprueba sólo si no lo detecta.
  await sql(`update protocolo_controles_propuestos set estado = 'aprobado', aprobado_por = '00000000-0000-0000-0000-000000002003', aprobado_at = now() where id = $1`, [ctrlDup])
}
await como(GER, async () => {
  const a = await rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlDup, momento: 'egreso' }])])
  ok('Misma tarea desde otra instrucción: se reutiliza, no se duplica', a.reutilizadas === 1 && a.nuevas === 0)
})
ok('Sigue habiendo una sola tarea activa', (await sql(`select count(*)::int n from tareas_turno_definiciones where objetivo_id = $1 and activo`, [RANDSTAD]))[0].n === 1)

// ── Vigilador ───────────────────────────────────────────────────────────────
const turnoVig = (await sql(`select id from turnos where guardia_id = $1 and objetivo_id = $2`, [VIG_ID, RANDSTAD]))[0].id
let regId
await como(VIG, async () => {
  ok('Vigilador: no ve definiciones por SELECT directo', (await sql('select count(*)::int n from tareas_turno_definiciones'))[0].n === 0)
  const m = await rpc('tareas_turno_mias')
  const t = m.turnos.find(x => x.turno_id === turnoVig)
  ok('Vigilador: ve la tarea de su turno de Randstad', t && t.tareas.length === 1 && t.tareas[0].momento === 'egreso' && t.tareas[0].registro === null)
  ok('No pude sin motivo: rechazado', await falla(() => rpc('tareas_turno_registrar', [turnoVig, def.id, 'no_pude', '']), /por qué/))
  const r = await rpc('tareas_turno_registrar', [turnoVig, def.id, 'hecha', null])
  regId = r.id
  ok('Vigilador: marca la tarea como hecha y se le pide la foto', r.ok && r.pide_foto === true)
  const r2 = await rpc('tareas_turno_registrar', [turnoVig, def.id, 'no_aplica', 'otra cosa'])
  ok('Segundo toque: idempotente, conserva lo primero', r2.estado === 'hecha')
  const d = await rpc('tareas_turno_destino_foto', [regId])
  ok('Destino de la foto: ruta fija por registro', d.storage_path === `tareas-turno/${regId}/foto`)
  ok('Vigilador: ve su registro', (await sql('select count(*)::int n from tareas_turno_registros'))[0].n === 1)
})
for (const [nombre, uid] of [['de otro objetivo', VIG_CASONA], ['con turno anulado', VIG_ANUL]]) {
  await como(uid, async () => {
    ok(`Vigilador ${nombre}: no recibe la tarea de Randstad`, !(await rpc('tareas_turno_mias')).turnos.some(t => t.tareas.some(x => x.definicion_id === def.id)))
    ok(`Vigilador ${nombre}: no registra en el turno ajeno`, await falla(() => rpc('tareas_turno_registrar', [turnoVig, def.id, 'hecha', null]), /no es tuyo/))
    ok(`Vigilador ${nombre}: no pide destino de foto ajeno`, await falla(() => rpc('tareas_turno_destino_foto', [regId]), /ajeno/))
    ok(`Vigilador ${nombre}: no ve el registro ajeno`, (await sql('select count(*)::int n from tareas_turno_registros'))[0].n === 0)
  })
}

// ── Evidencia en `evidencias` ───────────────────────────────────────────────
ok('Evidencia con ruta inventada: rechazada', await falla(() => sql(`insert into evidencias (proceso_tipo, proceso_id, tipo_evidencia, bucket, storage_path) values ('protocolo', $1, 'tarea_turno', 'ronda-evidencias', 'otra/ruta')`, [regId]), /Ruta/))
ok('Evidencia de otro tipo: rechazada', await falla(() => sql(`insert into evidencias (proceso_tipo, proceso_id, tipo_evidencia, bucket, storage_path) values ('protocolo', $1, 'uniforme', 'ronda-evidencias', $2)`, [regId, `tareas-turno/${regId}/foto`]), /Tipo/))
const ev = (await sql(`insert into evidencias (proceso_tipo, proceso_id, tipo_evidencia, bucket, storage_path, guardia_id) values ('protocolo', $1, 'tarea_turno', 'ronda-evidencias', $2, '00000000-0000-0000-0000-000000002007') returning *`, [regId, `tareas-turno/${regId}/foto`]))[0]
ok('Evidencia válida: metadatos autoritativos (vigilador, objetivo y turno del registro)', ev.guardia_id === VIG_ID && ev.objetivo_id === RANDSTAD && ev.turno_id === turnoVig)
await como(VIG, async () => {
  ok('Con foto cargada: no se pide otra', await falla(() => rpc('tareas_turno_destino_foto', [regId]), /ya fue cargada/))
  ok('Vigilador: puede ver su foto', (await rpc('tareas_turno_ver_foto', [regId])).storage_path === `tareas-turno/${regId}/foto`)
})

// ── Supervisión ─────────────────────────────────────────────────────────────
await como(SUP1, async () => {
  const p = await rpc('tareas_turno_panel', [RANDSTAD, 7])
  const t = p.turnos.find(x => x.turno_id === turnoVig)
  ok('Supervisor zona 1: ve el cumplimiento por turno', t && t.aplicables === 1 && t.hechas === 1 && t.pendientes === 0)
  ok('Supervisor zona 1: ve la foto', (await rpc('tareas_turno_ver_foto', [regId])).bucket === 'ronda-evidencias')
  ok('Supervisor: no desactiva', await falla(() => rpc('tareas_turno_desactivar', [def.id, 'x']), /Solo Gerencia/))
})
await como(SUP2, async () => {
  ok('Supervisor zona 2: no ve el panel de Randstad', await falla(() => rpc('tareas_turno_panel', [RANDSTAD, 7]), /permiso/))
  ok('Supervisor zona 2: no ve la foto', await falla(() => rpc('tareas_turno_ver_foto', [regId]), /Sin permiso/))
  ok('Supervisor zona 2: no ve registros', (await sql('select count(*)::int n from tareas_turno_registros'))[0].n === 0)
})

// ── Inmutabilidad y desactivación ───────────────────────────────────────────
ok('Registro: UPDATE rechazado', await falla(() => sql(`update tareas_turno_registros set estado = 'no_pude'`), /inmutables/))
ok('Registro: DELETE rechazado', await falla(() => sql(`delete from tareas_turno_registros`), /inmutables/))
ok('Definición: no se borra', await falla(() => sql(`delete from tareas_turno_definiciones`), /no se borran/))
ok('Definición: el texto no cambia', await falla(() => sql(`update tareas_turno_definiciones set texto = 'otro'`), /no cambia/))
await como(GER, async () => {
  ok('Desactivar sin motivo: rechazado', await falla(() => rpc('tareas_turno_desactivar', [def.id, ' ']), /motivo/))
  ok('Gerencia: desactiva con motivo', (await rpc('tareas_turno_desactivar', [def.id, 'Cambió el procedimiento'])).ok === true)
})
ok('Desactivada: no se reactiva', await falla(() => sql(`update tareas_turno_definiciones set activo = true where id = $1`, [def.id]), /no se reactiva/))
await como(VIG, async () => {
  const t = (await rpc('tareas_turno_mias')).turnos.find(x => x.turno_id === turnoVig)
  ok('Vigilador: la tarea desactivada sigue visible sólo porque ya la registró', t.tareas.length === 1 && t.tareas[0].registro.estado === 'hecha')
})

// ── Lo que no se toca ───────────────────────────────────────────────────────
ok('Rondas y puntos intactos', (await huellaRondas()) === rondasAntes)

// ── Rollback y reaplicar ────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261024120000_tareas_turno_rollback.sql`, 'utf8')).catch(e => { ok('Rollback corre', false, e.message) })
const quedan = (await sql(`select count(*)::int n from pg_class where relname like 'tareas_turno%' and relkind = 'r'`))[0].n
ok('Rollback: quita las tablas de tareas', quedan === 0)

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
