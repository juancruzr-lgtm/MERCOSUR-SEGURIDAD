/**
 * lib/facturacion/conceptos-fijos.ts
 *
 * Contratos MIXTOS: además de las horas (o del abono), un contrato puede tener
 * conceptos mensuales FIJOS que van en el MISMO comprobante, cada uno con su
 * IVA. Caso que lo origina: Trading Internacional, que factura horas + "Servicio
 * de guardia de alarmas" (factura de oct-2024: dos renglones, IVA 21 % en ambos).
 *
 * Tabla: fact_conceptos_fijos (migración 20261208100000). Escritura sólo por
 * fact_concepto_fijo_agregar / fact_concepto_fijo_cerrar (Gerencia o
 * Administración, con auditoría). Este módulo es puro: decide qué concepto va
 * en qué período y en qué comprobante.
 *
 * REGLAS
 *  - Período parcial: el concepto es MENSUAL y no se prorratea. Va ENTERO en el
 *    período si su vigencia toca el período (desde < hastaExclusivo y
 *    hasta ≥ desde). Un mes fuera de vigencia no lo lleva.
 *  - Cambio de importe dentro del período: rige la vigencia en curso al INICIO
 *    del período (si ninguna lo estaba, la primera que empieza dentro), una sola
 *    vez, y se avisa para revisar.
 *  - Sin duplicados: un mismo concepto (código + objetivo) sale UNA vez por
 *    período y en UN solo comprobante del contrato.
 *      · con objetivo → en el comprobante que incluye ese objetivo;
 *      · sin objetivo (del contrato) → en el comprobante del contrato entero
 *        (clave "contrato:"); si el contrato se factura en varios comprobantes,
 *        en el primero por orden de clave (estable entre recálculos).
 *  - Sin horas aprobadas NO se factura un concepto fijo, salvo que el propio
 *    concepto lo indique (factura_sin_horas, decisión contractual expresa).
 */

import type { TratamientoIva } from './dinero'

export type ConceptoFijoGuardado = {
  id: string
  contrato_id: string
  objetivo_id: string | null
  codigo: string
  descripcion: string
  importe: string | number
  tratamiento_iva: TratamientoIva
  alicuota_iva: string | number
  vigencia_desde: string
  vigencia_hasta: string | null
  factura_sin_horas?: boolean | null
}

export type ConceptoFijoVigente = {
  id: string
  codigo: string
  descripcion: string
  importe: string
  tratamientoIva: TratamientoIva
  alicuotaIva: string
  objetivoId: string | null
  facturaSinHoras: boolean
}

export type Periodo = { desde: string; hastaExclusivo: string }

const tocaPeriodo = (c: ConceptoFijoGuardado, p: Periodo) =>
  c.vigencia_desde < p.hastaExclusivo && (c.vigencia_hasta == null || c.vigencia_hasta >= p.desde)

const claveConcepto = (c: { codigo: string; objetivo_id?: string | null; objetivoId?: string | null }) =>
  `${c.codigo}|${c.objetivo_id ?? c.objetivoId ?? ''}`

/** Conceptos que corresponden al período, uno por (código, objetivo), con sus avisos. */
export function conceptosFijosDelPeriodo(todos: ConceptoFijoGuardado[], periodo: Periodo): { vigentes: ConceptoFijoVigente[]; avisos: string[] } {
  const avisos: string[] = []
  const porClave = new Map<string, ConceptoFijoGuardado[]>()
  for (const c of todos) {
    if (!tocaPeriodo(c, periodo)) continue
    const k = claveConcepto(c)
    porClave.set(k, [...(porClave.get(k) ?? []), c])
  }
  const vigentes: ConceptoFijoVigente[] = []
  for (const lista of Array.from(porClave.values())) {
    lista.sort((a, b) => a.vigencia_desde.localeCompare(b.vigencia_desde))
    const alInicio = lista.filter(c => c.vigencia_desde <= periodo.desde).pop()
    const elegido = alInicio ?? lista[0]
    if (lista.length > 1) avisos.push(`"${elegido.descripcion}" cambia de importe dentro del período: se aplica el vigente desde ${elegido.vigencia_desde}. Revisar.`)
    vigentes.push({
      id: elegido.id, codigo: elegido.codigo, descripcion: elegido.descripcion, importe: String(elegido.importe),
      tratamientoIva: elegido.tratamiento_iva, alicuotaIva: String(elegido.alicuota_iva), objetivoId: elegido.objetivo_id,
      facturaSinHoras: !!elegido.factura_sin_horas,
    })
  }
  vigentes.sort((a, b) => claveConcepto(a).localeCompare(claveConcepto(b)))
  return { vigentes, avisos }
}

export type GrupoComprobante = { clave: string; objIds: string[] }

/**
 * Conceptos que lleva UN comprobante (grupo) del contrato. Cada concepto se asigna
 * a un único grupo; si su objetivo no está en ningún grupo del período, no se
 * factura (se avisa en `huerfanos`).
 */
export function conceptosParaGrupo(
  vigentes: ConceptoFijoVigente[], grupo: GrupoComprobante, grupos: GrupoComprobante[],
): { conceptos: ConceptoFijoVigente[]; huerfanos: ConceptoFijoVigente[] } {
  const ordenados = [...grupos].sort((a, b) => a.clave.localeCompare(b.clave))
  const delContrato = ordenados.find(g => g.clave.startsWith('contrato:')) ?? ordenados[0]
  const conceptos: ConceptoFijoVigente[] = []
  const huerfanos: ConceptoFijoVigente[] = []
  for (const c of vigentes) {
    const destino = c.objetivoId ? ordenados.find(g => g.objIds.includes(c.objetivoId!)) : delContrato
    if (!destino) { huerfanos.push(c); continue }
    if (destino.clave === grupo.clave) conceptos.push(c)
  }
  return { conceptos, huerfanos }
}
