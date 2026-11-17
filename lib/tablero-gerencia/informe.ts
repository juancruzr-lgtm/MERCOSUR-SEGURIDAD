/**
 * lib/tablero-gerencia/informe.ts
 *
 * Informe mensual auditable. Arma una FOTO de las cifras del mes con las
 * mismas funciones del tablero, sin recalcular nada aparte. Guardarlo
 * (gestion_informe_guardar) crea una versión nueva inmutable: una corrección
 * posterior no altera en silencio un cierre anterior.
 *
 * Cada cifra declara su fuente y si es confiable; lo no disponible se informa
 * como tal (nunca se inventan costos ni márgenes).
 */

import type { ResumenCasos } from './casos'
import type { IndicadoresCalidad } from './calidad'
import type { ResumenHorasMes, ComparacionMensual } from './horas'
import type { ResumenPreventivo } from './supervision-preventiva'

export const VERSION_ESQUEMA_INFORME = 1

export interface InformeMensual {
  esquema: number
  mes: string
  generadoAt: string
  mesCerrado: boolean
  horas: {
    trabajadas: number
    programadasTerminadas: number
    cargadasSinFichaje: number
    turnosSinHoras: number
    comparacionMesAnterior: ComparacionMensual
    fuente: string
  }
  operacion: {
    casos: Pick<ResumenCasos, 'total' | 'abiertos' | 'vencidos' | 'resueltosSinVerificar' | 'verificados' | 'descartados' | 'reabiertos' | 'porTipo'>
    reincidencias: number
  }
  calidad: IndicadoresCalidad
  supervision: ResumenPreventivo['totales']
  facturacion: { prefacturado: number | null; clientes: number | null; fuente: string }
  rentabilidad: { disponible: false; motivo: string }
  advertencias: string[]
}

export function armarInformeMensual(p: {
  mes: string
  ahoraIso: string
  mesCerrado: boolean
  horas: ResumenHorasMes
  comparacion: ComparacionMensual
  casos: ResumenCasos
  calidad: IndicadoresCalidad
  supervision: ResumenPreventivo
  facturacion: { cliente: string; total: number }[] | null
  advertencias?: string[]
}): InformeMensual {
  const adv = [...(p.advertencias ?? [])]
  if (!p.mesCerrado) adv.push('Mes en curso: las cifras son parciales; el cierre oficial se guarda terminado el mes.')
  if (p.horas.lineasQueDivergenDeSql > 0) adv.push(`${p.horas.lineasQueDivergenDeSql} turno(s) con diferencia conocida entre el cálculo de la app y el de la base (ver auditoría de horas).`)
  return {
    esquema: VERSION_ESQUEMA_INFORME,
    mes: p.mes,
    generadoAt: p.ahoraIso,
    mesCerrado: p.mesCerrado,
    horas: {
      trabajadas: p.horas.total.oficiales,
      programadasTerminadas: p.horas.total.programadas,
      cargadasSinFichaje: p.horas.total.sinFichaje,
      turnosSinHoras: p.horas.total.incompletos,
      comparacionMesAnterior: p.comparacion,
      fuente: 'Regla oficial de liquidación (lib/liquidacion.ts), sólo turnos terminados',
    },
    operacion: {
      casos: {
        total: p.casos.total, abiertos: p.casos.abiertos, vencidos: p.casos.vencidos, resueltosSinVerificar: p.casos.resueltosSinVerificar,
        verificados: p.casos.verificados, descartados: p.casos.descartados, reabiertos: p.casos.reabiertos, porTipo: p.casos.porTipo,
      },
      reincidencias: p.casos.reincidencias.length,
    },
    calidad: p.calidad,
    supervision: p.supervision.totales,
    facturacion: p.facturacion
      ? { prefacturado: Math.round(p.facturacion.reduce((a, x) => a + x.total, 0) * 100) / 100, clientes: new Set(p.facturacion.map(x => x.cliente)).size, fuente: 'fact_prefacturas no descartadas (devengado prefacturado, no emitido)' }
      : { prefacturado: null, clientes: null, fuente: 'No disponible para este usuario' },
    rentabilidad: { disponible: false, motivo: 'Faltan costos laborales reales por objetivo (liquidación consolidada por objetivo) y costos operativos.' },
    advertencias: adv,
  }
}

/** JSON canónico (claves ordenadas) para que la huella no dependa del orden. */
export function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${jsonCanonico((v as any)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

export async function huellaInforme(i: InformeMensual): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonico(i)))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
