/**
 * Lector a pedido del archivo histórico.
 *
 *   npm run visor              atiende pedidos y borra copias vencidas, en bucle
 *   npm run visor -- --una-vez atiende lo que haya, limpia y termina
 *
 * Variables (.env, nunca en Git):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VISOR_AGENTE_ID     identificador de esta máquina (p. ej. srv02-visor)
 *   VISOR_RAICES        PREFIJO=RUTA separados por ';' — el prefijo es el del
 *                       índice (p. ej. EMPLEADOS/) y la ruta, la carpeta local
 *                       de MEGA que le corresponde
 *   VISOR_INTERVALO_MS  espera entre consultas a la cola (default 3000)
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { Visor, leerRaices } from './Visor'

const log = {
  info: (m: string) => console.log(`[visor] ${new Date().toISOString()} ${m}`),
  warn: (m: string) => console.warn(`[visor] ${new Date().toISOString()} AVISO ${m}`),
  error: (m: string) => console.error(`[visor] ${new Date().toISOString()} ERROR ${m}`),
}

async function main() {
  const url = process.env.SUPABASE_URL, clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  const raicesTexto = process.env.VISOR_RAICES ?? ''
  if (!url || !clave || !raicesTexto) {
    log.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o VISOR_RAICES')
    process.exit(1)
  }
  const raices = leerRaices(raicesTexto)
  const visor = new Visor(
    createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } }),
    raices, process.env.VISOR_AGENTE_ID || 'visor', log,
  )
  const unaVez = process.argv.includes('--una-vez')
  const espera = Math.max(1000, Number(process.env.VISOR_INTERVALO_MS) || 3000)
  log.info(`Iniciado (${raices.length} carpeta(s) configurada(s)${unaVez ? ', una vez' : ''})`)

  let ultimaLimpieza = 0
  for (;;) {
    let atendio = false
    while (await visor.atenderUno()) atendio = true
    if (unaVez || Date.now() - ultimaLimpieza > 60_000) { await visor.limpiar(); ultimaLimpieza = Date.now() }
    if (unaVez) break
    if (!atendio) await new Promise(r => setTimeout(r, espera))
  }
}

main().catch(e => { log.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
