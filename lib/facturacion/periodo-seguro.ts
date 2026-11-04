/**
 * lib/facturacion/periodo-seguro.ts
 *
 * Seguro de períodos de Facturación. Se factura el MES VENCIDO: en noviembre se
 * trabaja octubre. El mes en curso (y los futuros) se pueden consultar, pero no
 * se aceptan horas, no se generan ni aprueban prefacturas y no se emite sobre
 * ellos, salvo una excepción explícita de Gerencia (con motivo, vencimiento y
 * auditoría). La base lo impone por su cuenta (migración 20261204120000): esto
 * es la misma regla para la pantalla y las rutas, con mensajes claros.
 *
 * El "mes" se calcula en hora de Argentina (no UTC): entre las 21:00 y las
 * 23:59 del último día, UTC ya está en el mes siguiente.
 */

import { mesAnterior, mesArgentina, partirMes } from '@/lib/periodo-argentina'

export type EstadoPeriodo = 'vencido' | 'en_curso' | 'futuro'

/** Último mes calendario completamente vencido en Argentina (nov-2026 → '2026-10'; ene-2027 → '2026-12'). */
export function mesVencido(ahora: Date = new Date()): string {
  return mesAnterior(mesArgentina(ahora))
}

/** ¿El mes ya terminó, está en curso o todavía no empezó? (en hora de Argentina). */
export function estadoDelPeriodo(mes: string, ahora: Date = new Date()): EstadoPeriodo {
  partirMes(mes)
  const actual = mesArgentina(ahora)
  return mes < actual ? 'vencido' : mes === actual ? 'en_curso' : 'futuro'
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** '2026-10' → 'OCTUBRE 2026'. */
export function nombreDelMes(mes: string): string {
  const p = partirMes(mes)
  return `${MESES[p.mes - 1]} ${p.anio}`
}

export type Excepcion = { id: string; mes: string; motivo: string; vence_at: string; otorgada_por_nombre?: string | null }

/** ¿Se puede escribir (aceptar, recalcular, aprobar, emitir) sobre este mes? */
export function escrituraHabilitada(mes: string, excepcion: Excepcion | null | undefined, ahora: Date = new Date()): boolean {
  if (estadoDelPeriodo(mes, ahora) === 'vencido') return true
  return Boolean(excepcion && excepcion.mes === mes && Date.parse(excepcion.vence_at) > ahora.getTime())
}

/** Texto de por qué no se puede escribir (null si se puede). */
export function motivoBloqueo(mes: string, excepcion: Excepcion | null | undefined, ahora: Date = new Date()): string | null {
  if (escrituraHabilitada(mes, excepcion, ahora)) return null
  const e = estadoDelPeriodo(mes, ahora)
  return `${nombreDelMes(mes)} ${e === 'en_curso' ? 'está en curso' : 'todavía no empezó'}: se puede consultar, pero no aceptar horas, recalcular, aprobar ni emitir. Se factura el mes vencido (${nombreDelMes(mesVencido(ahora))}). Gerencia puede habilitarlo con una excepción con motivo.`
}

/** Mes de facturación de un período comercial (corte o calendario): el del último día incluido. */
export function mesDelPeriodo(hastaExclusivo: string): string {
  const d = new Date(`${hastaExclusivo}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 7)
}

/** Una operación en curso se da por perdida si no terminó en este tiempo (corte de la función o del navegador). */
export const OPERACION_VENCE_MIN = 10
