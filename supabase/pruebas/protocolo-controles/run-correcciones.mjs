// Pruebas de 20261023130000_protocolo_controles_correcciones.sql sobre
// PGlite: instrucciones completas desde citas, fin de la división por
// renglones, y supervisiones en curso al cambiar de plantilla.
// Uso: node supabase/pruebas/protocolo-controles/run-correcciones.mjs [raíz]
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
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'
const GENERICA = '00000000-0000-0000-0000-0000000000c1'
const SUP1_ID = '00000000-0000-0000-0000-000000002004'

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
// Rango en caracteres (code points) de una cita literal, desde una posición.
const rango = (texto, cita, desde = 0) => {
  const cps = Array.from(texto)
  const s = cps.join('')
  const idx = s.indexOf(cita, s.length === texto.length ? desde : desde)
  if (idx < 0) throw new Error('cita no encontrada: ' + cita.slice(0, 40))
  const inicio = Array.from(texto.slice(0, idx)).length
  return { inicio, fin: inicio + Array.from(cita).length }
}

// ── Carga: base de producción + 317 tal cual está aplicada + corrección ─────
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
// Supervisiones con el trigger ORIGINAL de producción (copiado de pg_proc).
await db.exec(`
create table public.supervisiones (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid references public.objetivos(id),
  supervisor_id uuid references public.usuarios(id), plantilla_id uuid references public.checklist_plantillas(id),
  estado text, observaciones text, created_at timestamptz default now());
create or replace function public.validar_supervision_plantilla() returns trigger language plpgsql as $f$
declare objetivo_plantilla uuid;
begin
  select checklist_plantilla_id into objetivo_plantilla from objetivos where id = new.objetivo_id;
  if objetivo_plantilla is not null then
    if new.plantilla_id is null then raise exception 'La supervision requiere plantilla para este objetivo'; end if;
    if new.plantilla_id <> objetivo_plantilla then raise exception 'La plantilla de la supervision no coincide con la plantilla del objetivo'; end if;
  end if;
  return new;
end; $f$;
create trigger trg_validar_supervision_plantilla before insert or update on public.supervisiones
  for each row execute function public.validar_supervision_plantilla();`)
for (const m of ['20261022120000_protocolos_objetivo', '20261022130000_protocolos_carga_inicial', '20261023120000_protocolo_controles_propuestos']) {
  await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
}
// Una supervisión vieja, guardada con la genérica antes de la corrección.
const supVieja = (await sql(`insert into supervisiones (objetivo_id, supervisor_id, plantilla_id, estado) values ($1, $2, $3, 'ok') returning id`, [RANDSTAD, SUP1_ID, GENERICA]))[0].id

