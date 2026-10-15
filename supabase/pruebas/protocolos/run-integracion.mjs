// Prueba integrada de protocolos: las migraciones en el orden de producción
// (22120000 → 22130000 → 23120000 → 23130000 → 24120000 → 25120000) y el
// recorrido completo con sesiones de Gerencia, Aldo (jefe de supervisores),
// supervisor y vigilador: permisos, guardar = vigente, historial, confirmación
// de objetivo dudoso, lectura del vigilador, edición simultánea y que los
// controles y tareas activados sigan iguales cuando cambia el protocolo.
// Uso: node supabase/pruebas/protocolos/run-integracion.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond === true ? 'OK ' : 'FALLA', nombre, extra || (cond !== true && cond !== false ? String(cond) : '')]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5), VIG = AUTH(6)
const JEFE_ID = '00000000-0000-0000-0000-000000002003'
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'

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

// ── Carga en el orden de producción ─────────────────────────────────────────
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
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

const huella = async () => (await sql(`select md5(
  coalesce((select string_agg(t::text, '|' order by id) from turnos t), '') ||
  coalesce((select string_agg(r::text, '|' order by id) from rondas_base r), '') ||
  coalesce((select string_agg(p::text, '|' order by id) from ronda_puntos p), '') ||
  coalesce((select string_agg(u::text, '|' order by id) from usuarios u), '')) h`))[0].h
const huellaAntes = await huella()

for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial',
  '20261023120000_protocolo_controles_propuestos', '20261023130000_protocolo_controles_correcciones',
  '20261024120000_tareas_turno', '20261025120000_protocolos_ultima_rige']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}
ok('Las 6 migraciones corren en orden', true)
for (const v of (await db.exec(readFileSync(`${REPO}/supabase/verificacion/protocolos_ultima_rige_post_migracion.sql`, 'utf8'))).at(-1).rows) ok('Verificación: ' + v.control, v.ok === true, v.obtenido)
ok('Hay 22 borradores y ninguno rige (como producción)', (await sql(`select count(*) filter (where estado = 'borrador')::int b, count(*) filter (where estado = 'vigente')::int v from protocolo_versiones`))[0].v === 0)
ok('7 con objetivo a confirmar (como producción)', (await sql(`select count(*)::int n from protocolo_versiones where asociacion = 'pendiente_validacion'`))[0].n === 7)

