/**
 * lib/facturacion/servidor.ts
 *
 * Orquestación del lado servidor. Lee con el cliente DEL USUARIO (RLS y
 * auth.uid() son los suyos) y escribe sólo por RPC. Nada de acá emite
 * comprobantes ni manda comunicaciones.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPaginado } from '@/lib/fetch-paginado'
import { fechaArgentina, sumarDias } from '@/lib/periodo-argentina'
import { periodoFacturacion, servicioActivoEnPeriodo, type ReglaPeriodo } from './periodos'
import { horasDelObjetivo, minutosAprobables, type RegistroFacturable, type TurnoFacturable } from './horas'
import {
  agruparObjetivos, calcularPrefactura, clavePrestacion, estadoSugerido, objetivosEnOtraPrefactura, renglonesPorObjetivo, tarifasParaObjetivo, textoPrecargado,
  type EntradaPrefactura, type HorasAprobadas, type Modalidad, type OrdenCompraEstado, type TarifaVigente, type TipoRequisito,
} from './prefacturacion'
import { proponerAsociaciones, type ClienteIdentidad, type ComprobanteAbierto, type RetencionDisponible } from './conciliacion'
import { numeroVisible } from './comprobantes'

// Mismas columnas que lee Reportes: las horas salen de lib/planilla-objetivo con los mismos datos.
const CAMPOS_REGISTRO = '*'

function reglaDe(k: any): ReglaPeriodo {
  return k.regla_periodo === 'corte' ? { tipo: 'corte', diaInicio: Number(k.dia_corte) } : { tipo: 'mes_calendario' }
}
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : null)

const CAMPOS_TURNO = '*'

/** Propuesta de horas FACTURABLES de un objetivo para un contrato y mes. No escribe. */
export async function proponerHoras(db: SupabaseClient, p: { contratoId: string; objetivoId: string; mes: string }) {
  const { data: k, error } = await db.from('fact_contratos').select('*').eq('id', p.contratoId).single()
  if (error || !k) throw new Error('Contrato inexistente o sin acceso')
  const periodo = periodoFacturacion(reglaDe(k), p.mes)
  // Como Reportes: los turnos van al período por su fecha de inicio.
  const desde = periodo.desde
  const turnos = await fetchPaginado<TurnoFacturable>((a, b) => db.from('turnos')
    .select(CAMPOS_TURNO).eq('objetivo_id', p.objetivoId)
    .gte('fecha', desde).lt('fecha', periodo.hastaExclusivo).order('id').range(a, b))
  // Registros corregidos HACIA este objetivo desde turnos de otro.
  const movidos = await fetchPaginado<RegistroFacturable>((a, b) => db.from('registros_asistencia')
    .select(CAMPOS_REGISTRO).eq('objetivo_final_id', p.objetivoId).order('id').range(a, b))
  const idsMovidos = Array.from(new Set(movidos.map(r => r.turno_id))).filter(id => !turnos.some(t => t.id === id))
  for (let i = 0; i < idsMovidos.length; i += 200) {
    const { data, error: e2 } = await db.from('turnos').select(CAMPOS_TURNO)
      .in('id', idsMovidos.slice(i, i + 200)).gte('fecha', desde).lt('fecha', periodo.hastaExclusivo)
    if (e2) throw e2
    turnos.push(...(data ?? []))
  }
  const registros: RegistroFacturable[] = []
  const ids = turnos.map(t => t.id)
  for (let i = 0; i < ids.length; i += 200) {
    const parte = await fetchPaginado<RegistroFacturable>((a, b) => db.from('registros_asistencia').select(CAMPOS_REGISTRO)
      .in('turno_id', ids.slice(i, i + 200)).order('id').range(a, b))
    registros.push(...parte)
  }
  const franja = k.franja_nocturna_desde && k.franja_nocturna_hasta ? { desde: hhmm(k.franja_nocturna_desde)!, hasta: hhmm(k.franja_nocturna_hasta)! } : null
  const horas = horasDelObjetivo({ objetivoId: p.objetivoId, periodo, turnos, registros, franjaNocturna: franja,
    separarDiurnaNocturna: !!k.separar_diurna_nocturna, superposicion: k.superposicion === 'sumar' ? 'sumar' : 'unir' })
  // Desvío contra la foto aprobada: un cambio posterior de turnos NO altera la
  // aprobación ni la prefactura; sólo se informa para que Administración decida.
  const { data: ap } = await db.from('fact_horas_aprobaciones').select('id, minutos_cubiertos, minutos_descubiertos, minutos_aprobados, aprobado_at')
    .eq('objetivo_id', p.objetivoId).eq('periodo_desde', periodo.desde).eq('periodo_hasta_excl', periodo.hastaExclusivo).eq('estado', 'aprobada').maybeSingle()
  const desvio = ap ? {
    aprobacionId: ap.id, aprobadoAt: ap.aprobado_at,
    cubiertosAprobados: ap.minutos_cubiertos, cubiertosActuales: horas.minutosCubiertos,
    descubiertosAprobados: ap.minutos_descubiertos, descubiertosActuales: horas.minutosDescubiertos,
    hayDiferencia: ap.minutos_cubiertos !== horas.minutosCubiertos || ap.minutos_descubiertos !== horas.minutosDescubiertos,
  } : null
  return { periodo, horas, franjaDefinida: !!franja, superposicion: k.superposicion === 'sumar' ? 'sumar' : 'unir', desvio }
}

