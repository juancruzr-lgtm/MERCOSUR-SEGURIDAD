// Pruebas de 20261025120000_protocolos_ultima_rige.sql sobre PGlite: guardar
// deja vigente, la anterior queda en el historial, el vigilador ve la nueva y
// confirma de nuevo, permisos por puesto y zona, nada se publica al aplicar.
// Uso: node supabase/pruebas/protocolos/run-ultima-rige.mjs [raíz del repo]
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
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', ACA = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'
const RAPSODIA = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'

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
const estados = async (obj) => (await sql(`select numero, estado from protocolo_versiones where objetivo_id = $1 order by numero`, [obj])).map(r => `${r.numero}:${r.estado}`).join(' ')

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial', '20261025120000_protocolos_ultima_rige', '20261025120000_protocolos_ultima_rige']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}
ok('Migración idempotente y no publica nada al aplicarse', (await sql(`select count(*)::int n from protocolo_versiones where estado <> 'borrador'`))[0].n === 0)

const v1 = (await sql(`select id, texto, titulo from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0]

for (const [quien, uid] of [['Vigilador', VIG], ['Supervisor', SUP1]]) {
  await como(uid, async () => {
    ok(`${quien}: no hace regir`, await falla(() => rpc('protocolo_hacer_vigente', [v1.id]), /permiso/))
    ok(`${quien}: no guarda`, await falla(() => rpc('protocolo_guardar', [RANDSTAD, null, 't', 'x', null]), /permiso/))
  })
}

// Jefe de supervisores (Aldo): hace regir el texto original de Aldo.
await como(JEFE, async () => {
  const r = await rpc('protocolo_hacer_vigente', [v1.id])
  ok('Jefe (Aldo): hace regir el borrador original en un paso', r.ok && r.ya_vigente === false)
})
ok('Randstad v1 vigente', (await estados(RANDSTAD)) === '1:vigente')
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador: ya la ve', d.documentos.length === 1 && d.documentos[0].numero === 1)
  await rpc('protocolo_registrar_apertura', [v1.id, null, null])
  await rpc('protocolo_confirmar_lectura', [v1.id, null])
})

// Administración edita y guarda: la nueva rige, la anterior queda reemplazada.
let v2
await como(ADM, async () => {
  const r = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, v1.texto + '\n\nNueva: verificar el portón trasero al ingresar.', v1.id])
  v2 = r.id
  ok('Administración: guardar deja la versión nueva vigente', r.ok && r.reemplazo === v1.id && r.numero === 2)
})
ok('Historial: v1 reemplazada, v2 vigente', (await estados(RANDSTAD)) === '1:reemplazado 2:vigente')
const fuente = (await sql(`select fuente_descripcion, texto from protocolo_versiones where id = $1`, [v2]))[0]
ok('La fuente dice de qué versión sale', /sobre la version 1/.test(fuente.fuente_descripcion))
ok('El texto original de Aldo sigue intacto en v1', (await sql(`select texto from protocolo_versiones where id = $1`, [v1.id]))[0].texto === v1.texto)
await como(VIG, async () => {
  const d = await rpc('protocolo_mis_documentos')
  ok('Vigilador: ve la nueva, sin confirmar (confirma de nuevo)', d.documentos.length === 1 && d.documentos[0].version_id === v2 && !d.documentos[0].confirmado_at)
})

// Guardar sin cambios no duplica.
await como(GER, async () => {
  const r = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, fuente.texto, v2])
  ok('Guardar sin cambios no crea otra versión', r.ya_vigente === true && r.id === v2)
})
// Volver atrás: guardar el texto de v1 crea v3 vigente (v1 no se reactiva).
await como(GER, async () => {
  const r = await rpc('protocolo_guardar', [RANDSTAD, null, v1.titulo, v1.texto, v1.id])
  ok('Volver a una versión anterior: queda como versión nueva vigente', r.numero === 3)
  ok('Una reemplazada no se hace regir directamente', await falla(() => rpc('protocolo_hacer_vigente', [v1.id]), /guardarla de nuevo/))
})
ok('Historial completo: 1 y 2 reemplazadas, 3 vigente', (await estados(RANDSTAD)) === '1:reemplazado 2:reemplazado 3:vigente')

// Coincidencia probable (ACA): hacerla regir desde su ficha confirma el objetivo.
const vAca = (await sql(`select id from protocolo_versiones where objetivo_id = $1 and numero = 1`, [ACA]))[0].id
await como(JEFE, async () => { await rpc('protocolo_hacer_vigente', [vAca]) })
const aca = (await sql(`select estado, asociacion, asociacion_confirmada_por is not null c from protocolo_versiones where id = $1`, [vAca]))[0]
ok('ACA: rige y queda confirmado el objetivo, con quién lo hizo', aca.estado === 'vigente' && aca.asociacion === 'confirmada' && aca.c)

// Rapsodia: dos borradores; el que se hace regir manda, el otro queda borrador.
const [r1, r2] = (await sql(`select id from protocolo_versiones where objetivo_id = $1 order by numero`, [RAPSODIA])).map(r => r.id)
await como(GER, async () => { await rpc('protocolo_hacer_vigente', [r2]) })
ok('Rapsodia: rige la elegida, la otra sigue en borrador', (await estados(RAPSODIA)) === '1:borrador 2:vigente')
await como(GER, async () => { await rpc('protocolo_hacer_vigente', [r1]) })
ok('Rapsodia: hacer regir la otra reemplaza la anterior', (await estados(RAPSODIA)) === '1:vigente 2:reemplazado')

ok('Inmutabilidad intacta: la vigente no cambia su texto', await falla(() => sql(`update protocolo_versiones set texto = 'x' where id = $1`, [v2]), /no se modifica/))

// Rollback
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261025120000_protocolos_ultima_rige_rollback.sql`, 'utf8'))
ok('Rollback: quita las funciones y deja las versiones', (await sql(`select count(*)::int n from pg_proc where proname in ('protocolo_guardar','protocolo_hacer_vigente')`))[0].n === 0
  && (await estados(RANDSTAD)) === '1:reemplazado 2:reemplazado 3:vigente')

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
