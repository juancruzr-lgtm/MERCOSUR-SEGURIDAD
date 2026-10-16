// Pruebas de 20261026120000_checklist_solo_supervisor.sql sobre PGlite:
// agregar al checklist en un paso, quién puede, y cierre de lo que no es del
// checklist del supervisor.
// Uso: node supabase/pruebas/protocolo-controles/run-solo-supervisor.mjs [raíz]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), VIG = AUTH(6)
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', CASONA = '335179ef-af0e-41e7-9a38-66a2da661f48'
const GENERICA = '00000000-0000-0000-0000-0000000000c1'

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

// ── Carga: lo que está en producción + esta migración ───────────────────────
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(`create table public.supervisiones (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid references public.objetivos(id),
  supervisor_id uuid references public.usuarios(id), plantilla_id uuid references public.checklist_plantillas(id),
  estado text, observaciones text, created_at timestamptz default now());`)
for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial',
  '20261023120000_protocolo_controles_propuestos', '20261023130000_protocolo_controles_correcciones']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}

// Instrucciones de Randstad v1 y de La Casona v1 (una por párrafo), como las
// registra la IA. El trigger calcula el hash.
const instrucciones = async (obj) => {
  const v = (await sql(`select id, texto from protocolo_versiones where objetivo_id = $1 and numero = 1`, [obj]))[0]
  const cps = Array.from(v.texto)
  let pos = 0, orden = 0
  for (const linea of v.texto.split('\n')) {
    const largo = Array.from(linea).length
    const lead = largo - Array.from(linea.replace(/^[\s]+/, '')).length
    const core = linea.trim()
    if (core) {
      orden++
      await sql(`insert into protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256)
                 values ($1, $2, $3, $4, $5, repeat('0',64))`, [v.id, obj, orden, pos + lead, pos + lead + Array.from(core).length])
    }
    pos += largo + 1
  }
  void cps
  return (await sql(`select id, orden from protocolo_instrucciones where version_id = $1 order by orden`, [v.id])).map(r => r.id)
}
const iRand = await instrucciones(RANDSTAD)
const iCas = await instrucciones(CASONA)

// Antes de la migración: lo que dejó la prueba de CIRSE (una tarea, una ronda)
// y un punto de checklist propuesto.
let cTarea, cRonda, cCheck, cCheck2, cDup, cCasona, cDescartar
await como(JEFE, async () => {
  cTarea = (await rpc('protocolo_control_proponer', [iRand[1], 'tarea_turno', 'Ingreso y relevo', 'normal', false])).id
  cRonda = (await rpc('protocolo_control_proponer', [iRand[2], 'punto_ronda', 'Recorrer los pisos', 'normal', false])).id
  cCheck = (await rpc('protocolo_control_proponer', [iRand[3], 'checklist_supervision', 'Libro con datos de personal externo', 'alta', true])).id
  cCheck2 = (await rpc('protocolo_control_proponer', [iRand[4], 'checklist_supervision', 'Planilla de encomiendas al día', 'normal', false])).id
  cDup = (await rpc('protocolo_control_proponer', [iRand[5], 'checklist_supervision', 'Uniforme completo del vigilador', 'normal', false])).id
  cDescartar = (await rpc('protocolo_control_proponer', [iRand[0], 'checklist_supervision', 'Título', 'normal', false])).id
  cCasona = (await rpc('protocolo_control_proponer', [iCas[1], 'checklist_supervision', 'Recorridas cada 2 horas', 'normal', false])).id
  await rpc('protocolo_instruccion_validar', [iRand[1], 'obligacion', null, null])
  await rpc('protocolo_control_aprobar', [cTarea])
})

const MIG = `${REPO}/supabase/migrations/20261026120000_checklist_solo_supervisor.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)

const estado = async id => (await sql(`select estado, motivo_rechazo from protocolo_controles_propuestos where id = $1`, [id]))[0]
ok('Tarea del turno aprobada: cerrada como descartada con motivo', (await estado(cTarea)).estado === 'rechazado' && /solo se proponen puntos del checklist/.test((await estado(cTarea)).motivo_rechazo))
ok('Punto de ronda propuesto: cerrado como descartado', (await estado(cRonda)).estado === 'rechazado')
ok('Los puntos del checklist siguen propuestos', (await estado(cCheck)).estado === 'propuesto' && (await estado(cCasona)).estado === 'propuesto')

// La genérica tiene «Uniforme completo del vigilador»? No: se agrega para probar duplicados.
await sql(`insert into checklist_items (plantilla_id, texto, orden) values ($1, 'Uniforme completo del vigilador', 4)`, [GENERICA])

// ── Quién puede ─────────────────────────────────────────────────────────────
await como(VIG, async () => {
  ok('Vigilador: no agrega', await falla(() => rpc('protocolo_control_agregar_checklist', [cCheck, null]), /permiso/))
})
await como(SUP1, async () => {
  ok('Supervisor de zona: no agrega', await falla(() => rpc('protocolo_control_agregar_checklist', [cCheck, null]), /permiso/))
})
await como(null, async () => {
  ok('Sin sesión: no agrega', await falla(() => rpc('protocolo_control_agregar_checklist', [cCheck, null]), /permiso/))
})

// ── Sólo desde el protocolo que rige ────────────────────────────────────────
await como(JEFE, async () => {
  ok('Borrador: no agrega (hay que guardar el protocolo)', await falla(() => rpc('protocolo_control_agregar_checklist', [cCheck, null]), /protocolo que rige/))
})
ok('Tras el intento fallido nada cambió (sigue propuesto, sin plantilla propia)', (await estado(cCheck)).estado === 'propuesto'
  && (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [RANDSTAD]))[0].p === GENERICA)
const vRand = (await sql(`select id from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0].id
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [vRand]) })
await como(GER, async () => { await rpc('protocolo_publicar', [vRand]) })