/**
 * Recalcula la propuesta en el servidor y la aprueba: el cliente no manda
 * minutos, sólo la decisión comercial sobre lo descubierto (con motivo).
 */
export async function aprobarHoras(db: SupabaseClient, p: {
  contratoId: string; objetivoId: string; mes: string; notas?: string; reemplazar?: boolean; tratamientoDescubiertos?: 'no_facturar' | 'facturar'
}) {
  const { periodo, horas, superposicion } = await proponerHoras(db, p)
  const tratamiento = p.tratamientoDescubiertos === 'facturar' ? 'facturar' : 'no_facturar'
  if (tratamiento === 'facturar' && (p.notas ?? '').trim().length < 4) throw new Error('Para facturar horas descubiertas indicá el motivo comercial')
  const m = minutosAprobables(horas, tratamiento)
  const { data, error } = await db.rpc('fact_horas_aprobar', {
    p_objetivo_id: p.objetivoId, p_contrato_id: p.contratoId, p_desde: periodo.desde, p_hasta_excl: periodo.hastaExclusivo,
    p_minutos: { programados: horas.minutosProgramados, cubiertos: horas.minutosCubiertos, superpuestos: horas.minutosSuperpuestos,
      descubiertos: horas.minutosDescubiertos, aprobados: m.aprobados, diurnos: m.diurnos, nocturnos: m.nocturnos, superposicion, tratamiento,
      // Queda en el historial de la aprobación: liquidadas y no facturadas.
      capacitacion_excluida: horas.minutosCapacitacionLiquidables, capacitacion_turnos: horas.turnosCapacitacion,
      liquidables_reportes: horas.minutosLiquidables, simultaneos: horas.minutosSimultaneos, revisar: horas.revisar.length },
    p_detalle: horas.detalle, p_notas: p.notas ?? null, p_reemplazar: !!p.reemplazar,
  })
  if (error) throw new Error(error.message)
  return { id: data as string, horas, aprobados: m.aprobados }
}

/**
 * Genera o recalcula las prefacturas del mes para los contratos vigentes.
 * No pisa texto editado, no toca emitidas ni descartadas.
 */
/**
 * Tipo de comprobante: el del contrato, el del cliente o el que surge sin duda de
 * la condición frente al IVA. Monotributo o sin condición cargada → null (no se supone).
 */