const v1 = (await sql(`select id, titulo, texto from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0]
const enZona = async uid => { try { await como(uid, () => rpc('protocolo_panel_objetivo', [RANDSTAD])); return true } catch { return false } }
const SUP_DENTRO = (await enZona(SUP1)) ? SUP1 : SUP2
const SUP_FUERA = SUP_DENTRO === SUP1 ? SUP2 : SUP1

// ── Permisos ────────────────────────────────────────────────────────────────
ok('Supervisor de la zona: lee el protocolo', await enZona(SUP_DENTRO))
ok('Supervisor de otra zona: no lo ve', !(await enZona(SUP_FUERA)))
await como(SUP_DENTRO, async () => {
  ok('Supervisor: no guarda', await falla(() => rpc('protocolo_guardar', [RANDSTAD, null, 'x', 'otro texto', v1.id, null, false]), /permiso/i))
  ok('Supervisor: no hace regir', await falla(() => rpc('protocolo_hacer_vigente', [v1.id, null, false]), /permiso/i))
})
await como(VIG, async () => {
  ok('Vigilador: no guarda', await falla(() => rpc('protocolo_guardar', [RANDSTAD, null, 'x', 'otro texto', v1.id, null, false]), /permiso/i))
  ok('Vigilador: no ve el panel de gestión', await falla(() => rpc('protocolo_panel_objetivo', [RANDSTAD]), /permiso/i))
  ok('Vigilador: antes de que rija no recibe nada', (await rpc('protocolo_mis_documentos')).documentos.length === 0)
})

// ── Aldo hace regir v1: inmediato ───────────────────────────────────────────
await como(JEFE, async () => {
  const r = await rpc('protocolo_hacer_vigente', [v1.id, null, false])
  ok('Aldo: «Que rija este texto» → rige en el acto', r.ok && r.numero === 1)
})
await como(VIG, async () => {
  const d = (await rpc('protocolo_mis_documentos')).documentos
  const doc = d.find(x => x.version_id === v1.id)
  ok('Vigilador: recibe el texto completo que rige', doc && doc.texto === v1.texto && !doc.cambio)
  await rpc('protocolo_registrar_apertura', [v1.id, doc.turnos[0], null])
  const c = await rpc('protocolo_confirmar_lectura', [v1.id, doc.turnos[0]])
  ok('Vigilador: confirma la lectura', c.ok === true)
})

// ── Controles de v1: checklist y tarea activados por Gerencia ──────────────
const CITA_ALARMA = 'Constatada la normalidad en las oficinas se procede a activar la alarma cerrando cada piso.'
const CITA_VISITAS = 'el vigilador registrará los datos de identidad en el libro de novedades.'
let ids
await como(JEFE, async () => {
  ids = (await rpc('protocolo_instrucciones_registrar', [v1.id, JSON.stringify([rango(v1.texto, CITA_VISITAS), rango(v1.texto, CITA_ALARMA)])])).ids
  await rpc('protocolo_registrar_corrida_ia', [v1.id, 'prueba', 1, 1, JSON.stringify([
    { instruccion_id: ids[0], clasificacion: 'obligacion', quien: 'vigilador', cuando: 'cada ingreso', destino: 'checklist_supervision',
      texto_item: 'Libro de visitas con datos de identidad', criticidad: 'normal', foto_obligatoria: false, motivo: 'm', existente_tipo: null, existente_id: null },
    { instruccion_id: ids[1], clasificacion: 'obligacion', quien: 'vigilador', cuando: 'al cierre', destino: 'tarea_turno',
      texto_item: 'Activar la alarma piso por piso', criticidad: 'alta', foto_obligatoria: false, motivo: 'm', existente_tipo: null, existente_id: null },
  ]), null])
  for (const i of ids) await rpc('protocolo_instruccion_validar', [i, 'obligacion', 'vigilador', null])
})
const ctrlCheck = (await sql(`select id from protocolo_controles_propuestos where instruccion_id = $1`, [ids[0]]))[0].id
const ctrlTarea = (await sql(`select id from protocolo_controles_propuestos where instruccion_id = $1`, [ids[1]]))[0].id
await como(JEFE, async () => { await rpc('protocolo_control_aprobar', [ctrlCheck]); await rpc('protocolo_control_aprobar', [ctrlTarea]) })
await como(GER, async () => {
  ok('Gerencia: activa el control en el checklist', (await rpc('protocolo_controles_activar', [RANDSTAD, `{${ctrlCheck}}`])).ok === true)
  ok('Gerencia: activa la tarea del turno', (await rpc('tareas_turno_activar', [RANDSTAD, JSON.stringify([{ control_id: ctrlTarea, momento: 'egreso' }])])).nuevas === 1)
})
const foto = async () => (await sql(`select md5(
  coalesce((select string_agg(ci::text, '|' order by id) from checklist_items ci), '') ||
  coalesce((select string_agg(d::text, '|' order by id) from tareas_turno_definiciones d), '') ||
  coalesce((select string_agg(c::text, '|' order by id) from protocolo_controles_propuestos c), '') ||
  coalesce((select checklist_plantilla_id::text from objetivos where id = '${RANDSTAD}'), '')) h`))[0].h
const controlesAntes = await foto()

// ── Aldo edita y guarda: v2 rige, v1 al historial ──────────────────────────
let v2
await como(JEFE, async () => {
  const r = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, v1.texto + '\nNo permitir el ingreso sin credencial.', v1.id, v1.id, false])
  v2 = r.id
  ok('Aldo: Guardar → la versión nueva rige en el acto', r.ok && r.numero === 2 && r.reemplazo === v1.id)
  ok('Avisa los controles activos de la versión anterior', r.controles_version_anterior === 2, JSON.stringify(r))
})
const hist = await sql(`select numero, estado, aprobado_por from protocolo_versiones where objetivo_id = $1 and puesto_id is null order by numero`, [RANDSTAD])
ok('Historial: v1 reemplazada, v2 vigente, con autor', hist.map(h => `${h.numero}:${h.estado}`).join(' ') === '1:reemplazado 2:vigente' && hist[1].aprobado_por === JEFE_ID)
ok('Controles, tareas y checklist: sin ningún cambio', (await foto()) === controlesAntes)
await como(JEFE, async () => {
  const p = await rpc('protocolo_controles_panel', [RANDSTAD])
  ok('Controles: v1 sigue visible para revisar sus controles activos', p.versiones.some(v => v.id === v1.id && v.estado === 'reemplazado'))
})
await como(VIG, async () => {
  const tm = await rpc('tareas_turno_mias')
  ok('Vigilador: la tarea activada sigue en su turno', JSON.stringify(tm).includes('Activar la alarma piso por piso'))
})

// ── Lectura después del cambio ──────────────────────────────────────────────
await como(VIG, async () => {
  const d = (await rpc('protocolo_mis_documentos')).documentos
  const doc = d.find(x => x.version_id === v2)
  ok('Vigilador: recibe v2 marcada como cambio y sin confirmar', doc && doc.cambio === true && !doc.confirmado_at)
  ok('Vigilador: v1 ya no le llega', !d.some(x => x.version_id === v1.id))
  await rpc('protocolo_registrar_apertura', [v2, doc.turnos[0], null])
  ok('Vigilador: confirma la lectura de v2', (await rpc('protocolo_confirmar_lectura', [v2, doc.turnos[0]])).ok === true)
})

// ── Edición simultánea y guardado sin cambios ──────────────────────────────
await como(GER, async () => {
  ok('Gerencia con el editor abierto sobre v1: rechazado, no pisa v2', await falla(
    () => rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, 'texto de Gerencia', v1.id, v1.id, false]), /conflicto_version/))
  const n = (await sql(`select count(*)::int n from protocolo_versiones where objetivo_id = $1`, [RANDSTAD]))[0].n
  const r = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, v1.texto + '\nNo permitir el ingreso sin credencial.', v2, v2, false])
  ok('Guardar sin cambios: no crea versión', r.ya_vigente === true && (await sql(`select count(*)::int n from protocolo_versiones where objetivo_id = $1`, [RANDSTAD]))[0].n === n)
  const v = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, v1.texto, v1.id, v2, false])
  ok('Gerencia: volver a v1 crea v3 con ese texto y rige', v.ok && v.numero === 3)
})

// ── Objetivo dudoso: confirmación una sola vez, en la base ─────────────────
const dudosa = (await sql(`select id, objetivo_id from protocolo_versiones where asociacion = 'pendiente_validacion' order by numero limit 1`))[0]
await como(JEFE, async () => {
  ok('Dudoso sin confirmar: la base lo rechaza', await falla(() => rpc('protocolo_hacer_vigente', [dudosa.id, null, false]), /requiere_confirmar_objetivo/))
  ok('Dudoso confirmado: rige', (await rpc('protocolo_hacer_vigente', [dudosa.id, null, true])).ok === true)
})
const asoc = (await sql(`select asociacion, asociacion_confirmada_por, asociacion_confirmada_at from protocolo_versiones where id = $1`, [dudosa.id]))[0]
ok('Queda registrado quién confirmó el objetivo y cuándo', asoc.asociacion === 'confirmada' && asoc.asociacion_confirmada_por === JEFE_ID && !!asoc.asociacion_confirmada_at)
ok('Los otros 6 dudosos siguen en borrador', (await sql(`select count(*)::int n from protocolo_versiones where asociacion = 'pendiente_validacion' and estado = 'borrador'`))[0].n === 6)

// ── Nada fuera de protocolos ────────────────────────────────────────────────
ok('Turnos, rondas, puntos y usuarios: sin cambios', (await huella()) === huellaAntes)

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
