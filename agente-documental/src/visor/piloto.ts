/**
 * Piloto del visor: prueba de punta a punta con 1 o 2 archivos del índice.
 *
 *   npm run visor:piloto -- <repositorio_id> [<repositorio_id>]
 *
 * Usar sólo archivos de prueba o expresamente autorizados (el piloto propuesto:
 * el anexo del CCT 507 y el formulario de inducción en blanco, sin datos
 * personales). Requiere el mismo .env que `npm run visor`.
 *
 * Comprueba, en orden:
 *   1. pedido creado (como pedido de sistema, marcado «piloto»);
 *   2. el lector lo toma, lee el archivo SIN modificarlo y verifica el hash;
 *   3. la copia está en el bucket PRIVADO: sin firma, no se descarga;
 *   4. con enlace firmado de 60 s se descarga y el hash coincide;
 *   5. el mismo enlace, pasados 65 s, ya no sirve (vencimiento del ENLACE);
 *   6. la copia sigue existiendo hasta su retención (vencimiento distinto);
 *   7. vencida la retención, la limpieza la borra y ya no se puede firmar;
 *   8. el archivo original no cambió (mismo hash y fecha de modificación).
 * La autorización por rol (Administración/Gerencia sí; Supervisión,
 * Dirección Operativa y vigiladores no) se prueba en la base aparte.
 */

import 'dotenv/config'
import * as crypto from 'crypto'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { BUCKET, Visor, leerRaices, resolverRuta } from './Visor'

const sha = (b: Buffer | Uint8Array) => crypto.createHash('sha256').update(b).digest('hex')
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
let fallas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) fallas++ }

async function main() {
  const ids = process.argv.slice(2).filter(a => /^[0-9a-f-]{36}$/i.test(a)).slice(0, 2)
  if (!ids.length) { console.error('Indicá 1 o 2 repositorio_id'); process.exit(1) }
  const url = process.env.SUPABASE_URL!, clave = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const raices = leerRaices(process.env.VISOR_RAICES ?? '')
  const sb = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } })
  const visor = new Visor(sb, raices, `${process.env.VISOR_AGENTE_ID || 'visor'}-piloto`, {
    info: m => console.log(`  [visor] ${m}`), warn: m => console.log(`  [visor] AVISO ${m}`), error: m => console.log(`  [visor] ERROR ${m}`),
  })

  for (const repoId of ids) {
    console.log(`\n── Archivo ${repoId}`)
    const { data: r } = await sb.from('repositorio_documental').select('id, ruta_relativa, hash_sha256, extension').eq('id', repoId).single()
    if (!r) { ok(false, 'existe en el índice'); continue }
    const local = resolverRuta(r.ruta_relativa, raices)
    ok(!!local, 'la ruta del índice corresponde a una carpeta configurada')
    if (!local) continue
    const antes = fs.statSync(local)

    const { data: v, error: eV } = await sb.from('legajo_historico_vistas').insert({
      repositorio_id: r.id, ruta_relativa: r.ruta_relativa, hash_esperado: String(r.hash_sha256).toLowerCase(),
      extension: String(r.extension).toLowerCase(), motivo: 'Piloto del visor',
    }).select('id').single()
    ok(!eV && !!v, '1. pedido creado')
    if (!v) continue

    // Atender exactamente este pedido (si hubiera otros en cola, se atienden también).
    for (let i = 0; i < 5; i++) {
      await visor.atenderUno()
      const { data: e } = await sb.from('legajo_historico_vistas').select('estado').eq('id', v.id).single()
      if (e?.estado !== 'pendiente') break
    }
    const { data: lista } = await sb.from('legajo_historico_vistas').select('estado, objeto, hash_leido, expira_at, lista_at, error').eq('id', v.id).single()
    ok(lista?.estado === 'lista', `2. el lector lo dejó listo con el hash verificado (${lista?.estado}${lista?.error ? ': ' + lista.error : ''})`)
    if (lista?.estado !== 'lista') continue
    ok(lista.hash_leido === String(r.hash_sha256).toLowerCase(), '   hash leído = hash del índice')

    const publica = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${lista.objeto}`)
    ok(publica.status >= 400, `3. sin firma no se descarga (HTTP ${publica.status})`)
    const anon = process.env.SUPABASE_ANON_KEY
    if (anon) {
      const r2 = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${lista.objeto}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      ok(r2.status >= 400, `   con la clave pública tampoco (HTTP ${r2.status})`)
    }

    const { data: firmado } = await sb.storage.from(BUCKET).createSignedUrl(lista.objeto, 60)
    const t0 = Date.now()
    const d1 = await fetch(firmado!.signedUrl)
    const b1 = Buffer.from(await d1.arrayBuffer())
    ok(d1.ok && sha(b1) === lista.hash_leido, `4. con enlace de 60 s se descarga y el hash coincide (HTTP ${d1.status})`)

    await esperar(Math.max(0, 65_000 - (Date.now() - t0)))
    const d2 = await fetch(firmado!.signedUrl)
    ok(d2.status >= 400, `5. el mismo enlace a los 65 s ya no sirve (HTTP ${d2.status})`)

    const { data: sigue } = await sb.storage.from(BUCKET).createSignedUrl(lista.objeto, 60)
    ok(!!sigue?.signedUrl && (await fetch(sigue.signedUrl)).ok, '6. la copia sigue hasta su retención (el enlace vence antes que la copia)')

    // Forzar el fin de la retención para no esperar 10 minutos.
    await sb.from('legajo_historico_vistas').update({ expira_at: new Date(Date.now() - 1000).toISOString() }).eq('id', v.id)
    const borradas = await visor.limpiar()
    const { data: fin } = await sb.from('legajo_historico_vistas').select('estado, eliminada_at').eq('id', v.id).single()
    ok(borradas >= 1 && fin?.estado === 'eliminada' && !!fin.eliminada_at, '7. vencida la retención, la limpieza la borra')
    const { data: listado } = await sb.storage.from(BUCKET).list('', { search: v.id })
    ok(!(listado ?? []).length, '   la copia ya no está en el bucket')

    const despues = fs.statSync(local)
    ok(sha(fs.readFileSync(local)) === String(r.hash_sha256).toLowerCase() && despues.mtimeMs === antes.mtimeMs, '8. el original no cambió (hash y fecha)')
  }
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nPILOTO OK')
  process.exit(fallas ? 1 : 0)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