export function tipoComprobanteDe(contrato?: number | null, cliente?: number | null, condicionIva?: string | null): number | null {
  if (contrato) return contrato
  if (cliente) return cliente
  if (condicionIva === 'responsable_inscripto') return 1
  if (condicionIva === 'exento' || condicionIva === 'consumidor_final' || condicionIva === 'sujeto_no_categorizado') return 6
  return null
}

/** Suma de las fotos de horas aprobadas (una por objetivo). */
function fotoHoras(aps: any[]): HorasAprobadas {
  const sum = (c: string) => aps.reduce((a: number, x: any) => a + (Number(x[c]) || 0), 0)
  const conClasif = aps.every((a: any) => a.minutos_diurnos != null && a.minutos_nocturnos != null)
  return {
    minutosTotales: sum('minutos_aprobados'), minutosProgramados: sum('minutos_programados'), minutosCubiertos: sum('minutos_cubiertos'),
    minutosDescubiertosNoFacturados: aps.filter((a: any) => a.tratamiento_descubiertos !== 'facturar').reduce((s: number, a: any) => s + Number(a.minutos_descubiertos || 0), 0),
    minutosDiurnos: conClasif ? sum('minutos_diurnos') : undefined, minutosNocturnos: conClasif ? sum('minutos_nocturnos') : undefined,
    fuentes: aps.map((a: any) => a.id),
  }
}

