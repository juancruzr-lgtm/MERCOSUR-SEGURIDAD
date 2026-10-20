// lib/liquidacion-final.ts
//
// Liquidación final por baja — CÁLCULO PURO del borrador (migración 20261110120000).
//
// Reglas operativas pedidas por JC (20/10/2026). Son reglas de la empresa para
// armar el borrador, NO una validación normativa:
//
//  · Ordinarios pendientes (días, horas, feriados, licencias…): los mismos
//    conceptos y fórmulas del Excel de trabajo mensual, recortados al empleado y
//    hasta la fecha de baja. Se descuenta lo ya liquidado en el mes con registro
//    verificable (lo enviado a Visual en un período exportado/liquidado).
//  · 208 Vacaciones no gozadas: días = saldo − tomadas (datos manuales del caso;
//    si falta alguno queda PENDIENTE, nunca se asume cero) × valor día del Excel de
//    trabajo (C3 = básico/200×8). Recibos de Fulla y Paniagua: 40.812 por día.
//  · 120003 SAC proporcional: (básico/200×150)/365 × días computables.
//  · 217 SAC sobre vacaciones no gozadas: básico/365 × días de 208.
//  · 204 Presentismo: en una RENUNCIA que no completa el mes, cero con motivo.
//    Para las demás causas se mantiene la fórmula mensual (no se generaliza).
//  · 212 Gratificación extraordinaria: las extras pendientes del mes de la baja
//    (horas excedentes × valor hora extra) menos lo ya pagado por banco. Sólo en
//    la final; el tratamiento mensual (columna AP, sin código Visual) no cambia.
//
// Cómo va cada código a Visual (maestro de conceptos de la empresa 63 + recibos
// 15263/15264 de la «Liq. Especial» de septiembre 2026):
//    120003 CAN*IMP → Cantidad 1 · Importe = total   (así salió en ambos recibos)
//    208    CAN*IMP → Cantidad = días · Importe = valor día (14 × 40.812; 3 × 40.812)
//    212    CAN*IMP → Cantidad 1 · Importe = total   (Paniagua 1 × 35.000)
//    217    IMP     → Importe = total (Visual multiplica nada)
//    ordinarios     → la práctica mensual vigente: Cantidad 1 · Importe = total
//                     (000 DÍAS va como cantidad).

export type CausaBaja =
  | 'renuncia' | 'despido_sin_causa' | 'despido_con_causa' | 'mutuo_acuerdo' | 'fin_contrato'
  | 'periodo_prueba' | 'fallecimiento' | 'jubilacion' | 'abandono' | 'otra'

export const CAUSAS_BAJA: { valor: CausaBaja; texto: string }[] = [
  { valor: 'renuncia', texto: 'Renuncia' },
  { valor: 'despido_sin_causa', texto: 'Despido sin causa' },
  { valor: 'despido_con_causa', texto: 'Despido con causa' },
  { valor: 'mutuo_acuerdo', texto: 'Mutuo acuerdo' },
  { valor: 'fin_contrato', texto: 'Fin de contrato' },
  { valor: 'periodo_prueba', texto: 'Período de prueba' },
  { valor: 'fallecimiento', texto: 'Fallecimiento' },
  { valor: 'jubilacion', texto: 'Jubilación' },
  { valor: 'abandono', texto: 'Abandono de trabajo' },
  { valor: 'otra', texto: 'Otra' },
]

export type Entrada = 'CAN' | 'IMP' | 'CANIMP'

/** Concepto del catálogo Visual (liquidacion_concepto_catalogo). */
export interface ConceptoCatalogo { politica: string | null; entrada: string | null; nombre: string | null }

/** Concepto ordinario del mes de la baja (de la planilla recortada). */
export interface OrdinarioMes {
  codigo: string
  importe: number
  /** Cantidad informativa (días/horas) que dio origen al importe. */
  cantidad?: number | null
  /** Cómo sale en el Excel de trabajo (ej. 'AJ = AG × hora'). */
  base?: string
}

