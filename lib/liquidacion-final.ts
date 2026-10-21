// lib/liquidacion-final.ts
//
// Liquidación final por baja — CÁLCULO PURO del borrador (migración 20261110120000).
//
// Reglas operativas pedidas por JC (20/10/2026). Son reglas de la empresa para
// armar el borrador, NO una validación normativa:
//
//  · Ordinarios pendientes (días, horas, feriados, licencias…): los mismos
//    conceptos y fórmulas del Excel de trabajo mensual, sólo de esa persona. Se
//    liquidan las jornadas EFECTIVAMENTE trabajadas del mes de la baja, aunque
//    sean posteriores a la fecha efectiva (regla JC 20/10); las novedades se
//    cortan en la fecha efectiva. Se descuenta lo ya liquidado en el mes con
//    registro verificable (lo enviado a Visual en un período exportado/liquidado).
//  · 208 Vacaciones no gozadas: días pendientes que Administración confirma en el
//    registro de baja (devengadas − tomadas; lib/baja-vacaciones.ts) × valor día
//    del Excel de trabajo (C3 = básico/200×8). Recibos de Fulla y Paniagua: 40.812
//    por día. Sin vacaciones confirmadas queda PENDIENTE (nunca se asume cero).
//  · 120003 SAC proporcional: (básico/200×150)/365 × días computables, con la
//    regla de conteo de la planilla de JC («calculo liq»: días = baja − 01/07).
//    Se muestra al lado el control con la mejor remuneración del semestre según
//    Visual (base legal), sin reemplazar la regla: la diferencia queda a revisión.
//  · 217 SAC sobre vacaciones no gozadas: básico/365 × días de 208. Va SIEMPRE que
//    haya vacaciones no gozadas (decisión JC 20/10, como su planilla); si en un caso
//    no corresponde, se quita con un ajuste (importe 0 y motivo).
//  · 204 Presentismo: según la causal (catálogo baja_causa). En una RENUNCIA que
//    no completa el mes, cero con motivo; las demás mantienen la fórmula mensual.
//  · Conceptos propios de la causal (indemnización, preaviso, integración…): se
//    listan para EVALUAR y bloquean la exportación hasta que Administración los
//    resuelva (incluido con un ajuste, o «no corresponde» con motivo). Nunca se
//    calculan solos.
//  · 212 Gratificación extraordinaria: las extras pendientes del mes de la baja
//    (horas excedentes × valor hora extra) menos lo ya pagado por banco. Sólo en
//    la final; el tratamiento mensual (columna AP, sin código Visual) no cambia.
//
// Cómo va cada código a Visual (maestro de conceptos de la empresa 63 + recibos
// 15263/15264 de la «Liq. Especial» de septiembre 2026):
//    120003 CAN*IMP → Cantidad 1 · Importe = total   (así salió en ambos recibos)
//    208    CAN*IMP → Cantidad = días · Importe = valor día (14 × 40.812; 3 × 40.812)
//    212    CAN*IMP → Cantidad 1 · Importe = total   (Paniagua 1 × 35.000)
//    217    IMP     → Cantidad 1 · Importe = total
//    ordinarios     → la práctica mensual vigente: Cantidad 1 · Importe = total
//                     (000 DÍAS va como cantidad).

/** Código de causal (catálogo baja_causa; ampliable sin tocar la arquitectura). */
export type CausaBaja = string

/** Respaldo para mostrar nombres si el catálogo todavía no cargó (el catálogo manda). */
export const CAUSAS_BAJA: { valor: CausaBaja; texto: string }[] = [
  { valor: 'renuncia', texto: 'Renuncia' },
  { valor: 'despido_sin_causa', texto: 'Despido sin causa' },
  { valor: 'despido_con_causa', texto: 'Despido con causa' },
  { valor: 'fin_contrato', texto: 'Finalización de contrato' },
  { valor: 'mutuo_acuerdo', texto: 'Mutuo acuerdo' },
  { valor: 'fallecimiento', texto: 'Fallecimiento' },
  { valor: 'jubilacion', texto: 'Jubilación' },
  { valor: 'abandono', texto: 'Abandono de trabajo' },
  { valor: 'otra', texto: 'Otra causal' },
]

/** Regla de la causal (fila de baja_causa). */
export interface ReglaCausal {
  codigo: string
  nombre: string
  presentismo: 'formula' | 'cero_si_no_completa_mes'
  evaluar: string[]
}

