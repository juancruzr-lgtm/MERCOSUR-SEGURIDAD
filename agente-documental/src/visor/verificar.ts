/**
 * Verificación previa del lector en SRV02. NO escribe nada: no crea pedidos,
 * no sube archivos, no toca el índice ni MEGA.
 *
 *   npm run visor:verificar
 *
 * Comprueba:
 *   1. que el .env tenga las variables (sin mostrar sus valores);
 *   2. que la clave sea de servicio (puede usar las funciones del lector);
 *   3. que el bucket temporal exista y sea privado;
 *   4. que VISOR_RAICES lleve a los 2 PDF del piloto y que su hash local sea
 *      el del índice (lectura);
 *   5. cuántos pedidos hay en cola.
 */

import 'dotenv/config'
import * as crypto from 'crypto'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { BUCKET, leerRaices, resolverRuta } from './Visor'

export const PILOTO = [
  { id: '7cc0f6e4-8e0a-40d3-9346-87f95df16506', nombre: 'Anexo CCT 507' },
  { id: 'ec57ca0e-aad6-48f2-88d2-13a73f7847ec', nombre: 'Formulario de inducción en blanco' },
]

let fallas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) fallas++ }

async function main() {
  const vars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VISOR_RAICES', 'VISOR_AGENTE_ID']
  for (const v of vars) ok(!!process.env[v], `1. variable ${v} ${process.env[v] ? 'presente' : 'FALTA'}`)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.VISOR_RAICES) return fin()

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: eRpc } = await sb.rpc('legajo_historico_vistas_a_borrar')
  ok(!eRpc, `2. la clave puede usar las funciones del lector${eRpc ? ` (${eRpc.message})` : ''}`)

  const { data: bucket, error: eB } = await sb.storage.getBucket(BUCKET)
  ok(!eB && !!bucket && bucket.public === false, `3. bucket ${BUCKET} ${bucket ? (bucket.public ? 'PÚBLICO' : 'privado') : 'inexistente'}`)

  let raices: [string, string][] = []
  try { raices = leerRaices(process.env.VISOR_RAICES) } catch (e) { ok(false, `4. VISOR_RAICES: ${(e as Error).message}`) }
  for (const [prefijo, ruta] of raices) ok(fs.existsSync(ruta), `4. carpeta para «${prefijo}» ${fs.existsSync(ruta) ? 'existe' : 'NO existe'}`)
  for (const p of PILOTO) {
    const { data: r } = await sb.from('repositorio_documental').select('ruta_relativa, hash_sha256').eq('id', p.id).maybeSingle()
    if (!r) { ok(false, `4. ${p.nombre}: no está en el índice`); continue }
    const local = resolverRuta(r.ruta_relativa, raices)
    if (!local) { ok(false, `4. ${p.nombre}: ningún prefijo de VISOR_RAICES corresponde a su ruta del índice`); continue }
    if (!fs.existsSync(local)) { ok(false, `4. ${p.nombre}: no está en la carpeta configurada`); continue }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex')
    ok(hash === String(r.hash_sha256).toLowerCase(), `4. ${p.nombre}: ${hash === String(r.hash_sha256).toLowerCase() ? 'hash igual al índice' : 'HASH DISTINTO al índice'}`)
  }

  const { count } = await sb.from('legajo_historico_vistas').select('id', { count: 'exact', head: true }).in('estado', ['pendiente', 'tomada'])
  console.log(`     5. pedidos en cola: ${count ?? 0}`)
  fin()
}

function fin() {
  console.log(fallas ? `\n${fallas} FALLA(S): corregir antes del piloto` : '\nLISTO PARA EL PILOTO')
  process.exit(fallas ? 1 : 0)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