export interface OrdinariosHastaBaja {
  /** Fechas distintas trabajadas en el mes hasta la baja (000). */
  jornadas: number
  conceptos: OrdinarioMes[]
  /** Horas excedentes del mes hasta la baja (columna AL). */
  horasExtra: number
  /** Extra fija mensual (BG) de un mensualizado; no se liquida sola. */
  extraFija?: number | null
  /** Mensualizado con SUELDO MENSUAL fijo (grupo A). */
  sueldoFijo?: boolean
  /** Hay novedades mensuales informadas (sin fechas) que no se pueden recortar. */
  novedadInformada?: boolean
}

export interface AjusteManual {
  codigo: string
  /** null = mantener el calculado. */
  cantidad?: number | null
  importe?: number | null
  motivo: string
}

export interface EntradasFinal {
  vacaciones?: { saldoDias?: number | null; tomadasDias?: number | null; nota?: string | null }
  ajustes?: AjusteManual[]
}

export interface DatosLiquidacionFinal {
  persona: { cuil: string | null; legajoVisual: string | null; nombre: string; empleadoId: string | null }
  baja: { fecha: string | null; causa: CausaBaja | null; fechaIngreso: string | null; discrepancia?: string | null }
  parametros: { basico: number; horaExtra: number; valorDia: number }
  /** null = no se pudieron leer los datos operativos del mes (faltante). */
  ordinarios: OrdinariosHastaBaja | null
  /** Lo ya enviado a Visual en el mes de la baja (períodos exportados/liquidados). */
  yaLiquidado: { codigo: string; cantidad: number | null; importe: number | null }[]
  /** Extras del mes ya pagadas por banco (lotes no anulados). */
  extrasPagadas: number
  catalogo: Map<string, ConceptoCatalogo>
  entradas: EntradasFinal
}

export interface LineaFinal {
  codigo: string
  concepto: string
  entrada: Entrada
  /** Columna Cantidad del .xls de Visual. */
  cantidad: number | null
  /** Columna Importe del .xls de Visual (unitario cuando la cantidad es real). */
  importe: number | null
  /** Importe final esperado del concepto (lo que se concilia). */
  total: number
  detalle: {
    origen: 'ordinario' | 'final' | 'ajuste'
    formula: string
    base?: Record<string, number | string | null>
    calculado?: { cantidad: number | null; importe: number | null; total: number } | null
    ajuste?: { motivo: string } | null
    yaLiquidado?: number | null
  }
}

export interface Faltante { clave: string; detalle: string }

export interface ResultadoLiquidacionFinal {
  lineas: LineaFinal[]
  faltantes: Faltante[]
  advertencias: string[]
  calculo: {
    mes: string | null
    fechas: { baja: string | null; ingreso: string | null; inicioSemestre: string | null; inicioComputo: string | null; diasSAC: number | null; regla: string }
    bases: { basico: number; valorDia: number; horaExtra: number; unitarioSAC: number | null }
    vacaciones: { saldo: number | null; tomadas: number | null; noGozadas: number | null; nota: string | null }
    presentismo: { calculado: number | null; aplicado: number | null; motivo: string | null }
    extras: { horas: number; valorHora: number; bruto: number; pagado: number; pendiente: number }
    ya_liquidado: { codigo: string; cantidad: number | null; importe: number | null }[]
    total: number
  }
}

// ── Utilidades de fecha (ISO YYYY-MM-DD, sin zona) ───────────────────────────
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const aUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export const diferenciaDias = (desde: string, hasta: string) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000)
export const redondear = (n: number, d = 2) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f }
const ultimoDiaDelMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10)

/**
 * Días computables del SAC proporcional.
 *
 * REGLA DE CONTEO (explícita): días = fecha de baja − inicio, en días corridos,
 * como la resta de fechas del Excel (=BAJA-INICIO). El inicio es el 1/1 o el 1/7
 * del semestre de la baja, o la fecha de ingreso si es posterior.
 * Fulla: 30/09/2026 − 01/07/2026 = 91.
 */
