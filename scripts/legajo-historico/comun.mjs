// Legajo Digital — utilidades de los scripts del archivo histórico.
// Sin datos: todo lo sensible se lee de archivos FUERA del repositorio.

import { createHash } from 'crypto'

export function argumentos(argv = process.argv.slice(2)) {
  const a = {}
  for (const x of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(x)
    if (m) a[m[1]] = m[2] ?? true
  }
  return a
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** Tipo real por los primeros bytes (mismo criterio que lib/documentacion-archivo.ts). */
export function mimeReal(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'application/pdf'
  return null
}

export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
export const MAX_BYTES = 15 * 1024 * 1024

/** Tipos del clasificador → código del catálogo (documentacion_tipos). */
export const TIPO_CATALOGO = {
  dni: 'dni', cuil: 'cuil', domicilio: 'domicilio', antecedentes_provincia: 'antecedentes_provincia',
  antecedentes_rnr: 'antecedentes_rnr', credencial: 'credencial', acta_credencial: 'acta_credencial',
  estudios_medicos: 'estudios_medicos', alta_arca: 'alta_arca', codem: 'codem', secundario: 'secundario',
  cursos: 'cursos', sindicato: 'sindicato', embargos: 'embargos', sanciones: 'sanciones',
  cartas_documento: 'cartas_documento', baja_arca: 'baja_arca', legal: 'actuaciones_legales',
  // Adicionales H-9 (inactivos en el catálogo hasta que se aprueben)
  solicitud_empleo: 'solicitud_empleo', art: 'alta_art', svo: 'svo', art51: 'art51', epp: 'entrega_epp',
}

/**
 * Lo que NUNCA se propone al legajo: recibos y sueldos (importes de
 * Liquidación), contratos de clientes, homologaciones y egresos sin otro tipo.
 */
export const TIPOS_FUERA_DEL_LEGAJO = new Set(['recibo', 'contrato', 'homologacion', 'egreso'])

export function clienteServicio() {
  const url = process.env.SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno')
  return import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } }))
}

/** Ejecutar exige el flag Y la confirmación en el entorno: nunca por descuido. */
export function exigirAutorizacion(a, variable) {
  if (!a.ejecutar) return false
  if (process.env[variable] !== 'si') {
    console.error(`Para ejecutar hace falta --ejecutar y ${variable}=si (autorización expresa de JC).`)
    process.exit(2)
  }
  return true
}

export const contar = (m, k) => { m[k] = (m[k] ?? 0) + 1 }