// ── Agregar en un paso (jefe de supervisores) ───────────────────────────────
await como(JEFE, async () => {
  const r = await rpc('protocolo_control_agregar_checklist', [cCheck, null])
  ok('Jefe de supervisores: agrega en un paso y se crea la plantilla propia', r.ok === true && r.plantilla_creada === true && r.items_nuevos === 1 && r.ya_estaba === false, JSON.stringify(r))
  const r2 = await rpc('protocolo_control_agregar_checklist', [cCheck, null])
  ok('Agregar dos veces: no duplica', r2.ya_estaba === true)
})
const propia = (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [RANDSTAD]))[0].p
const items = await sql(`select texto, criticidad, foto_obligatoria, origen_instruccion_id from checklist_items where plantilla_id = $1 and activo order by orden`, [propia])
ok('Plantilla propia: copia de la genérica (4) + el punto, con su instrucción de origen', propia !== GENERICA && items.length === 5
  && items[4].texto === 'Libro con datos de personal externo' && items[4].origen_instruccion_id === iRand[3]
  && items[4].criticidad === 'alta' && items[4].foto_obligatoria === true, JSON.stringify(items))
const ins3 = (await sql(`select clasificacion, validada_at is not null v from protocolo_instrucciones where id = $1`, [iRand[3]]))[0]
ok('La instrucción de origen queda registrada como obligación, sin pedirle a nadie que la valide', ins3.v && ins3.clasificacion === 'obligacion')
ok('El control queda activado con quién y cuándo', (await sql(`select estado, activado_por is not null a, aprobado_por is not null b from protocolo_controles_propuestos where id = $1`, [cCheck]))[0].estado === 'activado')
ok('La genérica no cambió (4 ítems) y La Casona la sigue usando', (await sql(`select count(*)::int n from checklist_items where plantilla_id = $1`, [GENERICA]))[0].n === 4
  && (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [CASONA]))[0].p === GENERICA)

// ── Corregir, duplicados, descartados ───────────────────────────────────────
await como(ADM, async () => {
  const r = await rpc('protocolo_control_agregar_checklist', [cCheck2, '  Planilla de encomiendas enviadas y recibidas al día  '])
  ok('Administración: agrega con el texto corregido y reutiliza la plantilla propia', r.plantilla_creada === false && r.plantilla_id === propia && r.items_nuevos === 1)
  const d = await rpc('protocolo_control_agregar_checklist', [cDup, 'uniforme completo del vigilador.'])
  ok('Ya está en el checklist (mismo texto, otra forma): no agrega y dice con qué coincide', d.ok === false && d.motivo === 'ya_existe' && d.existente === 'Uniforme completo del vigilador')
  await rpc('protocolo_control_rechazar', [cDescartar, 'Descartado'])
  ok('Descartado: no se agrega', await falla(() => rpc('protocolo_control_agregar_checklist', [cDescartar, null]), /descartado/))
  ok('Un punto de otro objetivo en borrador: no se agrega', await falla(() => rpc('protocolo_control_agregar_checklist', [cCasona, null]), /protocolo que rige/))
})
ok('El texto corregido es el que quedó en el checklist', (await sql(`select count(*)::int n from checklist_items where plantilla_id = $1 and texto = 'Planilla de encomiendas enviadas y recibidas al día' and origen_instruccion_id = $2`, [propia, iRand[4]]))[0].n === 1)
ok('El duplicado quedó marcado con lo que ya existe', (await sql(`select existente_tipo from protocolo_controles_propuestos where id = $1`, [cDup]))[0].existente_tipo === 'checklist_item')
ok('Sólo 6 ítems en la propia (4 copiados + 2)', (await sql(`select count(*)::int n from checklist_items where plantilla_id = $1 and activo`, [propia]))[0].n === 6)

// ── Rondas y textos intactos ────────────────────────────────────────────────
ok('Rondas intactas', (await sql(`select count(*)::int n from rondas_base`))[0].n === 2 && (await sql(`select count(*)::int n from ronda_puntos`))[0].n === 2)
ok('Textos de protocolos con hash intacto', (await sql(`select count(*)::int n from protocolo_versiones where texto_sha256 <> encode(sha256(convert_to(texto,'UTF8')),'hex')`))[0].n === 0)

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261026120000_checklist_solo_supervisor_rollback.sql`, 'utf8'))
ok('Rollback: quita la función nueva', (await sql(`select count(*)::int n from pg_proc where proname = 'protocolo_control_agregar_checklist'`))[0].n === 0)
await como(JEFE, async () => {
  ok('Rollback: activar vuelve a ser sólo de Gerencia', await falla(() => rpc('protocolo_controles_activar', [RANDSTAD, [cCheck2]]), /Solo Gerencia/))
})
await db.exec(readFileSync(MIG, 'utf8'))
ok('Reaplicar después del rollback', true)

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