export const REGLA_DIAS_SAC = 'días = fecha de baja − inicio (resta de fechas, días corridos); inicio = 1/1 o 1/7 del semestre de la baja, o el ingreso si es posterior'

export function diasComputablesSAC(fechaBaja: string, fechaIngreso: string | null): {
  inicioSemestre: string; inicioComputo: string; dias: number
} {
  const anio = fechaBaja.slice(0, 4)
  const inicioSemestre = Number(fechaBaja.slice(5, 7)) <= 6 ? `${anio}-01-01` : `${anio}-07-01`
  const inicioComputo = fechaIngreso && fechaIngreso > inicioSemestre ? fechaIngreso : inicioSemestre
  return { inicioSemestre, inicioComputo, dias: diferenciaDias(inicioComputo, fechaBaja) }
}

/** (básico/200×150)/365: valor diario del SAC proporcional (sin redondear). */
export const unitarioSAC = (basico: number) => (basico / 200 * 150) / 365
export const totalSAC = (basico: number, dias: number) => redondear(unitarioSAC(basico) * dias)
/** básico/365 × días de vacaciones no gozadas. */
export const totalSACVacaciones = (basico: number, diasVac: number) => redondear(basico / 365 * diasVac)

// 208/217 no salen nunca en el mes: si ya se mandaron, alguien liquidó las vacaciones aparte.
const CODIGOS_VACACIONES = new Set(['208', '217'])
const NOMBRES: Record<string, string> = {
  '000': 'DIAS TRABAJADAS', '120003': 'sac proporcional', '208': 'Vac No Goz', '217': 'sac sobre vacaciones no goz',
  '212': 'GRATIFICACION EXTRAORDINARIA', '204': 'presentismo',
}
const TOL = 0.005

/**
 * Calcula el borrador. PURO: no lee nada. Lo que falta queda en `faltantes`
 * (bloquean «lista»); lo que hay que mirar queda en `advertencias`.
 */