export async function generarPrefacturas(db: SupabaseClient, mes: string, hoy = fechaArgentina(), contratoId?: string) {
  const resumen = { creadas: 0, actualizadas: 0, sin_cambios: 0, errores: [] as string[] }
  const [{ data: contratos, error: e1 }, { data: cfg }] = await Promise.all([
    // Con contratoId recalcula sólo ese contrato (Aceptar de una fila); sin él, el mes entero.
    contratoId ? db.from('fact_contratos').select('*, cliente:fact_clientes(id, cuit, razon_social, condicion_iva, tipo_comprobante)').eq('estado', 'vigente').eq('id', contratoId)
      : db.from('fact_contratos').select('*, cliente:fact_clientes(id, cuit, razon_social, condicion_iva, tipo_comprobante)').eq('estado', 'vigente'),
    db.from('fact_config').select('valor').eq('clave', 'emision').maybeSingle(),
  ])
  if (e1) throw new Error(e1.message)
  const puntoVenta = cfg?.valor?.punto_venta ?? null

  for (const k of contratos ?? []) {
    try {
      const periodo = periodoFacturacion(reglaDe(k), mes)
      if (!servicioActivoEnPeriodo({ fechaInicio: k.vigencia_desde, fechaFin: k.vigencia_hasta }, periodo)) continue
      // '*': grupo_factura existe recién con 20261202120000; antes de aplicarla todo sigue igual.
      const { data: vincs } = await db.from('fact_contrato_objetivos').select('*, objetivo:objetivos(id, nombre)').eq('contrato_id', k.id).is('anulado_at', null)
      // Fechas de inicio/fin del servicio: un objetivo terminado no se reactiva.
      const objetivos = (vincs ?? []).filter((v: any) => servicioActivoEnPeriodo({ fechaInicio: v.desde, fechaFin: v.hasta }, periodo))
      const grupos = agruparObjetivos<any>(k, objetivos)
      if (k.modalidad !== 'abono' && !objetivos.length) { resumen.errores.push(`${k.cliente?.razon_social}: contrato sin objetivos vinculados en el período`); continue }

      const { data: tarifasAll } = await db.from('fact_tarifas').select('*').eq('contrato_id', k.id)
        .lte('vigencia_desde', periodo.desde).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.desde}`)
      const { data: cambios } = await db.from('fact_tarifas').select('id').eq('contrato_id', k.id).gt('vigencia_desde', periodo.desde).lt('vigencia_desde', periodo.hastaExclusivo)
      const { data: delPeriodo } = await db.from('fact_prefacturas').select('*').eq('contrato_id', k.id)
        .eq('periodo_desde', periodo.desde).eq('periodo_hasta_excl', periodo.hastaExclusivo).neq('estado', 'descartada')

      for (const g of grupos) {
        const objIds = g.objs.map((v: any) => v.objetivo_id)
        const tarifas = tarifasParaObjetivo(tarifasAll ?? [], g.objetivoId)
        const nombreDe = (v: any) => v.objetivo?.nombre ?? v.objetivo_id
        // Reagrupado: un objetivo que ya está en otra prefactura viva del período no se factura dos veces.
        const ocupados = objetivosEnOtraPrefactura(delPeriodo ?? [], g.clave, objIds, objetivos.map((v: any) => v.objetivo_id))
        if (ocupados.length) {
          resumen.errores.push(`${k.cliente?.razon_social}: ${ocupados.map(o => nombreDe(g.objs.find((v: any) => v.objetivo_id === o.objetivoId))).join(', ')} ya ${ocupados.length > 1 ? 'están' : 'está'} en otra prefactura del período (${ocupados[0].estado}). Descartala antes de reagrupar.`)
          continue
        }

        // Horas aprobadas (foto) de cada objetivo del grupo.
        let horas = null as null | HorasAprobadas
        let porObjetivo: EntradaPrefactura['porObjetivo']
        const faltanAprobar: string[] = []
        if (objIds.length) {
          const { data: aps } = await db.from('fact_horas_aprobaciones').select('*').in('objetivo_id', objIds)
            .eq('periodo_desde', periodo.desde).eq('periodo_hasta_excl', periodo.hastaExclusivo).eq('estado', 'aprobada')
          for (const v of g.objs) if (!(aps ?? []).some((a: any) => a.objetivo_id === v.objetivo_id)) faltanAprobar.push(v.objetivo?.nombre ?? v.objetivo_id)
          if (aps?.length) horas = fotoHoras(aps)
          porObjetivo = renglonesPorObjetivo(g.objs.map((v: any) => ({ objetivo_id: v.objetivo_id, nombre: nombreDe(v) })), tarifasAll ?? [], k.modalidad, id => {
            const propias = (aps ?? []).filter((a: any) => a.objetivo_id === id)
            return propias.length ? fotoHoras(propias) : null
          })
        }

        // OC / presupuesto que cubre el período (compartida: una sola fila).
        const { data: ocs } = await db.from('fact_ordenes_compra').select('*, objetivos:fact_oc_objetivos(objetivo_id), consumos:fact_oc_consumos(neto_c, total_c, horas, anulado_at, prefactura_id)')
          .eq('cliente_id', k.cliente_id).eq('estado', 'vigente')
        const ocCubre = (ocs ?? []).find((o: any) =>
          (!o.vigencia_desde || o.vigencia_desde < periodo.hastaExclusivo) && (!o.vigencia_hasta || o.vigencia_hasta >= periodo.desde) &&
          (!o.objetivos?.length || objIds.some((id: string) => o.objetivos.some((x: any) => x.objetivo_id === id))) &&
          (k.modalidad !== 'presupuesto_anticipado' || o.tipo === 'presupuesto'))
        const clave = clavePrestacion({ clienteId: k.cliente_id, agrupacion: g.clave, desde: periodo.desde, hastaExclusivo: periodo.hastaExclusivo })
        const { data: existente } = await db.from('fact_prefacturas').select('id, version, estado, texto_factura, fecha_vencimiento')
          .eq('cliente_id', k.cliente_id).eq('agrupacion_clave', g.clave).eq('periodo_desde', periodo.desde)
          .eq('periodo_hasta_excl', periodo.hastaExclusivo).neq('estado', 'descartada').maybeSingle()
        if (existente && existente.estado === 'emitida') { resumen.sin_cambios++; continue }

        const oc: OrdenCompraEstado | null = ocCubre ? {
          id: ocCubre.id, numero: ocCubre.numero, vigenciaDesde: ocCubre.vigencia_desde, vigenciaHasta: ocCubre.vigencia_hasta,
          montoNeto: ocCubre.monto_neto_c != null ? Number(ocCubre.monto_neto_c) : null, horas: ocCubre.horas != null ? Number(ocCubre.horas) : null,
          consumidoNeto: (ocCubre.consumos ?? []).filter((c: any) => !c.anulado_at && c.prefactura_id !== existente?.id).reduce((a: number, c: any) => a + Number(c.neto_c), 0),
          montoTotal: ocCubre.monto_total_c != null ? Number(ocCubre.monto_total_c) : null,
          consumidoTotal: (ocCubre.consumos ?? []).filter((c: any) => !c.anulado_at && c.prefactura_id !== existente?.id).reduce((a: number, c: any) => a + Number(c.total_c), 0),
          consumidoHoras: (ocCubre.consumos ?? []).filter((c: any) => !c.anulado_at && c.prefactura_id !== existente?.id).reduce((a: number, c: any) => a + Number(c.horas), 0),
        } : null
        const cumplidos: TipoRequisito[] = []
        if (ocCubre && (ocCubre.tipo !== 'presupuesto')) cumplidos.push('oc_mensual', 'oc_vigente')
        if (ocCubre?.tipo === 'presupuesto' && ocCubre.aceptado_at) cumplidos.push('presupuesto_aceptado')
        if (existente) {
          const { data: conf } = await db.from('fact_conformidades').select('id').eq('prefactura_id', existente.id).eq('tipo', 'conformidad').is('anulado_at', null).limit(1)
          if (conf?.length) cumplidos.push('conformidad')
        }

        let modalidad: Modalidad = k.modalidad
        let tarifasCalc = tarifas
        if (k.modalidad === 'presupuesto_anticipado') {
          // Factura anticipada por el presupuesto aceptado; el saldo de la OC impide volver a facturarlo.
          modalidad = 'abono'
          const base = tarifas.find(t => t.concepto === 'abono')
          tarifasCalc = ocCubre?.monto_neto_c ? [{ id: base?.id ?? `oc:${ocCubre.id}`, concepto: 'abono', precio: String(Number(ocCubre.monto_neto_c) / 100),
            tratamientoIva: base?.tratamientoIva ?? 'sin_definir', alicuotaIva: base?.alicuotaIva ?? '21' }] : []
        }
        const r = calcularPrefactura({
          modalidad, cuitReceptor: k.cliente?.cuit ?? null, periodo, horas, tarifas: tarifasCalc,
          ajustes: [], separarDiurnaNocturna: !!k.separar_diurna_nocturna, requiere: k.requisitos ?? [], cumplidos, oc, anticipoNeto: 0,
          pendientesComerciales: k.pendientes_comerciales ?? [], porObjetivo,
        })
        if (faltanAprobar.length && modalidad !== 'abono') r.requisitos.push({ tipo: 'horas_aprobadas', detalle: `Faltan aprobar horas de: ${faltanAprobar.join(', ')}` })
        if (cambios?.length) r.avisos.push('Hay un cambio de tarifa dentro del período: revisar el precio aplicado.')
        if (!puntoVenta) r.avisos.push('Falta configurar el punto de venta Web Service: se puede aprobar, pero no emitir por ARCA.')
        // Ajustes comerciales aprobados de la prefactura existente.
        if (existente) {
          const { data: ajs } = await db.from('fact_ajustes').select('*').eq('prefactura_id', existente.id).is('anulado_at', null)
          if (ajs?.length) {
            const r2 = calcularPrefactura({
              modalidad, cuitReceptor: k.cliente?.cuit ?? null, periodo, horas, tarifas: tarifasCalc, separarDiurnaNocturna: !!k.separar_diurna_nocturna,
              requiere: k.requisitos ?? [], cumplidos, oc, anticipoNeto: 0, pendientesComerciales: k.pendientes_comerciales ?? [], porObjetivo,
              ajustes: ajs.map((a: any) => ({ id: a.id, descripcion: a.descripcion, importeNeto: Number(a.importe_neto_c), motivo: a.motivo, responsableId: a.creado_por, aprobado: !!a.aprobado_at })),
            })
            Object.assign(r, { lineas: r2.lineas, importes: r2.importes, avisos: [...r.avisos, ...r2.avisos.filter(x => !r.avisos.includes(x))] })
          }
        }
        const tipoComp = tipoComprobanteDe(k.tipo_comprobante, k.cliente?.tipo_comprobante, k.cliente?.condicion_iva)
        if (tipoComp == null) r.requisitos.push({ tipo: 'definicion_comercial', detalle: 'Definir la condición frente al IVA del cliente o el tipo de comprobante (A, B o FCE).' })
        const datos: Record<string, unknown> = {
          cliente_id: k.cliente_id, contrato_id: k.id, agrupacion_clave: g.clave, objetivo_id: g.objetivoId, periodo_mes: mes, objetivos_incluidos: objIds,
          periodo_desde: periodo.desde, periodo_hasta_excl: periodo.hastaExclusivo, estado: estadoSugerido(r),
          horas_aprobacion_ids: horas?.fuentes ?? [], minutos_programados: horas?.minutosProgramados ?? null,
          minutos_cubiertos: horas?.minutosCubiertos ?? null, minutos_aprobados: horas?.minutosTotales ?? null,
          minutos_descubiertos: horas?.minutosDescubiertosNoFacturados ?? null,
          lineas: r.lineas, neto_c: r.importes?.neto ?? null, iva_c: r.importes?.iva ?? null, total_c: r.importes?.total ?? null,
          requisitos: r.requisitos, avisos: r.avisos, cuit_receptor: k.cliente?.cuit ?? null, tipo_comprobante: tipoComp,
          // El vencimiento no se recalcula al regenerar: si no, cada regeneración cambiaría la huella y haría caer la aprobación.
          punto_venta: puntoVenta, fecha_vencimiento: existente?.fecha_vencimiento ?? sumarDias(hoy, Number(k.dias_vencimiento ?? 0)), oc_id: ocCubre?.id ?? null,
          proxima_accion: r.requisitos[0]?.detalle ?? (r.importes ? 'Revisar y aprobar' : null),
        }
        if (!existente) {
          // Texto libre: se propone el de la última factura comparable (mismo cliente y
          // agrupación; si no hay, la última del cliente). Sólo sin antecedente se arma uno.
          const previo = await textoComparable(db, k.cliente_id, g.clave)
          if (previo) {
            datos.texto_factura = previo.texto
            r.avisos.push(`Texto tomado de la factura del período ${previo.periodo}: revisá fechas y cantidades.`)
            datos.avisos = r.avisos
          } else {
            datos.texto_factura = textoPrecargado({ objetivos: g.objs.map((v: any) => v.objetivo?.nombre).filter(Boolean), periodo, lineas: r.lineas, oc: ocCubre?.numero })
          }
        }
        const { error } = await db.rpc('fact_prefactura_guardar', { p_id: existente?.id ?? null, p_datos: datos, p_version: existente?.version ?? null })
        if (error) resumen.errores.push(`${k.cliente?.razon_social} (${clave}): ${error.message}`)
        else if (existente) resumen.actualizadas++
        else resumen.creadas++
      }
    } catch (e: any) {
      resumen.errores.push(`${k.cliente?.razon_social ?? k.id}: ${e?.message ?? e}`)
    }
  }
  return resumen
}

/** Texto de la última factura EMITIDA comparable: misma agrupación primero, luego cualquiera del cliente. */
export async function textoComparable(db: SupabaseClient, clienteId: string, agrupacion: string): Promise<{ texto: string; periodo: string } | null> {
  for (const filtro of [agrupacion, null]) {
    let q = db.from('fact_prefacturas').select('texto_factura, periodo_mes').eq('cliente_id', clienteId).eq('estado', 'emitida').not('texto_factura', 'is', null)
    if (filtro) q = q.eq('agrupacion_clave', filtro)
    const { data } = await q.order('periodo_desde', { ascending: false }).limit(1)
    const t = data?.[0]
    if (t?.texto_factura?.trim()) return { texto: t.texto_factura, periodo: t.periodo_mes }
  }
  return null
}

/** Recalcula las propuestas de conciliación de los ingresos sin cobro registrado. */
export async function proponerConciliacion(db: SupabaseClient, cuitPropio: string, movimientoId?: string) {
  let q = db.from('fact_movimientos_bancarios').select('*').eq('clasificacion', 'cobranza_posible').gt('importe_c', 0)
  if (movimientoId) q = q.eq('id', movimientoId)
  const movs = await fetchPaginado<any>((a, b) => q.order('fecha').range(a, b))
  const { data: cobros } = await db.from('fact_cobros').select('movimiento_id').not('movimiento_id', 'is', null).is('anulado_at', null)
  const conCobro = new Set((cobros ?? []).map((c: any) => c.movimiento_id))
  const pendientes = movs.filter(m => !conCobro.has(m.id))
  if (!pendientes.length) return { procesados: 0, propuestas: 0 }

  const [{ data: clientes }, { data: alias }, saldos, { data: rets }, { data: apRet }] = await Promise.all([
    db.from('fact_clientes').select('id, cuit, razon_social').eq('activo', true),
    db.from('fact_cliente_alias').select('cliente_id, alias, confirmado').is('anulado_at', null),
    fetchPaginado<any>((a, b) => db.from('fact_v_saldos').select('*').gt('saldo_c', 0).order('comprobante_id').range(a, b)),
    db.from('fact_retenciones').select('*').eq('estado', 'certificado_recibido'),
    db.from('fact_aplicaciones').select('retencion_id, importe_c').not('retencion_id', 'is', null).is('revertida_at', null),
  ])
  const ident: ClienteIdentidad[] = (clientes ?? []).map((c: any) => ({ id: c.id, cuit: c.cuit, razonSocial: c.razon_social,
    // Sólo alias confirmados identifican: una equivalencia pendiente no vale como identidad.
    alias: (alias ?? []).filter((a: any) => a.cliente_id === c.id && a.confirmado).map((a: any) => a.alias) }))
  const comps: ComprobanteAbierto[] = saldos.filter(s => s.cliente_id).map(s => ({ id: s.comprobante_id, clienteId: s.cliente_id,
    numeroVisible: numeroVisible({ tipo: s.tipo, puntoVenta: s.punto_venta, numero: Number(s.numero) }), numero: Number(s.numero),
    fecha: s.fecha_emision, total: Number(s.total_c), saldo: Number(s.saldo_c) }))
  const aplicado = new Map<string, number>()
  for (const a of apRet ?? []) aplicado.set(a.retencion_id, (aplicado.get(a.retencion_id) ?? 0) + Number(a.importe_c))
  const retenciones: RetencionDisponible[] = (rets ?? []).map((r: any) => ({ id: r.id, clienteId: r.cliente_id, impuesto: r.impuesto,
    certificado: r.certificado, importe: Number(r.importe_c) - (aplicado.get(r.id) ?? 0), fecha: r.fecha, ordenPago: r.orden_pago,
    comprobanteCitadoId: r.comprobante_citado_id })).filter(r => r.importe > 0)

  let total = 0
  for (const m of pendientes) {
    const { propuestas } = proponerAsociaciones({
      movimiento: { id: m.id, fecha: m.fecha, importe: Number(m.importe_c), concepto: m.concepto, referencia: m.referencia,
        cuitContraparte: m.cuit_contraparte, nombreContraparte: m.nombre_contraparte },
      cuitPropio, clientes: ident, comprobantes: comps, retenciones,
    })
    const { error } = await db.rpc('fact_propuestas_guardar', { p_movimiento_id: m.id, p_propuestas: propuestas })
    if (error) throw new Error(error.message)
    total += propuestas.length
  }
  return { procesados: pendientes.length, propuestas: total }
}