/** Conceptos a evaluar por causal y el código de Visual con que se incorporarían (si existe). */
export const CONCEPTOS_A_EVALUAR: Record<string, { texto: string; codigo: string | null }> = {
  indemnizacion_antiguedad: { texto: 'Indemnización por antigüedad (art. 245 LCT)', codigo: '207' },
  preaviso: { texto: 'Indemnización sustitutiva de preaviso (arts. 231/232 LCT)', codigo: '252' },
  integracion_mes: { texto: 'Integración del mes de despido (art. 233 LCT)', codigo: null },
  gratificacion_acuerdo: { texto: 'Suma acordada en la desvinculación (art. 241 LCT)', codigo: null },
  indemnizacion_fallecimiento: { texto: 'Indemnización por fallecimiento (art. 248 LCT)', codigo: '248' },
}

export type Entrada = 'CAN' | 'IMP' | 'CANIMP'

/** Concepto del catálogo Visual (liquidacion_concepto_catalogo). */
export interface ConceptoCatalogo { politica: string | null; entrada: string | null; nombre: string | null; tipo_visual?: string | null }

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
  /** Fechas distintas efectivamente trabajadas en el mes de la baja (000). */
  jornadas: number
  conceptos: OrdinarioMes[]
  /** Horas excedentes del mes de la baja (columna AL). */
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

export interface EvaluacionConcepto {
  clave: string
  resolucion: 'incluido' | 'no_corresponde'
  motivo: string
}

export interface EntradasFinal {
  /** Vacaciones confirmadas en el registro de baja (saldo = devengadas). */
  vacaciones?: { saldoDias?: number | null; tomadasDias?: number | null; nota?: string | null }
  ajustes?: AjusteManual[]
  /** Resolución de cada concepto a evaluar de la causal. */
  evaluaciones?: EvaluacionConcepto[]
  /** Período / tipo con que se importa en Visual (ej. «Liq. Especial OCTUBRE 2026»). */
  visualPeriodo?: string | null
  /**
   * Correcciones de la fila del Excel de trabajo (formato mensual) de esta persona:
   * mismas claves que liquidacion_ajuste (jornadas, horas_liquidables, feriados…,
   * 'celda:H', 'celda:AL'). Se aplican a la planilla del mes recortada a la baja.
   */
  ordinarios?: Record<string, number | null>
  /** Nota de esas correcciones. */
  ordinariosMotivo?: string | null
  /** Parámetros editados en el Excel de las finales (pisan los del mes sólo para esta final). */
  parametros?: Partial<{ basico: number; presentismo: number; viatico: number; noRem: number; horaExtra: number; hora: number | null; dia: number | null }>
}

export interface DatosLiquidacionFinal {
  persona: { cuil: string | null; legajoVisual: string | null; nombre: string; empleadoId: string | null }
  baja: {
    fecha: string | null; causa: CausaBaja | null; fechaIngreso: string | null; discrepancia?: string | null
    /** Regla de la causal (catálogo). Sin ella, la renuncia aplica la regla de presentismo por compatibilidad. */
    causal?: ReglaCausal | null
  }
  /** Control del SAC con la base legal: mejor remuneración imponible del semestre según Visual. */
  controlSAC?: { mejorRemuneracion: number; mes: string } | null
  parametros: {
    basico: number; horaExtra: number; valorDia: number
    /** Regla de conteo del SAC. null/ausente = sin confirmar → 120003 pendiente. */
    conteoSAC?: ConteoSAC | null
  }
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
    /** Remunerativo / No Remunerativo / Asignacion/Creditos / Para Calculos (catálogo de Visual). */
    tipo?: string | null
  }
}

export interface Faltante { clave: string; detalle: string }