export function calcularLiquidacionFinal(d: DatosLiquidacionFinal): ResultadoLiquidacionFinal {
  const faltantes: Faltante[] = []
  const advertencias: string[] = []
  const lineas: LineaFinal[] = []
  const { basico, horaExtra, valorDia } = d.parametros
  const fechaBaja = d.baja.fecha && RE_FECHA.test(d.baja.fecha) ? d.baja.fecha : null
  const ingreso = d.baja.fechaIngreso && RE_FECHA.test(d.baja.fechaIngreso) ? d.baja.fechaIngreso : null
  const mes = fechaBaja ? fechaBaja.slice(0, 7) : null
  const falta = (clave: string, detalle: string) => faltantes.push({ clave, detalle })

  // ── Identidad y baja ──
  if (!d.persona.cuil || !/^\d{11}$/.test(d.persona.cuil)) falta('cuil', 'Falta el CUIL: sin CUIL no se puede importar en Visual.')
  if (!d.persona.legajoVisual) falta('legajo_visual', 'Falta el legajo de Visual (COD_INTERNO).')
  if (!fechaBaja) falta('fecha_baja', 'Falta la fecha efectiva de la baja.')
  if (d.baja.discrepancia) falta('discrepancia', d.baja.discrepancia)
  if (fechaBaja && ingreso && ingreso > fechaBaja) falta('ingreso_posterior', `La fecha de ingreso (${ingreso}) es posterior a la baja (${fechaBaja}).`)

  const yaPorCodigo = new Map(d.yaLiquidado.map(y => [String(y.codigo), y]))
  const sueldoFijo = Boolean(d.ordinarios?.sueldoFijo)

  // ── Ordinarios pendientes hasta la baja ──
  let presentismoCalculado: number | null = null
  let presentismoAplicado: number | null = null
  let presentismoMotivo: string | null = null
  if (!d.ordinarios) {
    if (fechaBaja) falta('ordinarios', 'No se pudieron leer los días, horas y novedades del mes de la baja.')
  } else {
    const o = d.ordinarios
    if (o.novedadInformada) advertencias.push('Hay novedades mensuales informadas sin fechas: no se pueden cortar en la fecha de baja. Revisar licencias/vacaciones del mes.')
    if (o.jornadas === 0 && o.conceptos.every(c => !c.importe)) advertencias.push('Sin jornadas ni conceptos ordinarios en el mes de la baja: el borrador lleva sólo los conceptos finales.')
    if (o.jornadas > 0) {
      const ya = Number(yaPorCodigo.get('000')?.cantidad ?? 0)
      const pend = o.jornadas - ya
      if (ya > 0) advertencias.push(`000: ${ya} días ya enviados a Visual en el mes; quedan ${Math.max(0, pend)}.`)
      if (pend > 0) lineas.push({
        codigo: '000', concepto: NOMBRES['000'], entrada: 'CAN', cantidad: pend, importe: null, total: 0,
        detalle: { origen: 'ordinario', formula: 'fechas distintas trabajadas hasta la baja', base: { jornadas: o.jornadas }, yaLiquidado: ya || null },
      })
    }
    for (const c of o.conceptos) {
      const codigo = String(c.codigo)
      let importe = redondear(Number(c.importe) || 0)
      if (codigo === '204') {
        presentismoCalculado = importe
        if (importe > 0) {
          if (!d.baja.causa) falta('causa', 'Falta la causa de la baja: define si corresponde el presentismo del mes.')
          else if (d.baja.causa === 'renuncia' && fechaBaja && fechaBaja < ultimoDiaDelMes(fechaBaja)) {
            presentismoMotivo = 'Renuncia que no completa la condición mensual: presentismo en cero (regla JC, caso Paniagua).'
            importe = 0
          }
        }
        presentismoAplicado = importe
        if (presentismoMotivo) advertencias.push(`204 presentismo: ${presentismoMotivo}`)
      }
      const ya = Number(yaPorCodigo.get(codigo)?.importe ?? 0)
      const pend = redondear(importe - ya)
      if (ya > 0 && pend < -TOL) advertencias.push(`${codigo}: ya se liquidaron $${ya} en el mes, más que lo que da la planilla hasta la baja ($${importe}). No se descuenta solo: revisar.`)
      if (pend <= TOL) continue
      lineas.push({
        codigo, concepto: d.catalogo.get(codigo)?.nombre ?? codigo, entrada: 'IMP', cantidad: 1, importe: pend, total: pend,
        detalle: { origen: 'ordinario', formula: c.base ?? 'Excel de trabajo del mes, hasta la baja', base: { calculado: importe, cantidad: c.cantidad ?? null }, yaLiquidado: ya || null },
      })
    }
  }

  // ── SAC proporcional (120003) ──
  let diasSAC: number | null = null
  let inicioSemestre: string | null = null
  let inicioComputo: string | null = null
  if (sueldoFijo) falta('regla_sueldo_fijo', 'Mensualizado con sueldo fijo: la regla pedida (básico de convenio) no aplica. Definir SAC y vacaciones a mano con ajustes.')
  else if (fechaBaja) {
    if (!ingreso) falta('fecha_ingreso', 'Falta la fecha de ingreso: no se sabe si el SAC empieza en el semestre o en el ingreso.')
    else if (ingreso <= fechaBaja) {
      const s = diasComputablesSAC(fechaBaja, ingreso)
      diasSAC = s.dias; inicioSemestre = s.inicioSemestre; inicioComputo = s.inicioComputo
      const total = totalSAC(basico, s.dias)
      const ya = Number(yaPorCodigo.get('120003')?.importe ?? 0)
      if (ya > 0) falta('sac_ya_liquidado', `Ya se enviaron $${ya} de 120003 en el mes: revisar antes de liquidar el SAC proporcional.`)
      else if (total > 0) lineas.push({
        codigo: '120003', concepto: NOMBRES['120003'], entrada: 'CANIMP', cantidad: 1, importe: total, total,
        detalle: { origen: 'final', formula: '(básico/200×150)/365 × días', base: { basico, dias: s.dias, inicio: s.inicioComputo, baja: fechaBaja, unitario: redondear(unitarioSAC(basico), 6) } },
      })
    }
  }

  // ── Vacaciones no gozadas (208) y SAC sobre vacaciones (217) ──
  const vac = d.entradas.vacaciones ?? {}
  const saldo = vac.saldoDias ?? null
  const tomadas = vac.tomadasDias ?? null
  let noGozadas: number | null = null
  if (!sueldoFijo) {
    if (saldo == null) falta('vacaciones_saldo', 'Falta el saldo de vacaciones (dato manual; no se asume cero).')
    if (tomadas == null) falta('vacaciones_tomadas', 'Faltan las vacaciones tomadas (dato manual; no se asume cero).')
    if (saldo != null && tomadas != null) {
      noGozadas = redondear(saldo - tomadas, 4)
      if (noGozadas < 0) falta('vacaciones_negativas', `Las vacaciones tomadas (${tomadas}) superan el saldo (${saldo}).`)
      else if (noGozadas > 0) {
        const t208 = redondear(noGozadas * valorDia)
        lineas.push({
          codigo: '208', concepto: NOMBRES['208'], entrada: 'CANIMP', cantidad: noGozadas, importe: redondear(valorDia), total: t208,
          detalle: { origen: 'final', formula: '(saldo − tomadas) × valor día (C3 = básico/200×8)', base: { saldo, tomadas, valorDia: redondear(valorDia) } },
        })
        const t217 = totalSACVacaciones(basico, noGozadas)
        lineas.push({
          codigo: '217', concepto: NOMBRES['217'], entrada: 'IMP', cantidad: 1, importe: t217, total: t217,
          detalle: { origen: 'final', formula: 'básico/365 × días de vacaciones no gozadas', base: { basico, dias: noGozadas } },
        })
      }
    }
  }

  // ── Extras pendientes → 212 Gratificación extraordinaria ──
  const horas = Number(d.ordinarios?.horasExtra ?? 0)
  const bruto = redondear(horas * horaExtra)
  const pagado = redondear(Number(d.extrasPagadas) || 0)
  const pendiente = redondear(Math.max(0, bruto - pagado))
  if (d.ordinarios?.extraFija && d.ordinarios.extraFija > 0) {
    falta('extra_fija', `Tiene una extra fija mensual de $${d.ordinarios.extraFija}: definir con un ajuste si va en la final.`)
  }
  if (pagado > bruto + TOL) advertencias.push(`Extras: ya se pagaron $${pagado} por banco, más que las ${horas} h del mes hasta la baja ($${bruto}).`)
  if (pendiente > 0) {
    if (lineas.some(l => l.codigo === '212')) {
      falta('conflicto_212', 'El 212 ya lleva el adicional mensual: las extras pendientes no pueden ir en la misma línea. Resolver con un ajuste.')
    } else {
      lineas.push({
        codigo: '212', concepto: NOMBRES['212'], entrada: 'CANIMP', cantidad: 1, importe: pendiente, total: pendiente,
        detalle: { origen: 'final', formula: 'horas excedentes × valor hora extra − extras ya pagadas', base: { horas, valorHora: horaExtra, bruto, pagado } },
      })
    }
  }

  // ── Ajustes manuales (con motivo; quedan documentados) ──
  for (const a of d.entradas.ajustes ?? []) {
    const codigo = String(a.codigo ?? '').trim()
    if (!/^\d{3,9}$/.test(codigo)) { falta(`ajuste:${codigo || '?'}`, 'Ajuste con código inválido.'); continue }
    if (!a.motivo || a.motivo.trim().length < 3) { falta(`ajuste:${codigo}`, `Ajuste del ${codigo} sin motivo.`); continue }
    const i = lineas.findIndex(l => l.codigo === codigo)
    const previa = i >= 0 ? lineas[i] : null
    const cfg = d.catalogo.get(codigo)
    const entrada: Entrada = previa?.entrada ?? (cfg?.entrada === 'CAN' ? 'CAN' : cfg?.entrada === 'IMP' ? 'IMP' : 'CANIMP')
    const cantidad = a.cantidad != null ? Number(a.cantidad) : (previa?.cantidad ?? 1)
    const importe = a.importe != null ? Number(a.importe) : (previa?.importe ?? null)
    if (entrada !== 'CAN' && importe == null) { falta(`ajuste:${codigo}`, `Ajuste del ${codigo} sin importe.`); continue }
    const total = entrada === 'CAN' ? 0 : redondear(entrada === 'IMP' ? Number(importe) : cantidad * Number(importe))
    const nueva: LineaFinal = {
      codigo, concepto: previa?.concepto ?? cfg?.nombre ?? codigo, entrada,
      cantidad: entrada === 'IMP' ? 1 : cantidad, importe: entrada === 'CAN' ? null : Number(importe), total,
      detalle: {
        ...(previa?.detalle ?? { formula: 'ajuste manual' }), origen: previa ? previa.detalle.origen : 'ajuste',
        calculado: previa ? { cantidad: previa.cantidad, importe: previa.importe, total: previa.total } : null,
        ajuste: { motivo: a.motivo.trim() },
      },
    }
    const quitar = entrada === 'CAN' ? !cantidad : Math.abs(total) < TOL
    if (i >= 0) { if (quitar) lineas.splice(i, 1); else lineas[i] = nueva }
    else if (!quitar) lineas.push(nueva)
    advertencias.push(`Ajuste manual ${codigo}: ${a.motivo.trim()}`)
  }

  // ── Catálogo: todo lo que se manda tiene que ser política 'valor' ──
  for (const l of lineas) {
    const cfg = d.catalogo.get(l.codigo)
    if (!cfg) falta(`catalogo:${l.codigo}`, `El código ${l.codigo} no está en el catálogo de Visual.`)
    else if (cfg.politica !== 'valor') falta(`catalogo:${l.codigo}`, `El código ${l.codigo} tiene $${l.total} pendientes pero el catálogo no lo exporta (política «${cfg.politica}»). Resolver antes de exportar.`)
  }
  const ya = d.yaLiquidado.filter(y => CODIGOS_VACACIONES.has(String(y.codigo)) && Number(y.importe ?? 0) !== 0)
  for (const y of ya) falta(`ya_liquidado:${y.codigo}`, `Ya se envió el ${y.codigo} ($${y.importe}) en el mes de la baja: revisar para no pagarlo dos veces.`)

  lineas.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return {
    lineas,
    faltantes,
    advertencias,
    calculo: {
      mes,
      fechas: { baja: fechaBaja, ingreso, inicioSemestre, inicioComputo, diasSAC, regla: REGLA_DIAS_SAC },
      bases: { basico, valorDia: redondear(valorDia, 6), horaExtra, unitarioSAC: redondear(unitarioSAC(basico), 6) },
      vacaciones: { saldo, tomadas, noGozadas, nota: vac.nota ?? null },
      presentismo: { calculado: presentismoCalculado, aplicado: presentismoAplicado, motivo: presentismoMotivo },
      extras: { horas, valorHora: horaExtra, bruto, pagado, pendiente },
      ya_liquidado: [...d.yaLiquidado].map(y => ({ codigo: String(y.codigo), cantidad: y.cantidad, importe: y.importe }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      total: redondear(lineas.reduce((s, l) => s + l.total, 0)),
    },
  }
}

/** Líneas del .xls de Visual a partir del borrador (mismo cálculo, sin recalcular). */
export function filasVisualFinal(
  lineas: Pick<LineaFinal, 'codigo' | 'cantidad' | 'importe'>[],
  persona: { cuil: string | null; legajoVisual: string | null; nombre: string },
): { legajo: string; cuil: string; codigo: string; cantidad: number | null; importe: number | null; nombre: string }[] {
  const cuil = String(persona.cuil ?? '').replace(/\D/g, '')
  return lineas.map(l => ({
    legajo: String(persona.legajoVisual ?? '').trim(), cuil, codigo: String(l.codigo),
    cantidad: l.cantidad == null ? null : Number(l.cantidad), importe: l.importe == null ? null : Number(l.importe), nombre: persona.nombre,
  }))
}

/** JSON estable (claves ordenadas) para el hash del cálculo. */
export function jsonEstable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${jsonEstable(o[k])}`).join(',')}}`
}

/**
 * Conceptos ordinarios de una fila de la planilla recortada (PlantillaLiquidacion
 * del Excel de trabajo). Lee las mismas columnas que el consolidado mensual.
 */
export const COLUMNAS_ORDINARIAS: { col: string; base: string; cantidadCol?: string }[] = [
  { col: 'AC', base: 'AC = (viático/25) × jornadas (H)', cantidadCol: 'H' },
  { col: 'AD', base: 'AD = (presentismo/25) × jornadas (H)', cantidadCol: 'H' },
  { col: 'AE', base: 'AE = (no rem./25) × jornadas (H)', cantidadCol: 'H' },
  { col: 'AF', base: 'AF = (hora/10) × horas nocturnas (J)', cantidadCol: 'J' },
  { col: 'AI', base: 'AI = adicional (hs) × hora' },
  { col: 'AJ', base: 'AJ = horas rec (AG) × hora', cantidadCol: 'AG' },
  { col: 'AT', base: 'AT = feriados (K) × día', cantidadCol: 'K' },
  { col: 'AU', base: 'AU = licencias (L) × día', cantidadCol: 'L' },
  { col: 'AV', base: 'AV = ART (M) × día', cantidadCol: 'M' },
  { col: 'AW', base: 'AW = vacaciones (N) × día', cantidadCol: 'N' },
  { col: 'AX', base: 'AX = parte médico (O) × día', cantidadCol: 'O' },
]

export function ordinariosDePlantilla(
  plantilla: { celdas: { ref: string; v?: string | number }[]; estilos: { encabezado: number } },
  empleadoId: string,
): { conceptos: OrdinarioMes[]; horasExtra: number; extraFija: number | null; sueldoFijo: boolean } | null {
  const porRef = new Map<string, string | number | undefined>()
  for (const c of plantilla.celdas) porRef.set(c.ref, c.v)
  const encab = plantilla.estilos.encabezado
  let fila: string | null = null
  for (const c of plantilla.celdas) {
    const m = c.ref.match(/^BD(\d+)$/)
    if (m && Number(m[1]) !== encab && String(c.v ?? '') === empleadoId) { fila = m[1]; break }
  }
  if (!fila) return null
  const num = (ref: string) => { const v = Number(porRef.get(ref) ?? 0); return Number.isFinite(v) ? v : 0 }
  const porCodigo = new Map<string, OrdinarioMes>()
  for (const c of COLUMNAS_ORDINARIAS) {
    const codigo = String(porRef.get(`${c.col}${encab}`) ?? '').trim()
    const v = num(`${c.col}${fila}`)
    if (!codigo || v === 0) continue
    const prev = porCodigo.get(codigo)
    porCodigo.set(codigo, prev
      ? { ...prev, importe: prev.importe + v, base: `${prev.base} + ${c.base}` }
      : { codigo, importe: v, cantidad: c.cantidadCol ? num(`${c.cantidadCol}${fila}`) : null, base: c.base })
  }
  const bf = porRef.get(`BF${fila}`)
  const bg = porRef.get(`BG${fila}`)
  return {
    conceptos: Array.from(porCodigo.values()),
    horasExtra: bf != null ? 0 : num(`AL${fila}`),
    extraFija: bg != null ? Number(bg) : null,
    sueldoFijo: bf != null,
  }
}
