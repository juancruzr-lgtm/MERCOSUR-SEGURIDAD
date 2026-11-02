// lib/rondas-validacion.ts
//
// Regla de validación de puntos de ronda aprobada por Gerencia (noviembre 2026).
// Espejo EXACTO de las funciones SQL rondas_estado_foto_punto y
// rondas_veredicto_punto (supabase/migrations/20261120120000). Si cambia una,
// cambia la otra: tests/rondas-validacion.test.ts fija los casos.
//
// Un punto está cumplido cuando existe al menos UNA evidencia válida:
//   GPS dentro del radio  →  QR verificado  →  foto aceptada (IA o persona).
// El orden es sólo de prioridad para registrar CUÁL lo validó: el GPS nunca
// invalida un QR válido ni una foto aceptada. Una foto todavía sin analizar no
// acepta ni condena: el punto queda «pendiente de validación».
//
// Lógica pura. No consulta nada, no escribe nada.

export type EstadoFotoPunto =
  | 'sin_foto'
  | 'pendiente'          // hay foto y todavía no hay veredicto (sin análisis, en proceso o con error)
  | 'aceptada_ia'        // la IA la clasificó SIN_OBSERVACIONES y nadie la contradijo
  | 'aceptada_revision'  // una persona la marcó CORRECTO
  | 'rechazada'          // IA la observó (REVISAR / EVIDENCIA_INSUFICIENTE) o una persona la marcó INCORRECTO

export type ValidadoPor = 'gps' | 'qr' | 'foto_ia' | 'revision'

export type EstadoPuntoValidado = 'cumplido' | 'incumplido' | 'pendiente_validacion'

export type AnalisisFoto = {
  estado: string                       // pendiente | procesando | completado | error | error_definitivo
  clasificacion_efectiva?: string | null
  clasificacion_ia?: string | null
  revision_estado?: string | null      // PENDIENTE | CORRECTO | INCORRECTO | SANEADO
  revisado_at?: string | null
  analizado_at?: string | null
  created_at?: string | null
}

function ms(iso?: string | null): number {
  if (!iso) return -Infinity
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/** Veredicto de UN análisis. Misma tabla de verdad que el CASE del SQL. */
export function veredictoAnalisis(a: AnalisisFoto): Exclude<EstadoFotoPunto, 'sin_foto'> {
  if (a.revision_estado === 'CORRECTO') return 'aceptada_revision'
  if (a.revision_estado === 'INCORRECTO') return 'rechazada'
  if (a.estado !== 'completado') return 'pendiente'
  const clase = a.clasificacion_efectiva ?? a.clasificacion_ia
  return clase === 'SIN_OBSERVACIONES' ? 'aceptada_ia' : 'rechazada'
}

/**
 * Por foto vale UN análisis: primero el que tiene decisión humana, después el
 * completado más reciente. Mismo ORDER BY que el SQL.
 */
export function analisisVigente(analisis: AnalisisFoto[]): AnalisisFoto | null {
  if (analisis.length === 0) return null
  const humano = (a: AnalisisFoto) => (a.revision_estado === 'CORRECTO' || a.revision_estado === 'INCORRECTO') ? 1 : 0
  const completo = (a: AnalisisFoto) => (a.estado === 'completado' ? 1 : 0)
  return [...analisis].sort((x, y) =>
    (humano(y) - humano(x))
    || (completo(y) - completo(x))
    || (ms(y.revisado_at) - ms(x.revisado_at))
    || (ms(y.analizado_at) - ms(x.analizado_at))
    || (ms(y.created_at) - ms(x.created_at)),
  )[0]
}

/** Estado de la foto de un punto a partir de los análisis de cada foto. */
export function estadoFotoPunto(fotos: AnalisisFoto[][]): EstadoFotoPunto {
  if (fotos.length === 0) return 'sin_foto'
  const v = fotos.map(an => {
    const a = analisisVigente(an)
    return a ? veredictoAnalisis(a) : 'pendiente'
  })
  if (v.includes('aceptada_revision')) return 'aceptada_revision'
  if (v.includes('aceptada_ia')) return 'aceptada_ia'
  if (v.includes('pendiente')) return 'pendiente'
  return 'rechazada'
}

export type EntradaVeredicto = {
  /** GPS requerido, QR obligatorio con credencial activa o foto obligatoria. */
  exigeControl: boolean
  dentroRadio: boolean | null
  qrVerificado: boolean
  foto: EstadoFotoPunto
}

export function veredictoPunto(p: EntradaVeredicto): { estado: EstadoPuntoValidado, validadoPor: ValidadoPor | null } {
  if (p.dentroRadio === true) return { estado: 'cumplido', validadoPor: 'gps' }
  if (p.qrVerificado) return { estado: 'cumplido', validadoPor: 'qr' }
  if (p.foto === 'aceptada_ia') return { estado: 'cumplido', validadoPor: 'foto_ia' }
  if (p.foto === 'aceptada_revision') return { estado: 'cumplido', validadoPor: 'revision' }
  // Nada exigido: registrar alcanza, como con la regla anterior.
  if (!p.exigeControl) return { estado: 'cumplido', validadoPor: null }
  if (p.foto === 'pendiente') return { estado: 'pendiente_validacion', validadoPor: null }
  return { estado: 'incumplido', validadoPor: null }
}

/**
 * Resultado de una ronda finalizada desde sus puntos. Mismo criterio que
 * rondas_resultado_ejecucion: un incumplido u omitido la hace incompleta; si
 * no hay ninguno pero algún punto espera la IA, queda pendiente de validación.
 */
export function resultadoRonda(estados: string[]): 'completa' | 'incompleta' | 'pendiente_validacion' {
  if (estados.some(e => e === 'incumplido' || e === 'omitido')) return 'incompleta'
  if (estados.some(e => e === 'pendiente_validacion')) return 'pendiente_validacion'
  return 'completa'
}

export const ETIQUETA_VALIDADO_POR: Record<ValidadoPor, string> = {
  gps: 'GPS dentro del radio',
  qr: 'QR verificado',
  foto_ia: 'Foto aceptada por IA',
  revision: 'Foto aprobada por revisión',
}

export const ETIQUETA_PENDIENTE_VALIDACION = 'Pendiente de validación'