export interface ResultadoLiquidacionFinal {
  lineas: LineaFinal[]
  faltantes: Faltante[]
  advertencias: string[]
  calculo: {
    mes: string | null
    fechas: {
      baja: string | null; ingreso: string | null; inicioSemestre: string | null; inicioComputo: string | null
      diasSAC: number | null; conteo: ConteoSAC | null; regla: string
      /** Con la regla sin confirmar: días y total de cada variante, para decidir. */
      variantes: { conteo: ConteoSAC; dias: number; total: number }[] | null
    }
    bases: { basico: number; valorDia: number; horaExtra: number; unitarioSAC: number | null }
    vacaciones: { saldo: number | null; tomadas: number | null; noGozadas: number | null; nota: string | null }
    presentismo: { calculado: number | null; aplicado: number | null; motivo: string | null }
    causal: { codigo: string | null; nombre: string | null; evaluar: { clave: string; texto: string; resolucion: string | null; motivo: string | null }[] }
    /** Conceptos que no se agregan solos (p. ej. 217): se incorporan con un ajuste. */
    sugerencias: { codigo: string; concepto: string; total: number; formula: string; motivo: string }[]
    controlSAC: { mejorRemuneracion: number; mes: string; diasSAC: number; totalLegal: number; diferencia: number } | null
    visualPeriodo: string | null
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
 * Días computables del SAC proporcional. El inicio es el 1/1 o el 1/7 del
 * semestre de la baja, o la fecha de ingreso si es posterior. Dos reglas de
 * conteo posibles (las dos en días corridos):
 *   'exclusivo' → días = baja − inicio        (resta de fechas del Excel: =BAJA-INICIO)
 *   'inclusivo' → días = baja − inicio + 1    (cuenta el día de inicio y el de la baja)
 * Fulla (91): exclusivo con baja 30/09 · inclusivo con baja 29/09.
 * Paniagua (62, ingreso 02/08): exclusivo con baja 03/10 · inclusivo con baja 02/10.
 */
export type ConteoSAC = 'exclusivo' | 'inclusivo'

/**
 * Regla confirmada por JC. null = TODAVÍA SIN CONFIRMAR: el 120003 queda pendiente
 * y el borrador muestra las dos variantes. Al confirmarla, cambiar sólo esta línea.
 */
export const CONTEO_SAC_CONFIRMADO: ConteoSAC | null = 'exclusivo'
// Evidencia (20/10/2026): 2026 sueldos.xlsx, hoja «calculo liq», columna «dias sac»
// = S − T (fecha de baja − 01/07/2025), 91 días para bajas del 30/09/2025. Con
// Fulla (renuncia 30/09/2026) da los 91 días de la referencia. El conteo
// inclusivo sigue implementado y probado por si Gerencia lo cambia.

export const REGLAS_CONTEO_SAC: Record<ConteoSAC, string> = {
  exclusivo: 'días = fecha de baja − inicio (días corridos); inicio = 1/1 o 1/7 del semestre de la baja, o el ingreso si es posterior',
  inclusivo: 'días = fecha de baja − inicio + 1 (días corridos, cuenta inicio y baja); inicio = 1/1 o 1/7 del semestre de la baja, o el ingreso si es posterior',
}

export function diasComputablesSAC(fechaBaja: string, fechaIngreso: string | null, conteo: ConteoSAC): {
  inicioSemestre: string; inicioComputo: string; dias: number
} {
  const anio = fechaBaja.slice(0, 4)
  const inicioSemestre = Number(fechaBaja.slice(5, 7)) <= 6 ? `${anio}-01-01` : `${anio}-07-01`
  const inicioComputo = fechaIngreso && fechaIngreso > inicioSemestre ? fechaIngreso : inicioSemestre
  return { inicioSemestre, inicioComputo, dias: diferenciaDias(inicioComputo, fechaBaja) + (conteo === 'inclusivo' ? 1 : 0) }
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
  const sugerencias: ResultadoLiquidacionFinal['calculo']['sugerencias'] = []
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
    if (d.entradas.ordinarios && Object.keys(d.entradas.ordinarios).length) {
      advertencias.push(`Días/horas corregidos en el Excel de trabajo (${Object.entries(d.entradas.ordinarios).map(([k, v]) => `${k}: ${v ?? 'vacío'}`).join(', ')}): ${d.entradas.ordinariosMotivo ?? 'sin motivo'}`)
    }
    if (o.novedadInformada) advertencias.push('Hay novedades mensuales informadas sin fechas: no se pueden cortar en la fecha de baja. Revisar licencias/vacaciones del mes.')
    if (o.jornadas === 0 && o.conceptos.every(c => !c.importe)) advertencias.push('Sin jornadas ni conceptos ordinarios en el mes de la baja: el borrador lleva sólo los conceptos finales.')
    if (o.jornadas > 0) {
      const ya = Number(yaPorCodigo.get('000')?.cantidad ?? 0)
      const pend = o.jornadas - ya
      if (ya > 0) advertencias.push(`000: ${ya} días ya enviados a Visual en el mes; quedan ${Math.max(0, pend)}.`)
      if (pend > 0) lineas.push({
        codigo: '000', concepto: NOMBRES['000'], entrada: 'CAN', cantidad: pend, importe: null, total: 0,
        detalle: { origen: 'ordinario', formula: 'fechas distintas efectivamente trabajadas en el mes', base: { jornadas: o.jornadas }, yaLiquidado: ya || null },
      })
    }
    for (const c of o.conceptos) {
      const codigo = String(c.codigo)
      let importe = redondear(Number(c.importe) || 0)
      if (codigo === '204') {
        presentismoCalculado = importe
        if (importe > 0) {
          if (!d.baja.causa) falta('causa', 'Falta la causa de la baja: define si corresponde el presentismo del mes.')
          else if ((d.baja.causal ? d.baja.causal.presentismo === 'cero_si_no_completa_mes' : d.baja.causa === 'renuncia')
                   && fechaBaja && fechaBaja < ultimoDiaDelMes(fechaBaja)) {
            presentismoMotivo = `${d.baja.causal?.nombre ?? 'Renuncia'} que no completa la condición mensual: presentismo en cero (regla JC, caso Paniagua).`
            importe = 0
          }
        }
        presentismoAplicado = importe
        if (presentismoMotivo) advertencias.push(`204 presentismo: ${presentismoMotivo}`)
      }
      const ya = Number(yaPorCodigo.get(codigo)?.importe ?? 0)
      const pend = redondear(importe - ya)
      if (ya > 0 && pend < -TOL) advertencias.push(`${codigo}: ya se liquidaron $${ya} en el mes, más que lo que da la planilla del mes ($${importe}). No se descuenta solo: revisar.`)
      if (pend <= TOL) continue
      lineas.push({
        codigo, concepto: d.catalogo.get(codigo)?.nombre ?? codigo, entrada: 'IMP', cantidad: 1, importe: pend, total: pend,
        detalle: { origen: 'ordinario', formula: c.base ?? 'Excel de trabajo del mes, jornadas trabajadas', base: { calculado: importe, cantidad: c.cantidad ?? null }, yaLiquidado: ya || null },
      })
    }
  }

  // ── SAC proporcional (120003) ──
  let diasSAC: number | null = null
  let inicioSemestre: string | null = null
  let inicioComputo: string | null = null
  let variantes: { conteo: ConteoSAC; dias: number; total: number }[] | null = null
  const conteo = d.parametros.conteoSAC ?? null
  if (sueldoFijo) falta('regla_sueldo_fijo', 'Mensualizado con sueldo fijo: la regla pedida (básico de convenio) no aplica. Definir SAC y vacaciones a mano con ajustes.')
  else if (fechaBaja) {
    if (!ingreso) falta('fecha_ingreso', 'Falta la fecha de ingreso: no se sabe si el SAC empieza en el semestre o en el ingreso.')
    else if (ingreso <= fechaBaja && !conteo) {
      variantes = (['exclusivo', 'inclusivo'] as ConteoSAC[]).map(v => {
        const s = diasComputablesSAC(fechaBaja, ingreso, v)
        inicioSemestre = s.inicioSemestre; inicioComputo = s.inicioComputo
        return { conteo: v, dias: s.dias, total: totalSAC(basico, s.dias) }
      })
      falta('regla_conteo_sac', `Falta confirmar la regla de conteo de días del SAC: exclusivo ${variantes[0].dias} días (${variantes[0].total}) · inclusivo ${variantes[1].dias} días (${variantes[1].total}).`)
    } else if (ingreso <= fechaBaja && conteo) {
      const s = diasComputablesSAC(fechaBaja, ingreso, conteo)
      diasSAC = s.dias; inicioSemestre = s.inicioSemestre; inicioComputo = s.inicioComputo
      const total = totalSAC(basico, s.dias)
      const ya = Number(yaPorCodigo.get('120003')?.importe ?? 0)
      if (ya > 0) falta('sac_ya_liquidado', `Ya se enviaron $${ya} de 120003 en el mes: revisar antes de liquidar el SAC proporcional.`)
      else if (total > 0) lineas.push({
        codigo: '120003', concepto: NOMBRES['120003'], entrada: 'CANIMP', cantidad: 1, importe: total, total,
        detalle: { origen: 'final', formula: '(básico/200×150)/365 × días', base: { basico, dias: s.dias, conteo, inicio: s.inicioComputo, baja: fechaBaja, unitario: redondear(unitarioSAC(basico), 6) } },
      })
    }
  }

  // ── Vacaciones no gozadas (208) y SAC sobre vacaciones (217) ──
  const vac = d.entradas.vacaciones ?? {}
  const saldo = vac.saldoDias ?? null
  const tomadas = vac.tomadasDias ?? null
  let noGozadas: number | null = null
  if (!sueldoFijo) {
    if (saldo == null) falta('vacaciones_saldo', 'Faltan las vacaciones devengadas confirmadas en el registro de baja (no se asume cero).')
    if (tomadas == null) falta('vacaciones_tomadas', 'Faltan las vacaciones tomadas confirmadas en el registro de baja (no se asume cero).')
    if (saldo != null && tomadas != null) {
      noGozadas = redondear(saldo - tomadas, 4)
      if (noGozadas < 0) falta('vacaciones_negativas', `Las vacaciones tomadas (${tomadas}) superan el saldo (${saldo}).`)
      else if (noGozadas > 0) {
        const t208 = redondear(noGozadas * valorDia)
        lineas.push({
          codigo: '208', concepto: NOMBRES['208'], entrada: 'CANIMP', cantidad: noGozadas, importe: redondear(valorDia), total: t208,
          detalle: { origen: 'final', formula: '(saldo − tomadas) × valor día (C3 = básico/200×8)', base: { saldo, tomadas, valorDia: redondear(valorDia) } },
        })
        // 217 siempre (decisión JC 20/10); si no corresponde, se quita con un ajuste (importe 0 y motivo).
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
  if (pagado > bruto + TOL) advertencias.push(`Extras: ya se pagaron $${pagado} por banco, más que las ${horas} h del mes ($${bruto}).`)
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

  // ── Conceptos propios de la causal: se evalúan, nunca se calculan solos ──
  const evaluacionesPorClave = new Map((d.entradas.evaluaciones ?? []).map(e => [e.clave, e]))
  const evaluar = (d.baja.causal?.evaluar ?? []).map(clave => {
    const def = CONCEPTOS_A_EVALUAR[clave] ?? { texto: clave, codigo: null }
    const ev = evaluacionesPorClave.get(clave)
    if (!ev || !ev.motivo || ev.motivo.trim().length < 3) {
      falta(`evaluar:${clave}`, `Evaluar: ${def.texto}. Requiere revisión administrativa (incluir con un ajuste o marcar «no corresponde» con motivo).`)
    } else if (ev.resolucion === 'incluido' && def.codigo && !lineas.some(l => l.codigo === def.codigo)) {
      falta(`evaluar:${clave}`, `${def.texto}: se marcó como incluido pero falta el ajuste con el código ${def.codigo}.`)
    } else if (ev.resolucion === 'incluido' && !def.codigo) {
      advertencias.push(`${def.texto}: incluido; no tiene código de Visual configurado (cargalo con el código que corresponda).`)
    }
    return { clave, texto: def.texto, resolucion: ev?.resolucion ?? null, motivo: ev?.motivo ?? null }
  })

  // ── Control del SAC con la base legal (no reemplaza la regla operativa) ──
  let controlSAC: ResultadoLiquidacionFinal['calculo']['controlSAC'] = null
  const linea120003 = lineas.find(l => l.codigo === '120003')
  if (d.controlSAC && diasSAC != null && d.controlSAC.mejorRemuneracion > 0) {
    const totalLegal = redondear(d.controlSAC.mejorRemuneracion / 365 * diasSAC)
    const diferencia = redondear(totalLegal - (linea120003?.total ?? 0))
    controlSAC = { mejorRemuneracion: d.controlSAC.mejorRemuneracion, mes: d.controlSAC.mes, diasSAC, totalLegal, diferencia }
    if (Math.abs(diferencia) >= 1) advertencias.push(`Control SAC: con la mejor remuneración imponible del semestre según Visual (${d.controlSAC.mes}: ${d.controlSAC.mejorRemuneracion}) daría ${totalLegal}, ${diferencia} distinto de la regla operativa. Revisar antes de exportar.`)
  }

  // ── Catálogo: todo lo que se manda tiene que ser política 'valor' ──
  if (!d.entradas.visualPeriodo?.trim()) falta('visual_periodo', 'Indicá el período / tipo de liquidación con que se importa en Visual (ej. «Liq. Especial OCTUBRE 2026»).')
  for (const l of lineas) {
    const cfg = d.catalogo.get(l.codigo)
    l.detalle.tipo = cfg?.tipo_visual ?? null
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
      fechas: {
        baja: fechaBaja, ingreso, inicioSemestre, inicioComputo, diasSAC, conteo,
        regla: conteo ? REGLAS_CONTEO_SAC[conteo] : 'regla de conteo SIN CONFIRMAR (exclusivo: baja − inicio · inclusivo: baja − inicio + 1)',
        variantes,
      },
      bases: { basico, valorDia: redondear(valorDia, 6), horaExtra, unitarioSAC: redondear(unitarioSAC(basico), 6) },
      vacaciones: { saldo, tomadas, noGozadas, nota: vac.nota ?? null },
      presentismo: { calculado: presentismoCalculado, aplicado: presentismoAplicado, motivo: presentismoMotivo },
      causal: { codigo: d.baja.causa ?? null, nombre: d.baja.causal?.nombre ?? null, evaluar },
      sugerencias,
      controlSAC,
      visualPeriodo: d.entradas.visualPeriodo?.trim() || null,
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