const MIG = `${REPO}/supabase/migrations/20261023130000_protocolo_controles_correcciones.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Corrección idempotente (corre dos veces)', true)

const vRand = (await sql(`select id, texto from protocolo_versiones where objetivo_id = $1 and numero = 1`, [RANDSTAD]))[0]

// ── Permisos ────────────────────────────────────────────────────────────────
for (const [quien, uid] of [['Vigilador', VIG], ['Supervisor', SUP1], ['Administración', ADM], ['Jefe', JEFE]]) {
  await como(uid, async () => {
    ok(`${quien}: ya no puede dividir por renglones`, await falla(() => rpc('protocolo_instrucciones_segmentar', [vRand.id]), /permission denied|permiso/))
  })
}
await como(VIG, async () => {
  ok('Vigilador: no registra instrucciones', await falla(() => rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify([{ inicio: 0, fin: 10 }])]), /permiso/))
})
await como(SUP1, async () => {
  ok('Supervisor: no registra instrucciones', await falla(() => rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify([{ inicio: 0, fin: 10 }])]), /permiso/))
})

// ── Contexto y registro desde citas ─────────────────────────────────────────
// Citas como las devolvería la IA: una instrucción de varias oraciones, otra
// que en el texto cruza un salto de párrafo NO (cada una completa).
const CITAS = [
  'El vigilador ingresa a la guardia 7:30 hs y recorre los pisos desde el 7mo hasta el 1ro verificando que todo esté en orden.',
  'Al hacerse presente personal externo y de proveedores de servicio, el vigilador registrará los datos de identidad en el libro de novedades. Inmediatamente llamará al sector y oficina donde dice que debe dirigirse para anunciarlo y si le dan la autorización se le permitirá el acceso.',
  'Constatada la normalidad en las oficinas se procede a activar la alarma cerrando cada piso.',
]
let ids
await como(JEFE, async () => {
  const ctx = await rpc('protocolo_controles_contexto', [vRand.id])
  ok('Contexto: pide identificar y trae el texto completo', ctx.requiere_identificar === true && ctx.texto === vRand.texto && ctx.instrucciones.length === 0)
  let desde = 0
  const rangos = CITAS.map(c => { const r = rango(vRand.texto, c, desde); desde = r.fin; return r })
  ok('Superpuestas: rechazado', await falla(() => rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify([rangos[1], rangos[0]])]), /superpuesto/))
  ok('Fuera del texto: rechazado', await falla(() => rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify([{ inicio: 0, fin: 999999 }])]), /fuera del texto/))
  ok('Sólo espacios: rechazado', await falla(async () => {
    const i = vRand.texto.indexOf('\n\n')
    return rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify([{ inicio: i, fin: i + 2 }])])
  }, /sin texto/))
  ok('Vacío: rechazado', await falla(() => rpc('protocolo_instrucciones_registrar', [vRand.id, '[]']), /No llegaron/))
  const r = await rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify(rangos)])
  ids = r.ids
  ok('Jefe (Aldo): registra 3 instrucciones completas', r.ok && r.creadas === 3 && ids.length === 3)
  const r2 = await rpc('protocolo_instrucciones_registrar', [vRand.id, JSON.stringify(rangos)])
  ok('Segunda vez: ya identificadas, no duplica', r2.ya_segmentada === true)
  const ctx2 = await rpc('protocolo_controles_contexto', [vRand.id])
  ok('Contexto: instrucción de dos oraciones completa, texto literal', ctx2.requiere_identificar === false && ctx2.instrucciones[1].texto === CITAS[1])
})
const hashes = await sql(`select i.orden, i.texto_sha256 = encode(sha256(convert_to(substr(v.texto, i.inicio + 1, i.fin - i.inicio), 'UTF8')), 'hex') ok
  from protocolo_instrucciones i join protocolo_versiones v on v.id = i.version_id where i.version_id = $1 order by i.orden`, [vRand.id])
ok('Hash de cada instrucción = hash del fragmento original', hashes.length === 3 && hashes.every(h => h.ok))

// ── Flujo completo hasta activar (para probar supervisiones) ────────────────
await como(ADM, async () => { await rpc('protocolo_enviar_aprobacion', [vRand.id]) })
await como(GER, async () => { await rpc('protocolo_publicar', [vRand.id]) })
await como(JEFE, async () => {
  const reg = await rpc('protocolo_registrar_corrida_ia', [vRand.id, 'prueba', 10, 10, JSON.stringify([
    { instruccion_id: ids[2], clasificacion: 'obligacion', quien: 'vigilador', cuando: 'al cierre', destino: 'checklist_supervision',
      texto_item: 'Alarma activada piso por piso al cierre', criticidad: 'alta', foto_obligatoria: false, motivo: 'm',
      existente_tipo: null, existente_id: null },
  ]), null])
  ok('Corrida de IA registra la propuesta sobre la instrucción nueva', reg.creadas === 1)
})
const ctrl = (await sql(`select id from protocolo_controles_propuestos where instruccion_id = $1`, [ids[2]]))[0].id
await como(JEFE, async () => {
  await rpc('protocolo_instruccion_validar', [ids[2], 'obligacion', 'vigilador', 'al cierre'])
  ok('Jefe (Aldo): aprueba la propuesta', (await rpc('protocolo_control_aprobar', [ctrl])).ok === true)
  ok('Jefe (Aldo): no activa', await falla(() => rpc('protocolo_controles_activar', [RANDSTAD, `{${ctrl}}`]), /Solo Gerencia/))
})
// Supervisión "empezada" con la genérica: el supervisor ya tiene cargada esa plantilla.
await como(GER, async () => {
  const a = await rpc('protocolo_controles_activar', [RANDSTAD, `{${ctrl}}`])
  ok('Gerencia: activa → plantilla propia del objetivo', a.ok && a.plantilla_creada === true)
})
const propia = (await sql(`select checklist_plantilla_id p from objetivos where id = $1`, [RANDSTAD]))[0].p
ok('El objetivo pasó a su plantilla propia', propia !== GENERICA)

// ── Supervisiones en curso ──────────────────────────────────────────────────
const ins = (plantilla) => sql(`insert into supervisiones (objetivo_id, supervisor_id, plantilla_id, estado) values ($1, $2, $3, 'ok') returning id`, [RANDSTAD, SUP1_ID, plantilla])
ok('Supervisión empezada con la plantilla anterior: se guarda (dentro de 24 h)', (await ins(GENERICA)).length === 1)
ok('Supervisión con la plantilla nueva: se guarda', (await ins(propia)).length === 1)
ok('Supervisión vieja: se puede actualizar el estado', (await sql(`update supervisiones set estado = 'con_observacion' where id = $1 returning id`, [supVieja])).length === 1)
const otra = (await sql(`insert into checklist_plantillas (nombre) values ('otra') returning id`))[0].id
ok('Plantilla ajena: sigue rechazada', await falla(() => ins(otra), /no coincide/))
ok('Sin plantilla: sigue rechazada', await falla(() => ins(null), /requiere plantilla/))
ok('Cambiar la plantilla de una supervisión a una ajena: rechazado', await falla(() => sql(`update supervisiones set plantilla_id = $1 where id = $2`, [otra, supVieja]), /no coincide/))
await sql(`update checklist_plantillas set created_at = now() - interval '25 hours' where id = $1`, [propia])
ok('Pasadas 24 h: la plantilla anterior ya no vale', await falla(() => ins(GENERICA), /no coincide/))

// ── Texto editado: las instrucciones quedan obsoletas y se vuelven a identificar
let vManual
await como(ADM, async () => {
  const b = await rpc('protocolo_crear_borrador', [RANDSTAD, null, 'Manual', 'Abrir el portón.\nCerrar con llave al salir.', 'manual', null, null, null])
  vManual = b.id
})
await como(JEFE, async () => {
  const t = 'Abrir el portón.\nCerrar con llave al salir.'
  await rpc('protocolo_instrucciones_registrar', [vManual, JSON.stringify([rango(t, 'Abrir el portón.'), rango(t, 'Cerrar con llave al salir.')])])
})
await como(ADM, async () => { await rpc('protocolo_editar_borrador', [vManual, 'Manual', 'Abrir el portón principal.\nCerrar con llave al salir.', null]) })
await como(JEFE, async () => {
  const ctx = await rpc('protocolo_controles_contexto', [vManual])
  ok('Texto editado: el contexto pide volver a identificar', ctx.requiere_identificar === true)
  const t = 'Abrir el portón principal.\nCerrar con llave al salir.'
  const r = await rpc('protocolo_instrucciones_registrar', [vManual, JSON.stringify([rango(t, 'Abrir el portón principal.\nCerrar con llave al salir.')])])
  ok('Re-identificación: marca obsoletas las anteriores y registra la nueva (una instrucción de dos renglones)', r.creadas === 1 && r.obsoletas === 2)
})

// ── Verificación posterior y rollback ───────────────────────────────────────
const verif = await db.exec(readFileSync(`${REPO}/supabase/verificacion/protocolo_controles_correcciones_post_migracion.sql`, "utf8"))
// «Nada activado» describe producción al aplicar; acá se activó un control a propósito.
for (const v of verif.at(-1).rows) ok("Verificación: " + v.control, v.control === 'Nada activado' ? v.obtenido === '1' : v.ok === true, v.obtenido)
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261023130000_protocolo_controles_correcciones_rollback.sql`, "utf8"))
const tras = (await sql(`select count(*)::int n from pg_proc where proname = 'protocolo_instrucciones_registrar'`))[0].n
ok("Rollback: quita el registro desde citas", tras === 0)
ok("Rollback: el trigger original vuelve a exigir la plantilla actual", await falla(() => sql(`insert into supervisiones (objetivo_id, supervisor_id, plantilla_id) values ($1, $2, $3)`, [RANDSTAD, SUP1_ID, GENERICA]), /no coincide/))
await db.exec(readFileSync(MIG, "utf8"))
ok("Reaplicar la corrección después del rollback", true)

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
