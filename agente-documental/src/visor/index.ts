/**
 * Lector a pedido del archivo documental (MEGA en SRV02).
 *
 *   npm run visor              atiende pedidos y borra copias vencidas, en bucle
 *   npm run visor -- --una-vez atiende lo que haya, limpia y termina
 *
 * Qué carpetas puede leer lo decide la base (documental_areas: sólo las
 * HABILITADAS), relativas a la raíz de MEGA (DOCUMENT_ROOT_PATH del .env del
 * agente). Se recargan cada minuto: habilitar o cerrar un área no requiere
 * tocar este servidor. Cada minuto manda un latido (documental_lectores).
 *
 * Variables (.env, nunca en Git):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DOCUMENT_ROOT_PATH
 *   VISOR_AGENTE_ID     identificador de esta máquina (p. ej. srv02-visor)
 *   VISOR_INTERVALO_MS  espera entre consultas a la cola (default 3000)
 *   VISOR_RAICES        SÓLO PARA PRUEBAS: PREFIJO=RUTA;... reemplaza a las
 *                       áreas de la base (por ejemplo, una carpeta aislada).
 *   EXPORTAR_CREDENCIALES  0 apaga la copia de las fotos de credenciales aprobadas
 *                       a ADMINISTRACION/POLICIA/CREDENCIALES (encendida por defecto; apagada en modo prueba).
 */

import 'dotenv/config'
import * as os from 'os'
import { createClient } from '@supabase/supabase-js'
import { Visor, leerRaices, raicesDeAreas } from './Visor'
import { Exportador } from './Exportador'

const VERSION = '2026-10-18'
const log = {
  info: (m: string) => console.log(`[visor] ${new Date().toISOString()} ${m}`),
  warn: (m: string) => console.warn(`[visor] ${new Date().toISOString()} AVISO ${m}`),
  error: (m: string) => console.error(`[visor] ${new Date().toISOString()} ERROR ${m}`),
}

async function main() {
  const url = process.env.SUPABASE_URL, clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  const base = process.env.DOCUMENT_ROOT_PATH ?? ''
  const prueba = process.env.VISOR_RAICES ?? ''
  if (!url || !clave || (!base && !prueba)) {
    log.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DOCUMENT_ROOT_PATH')
    process.exit(1)
  }
  const agente = process.env.VISOR_AGENTE_ID || 'visor'
  const supabase = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } })
  const visor = new Visor(supabase, [], agente, log)
  const exportar = !prueba && process.env.EXPORTAR_CREDENCIALES !== '0'
  const exportador = new Exportador(supabase, base, agente, log)
  const unaVez = process.argv.includes('--una-vez')
  const espera = Math.max(1000, Number(process.env.VISOR_INTERVALO_MS) || 3000)

  let areas: string[] = []
  const cargarAreas = async (): Promise<boolean> => {
    if (prueba) {
      const r = leerRaices(prueba)
      visor.usarRaices(r)
      areas = r.map(x => x[0])
      return true
    }
    const { data, error } = await supabase.rpc('documental_areas_lector')
    if (error) { log.error(`No se pudieron leer las áreas habilitadas: ${error.message}`); return false }
    const lista = (data as { codigo: string; prefijo: string }[] | null) ?? []
    const nuevas = lista.map(a => a.codigo).sort()
    if (nuevas.join() !== areas.join()) log.info(`Áreas habilitadas: ${nuevas.join(', ') || 'ninguna'}`)
    areas = nuevas
    visor.usarRaices(raicesDeAreas(lista, base))
    return true
  }
  const latido = (estado: 'activo' | 'detenido') => supabase.rpc('documental_lector_latido', {
    p_agente: agente, p_estado: estado,
    p_info: { version: VERSION, areas, pid: process.pid, host: os.hostname(), modo: prueba ? 'prueba' : 'normal', exporta_credenciales: exportar },
  }).then(({ error }) => { if (error) log.warn(`No se pudo registrar el latido: ${error.message}`) })

  let deteniendo = false
  const detener = async (motivo: string) => {
    if (deteniendo) return
    deteniendo = true
    log.info(`Deteniendo (${motivo})`)
    await latido('detenido')
    process.exit(0)
  }
  process.on('SIGINT', () => void detener('SIGINT'))
  process.on('SIGTERM', () => void detener('SIGTERM'))
  process.on('SIGBREAK', () => void detener('SIGBREAK'))

  if (!(await cargarAreas())) process.exit(1)
  log.info(`Iniciado v${VERSION} (${prueba ? 'MODO PRUEBA: carpetas de VISOR_RAICES' : 'áreas de la base'}; ${areas.length} área(s))`)
  await latido('activo')

  let ultimoMinuto = Date.now()
  for (;;) {
    let atendio = false
    while (!deteniendo && await visor.atenderUno()) atendio = true
    if (unaVez || Date.now() - ultimoMinuto > 60_000) {
      await visor.limpiar()
      // Copias de credenciales aprobadas: una vez por minuto alcanza.
      if (exportar) await exportador.atender()
      await cargarAreas()
      await latido('activo')
      ultimoMinuto = Date.now()
    }
    if (unaVez) { await latido('detenido'); break }
    if (!atendio) await new Promise(r => setTimeout(r, espera))
  }
}

main().catch(e => { log.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
