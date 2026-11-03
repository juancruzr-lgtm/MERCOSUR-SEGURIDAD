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
import { horasDelObjetivo, type RegistroFacturable, type TurnoFacturable } from './horas'
import {
  calcularPrefactura, clavePrestacion, estadoSugerido, textoPrecargado,
  type Modalidad, type OrdenCompraEstado, type TarifaVigente, type TipoRequisito,
} from './prefacturacion'
import { proponerAsociaciones, type ClienteIdentidad, type ComprobanteAbierto, type RetencionDisponible } from './conciliacion'
import { numeroVisible } from './comprobantes'

const CAMPOS_REGISTRO = 'id, turno_id, guardia_id, guardia_final_id, objetivo_final_id, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, origen_cobertura, cobertura_anulada_at, cierre_automatico, tipo_registro'

function reglaDe(k: any): ReglaPeriodo {
  return k.regla_periodo === 'corte' ? { tipo: 'corte', diaInicio: Number(k.dia_corte) } : { tipo: 'mes_calendario' }
}
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : null)

/** Propuesta de horas de un objetivo para un contrato y mes. No escribe. */
export async function proponerHoras(db: SupabaseClient, p: { contratoId: string; objetivoId: string; mes: string }) {
  const { data: k, error } = await db.from('fact_contratos').select('*').eq('id', p.contratoId).single()
  if (error || !k) throw new Error('Contrato inexistente o sin acceso')
  const periodo = periodoFacturacion(reglaDe(k), p.mes)
  // Un día antes por los turnos nocturnos que empiezan la víspera y cruzan el límite.
  const desde = sumarDias(periodo.desde, -1)
  const turnos = await fetchPaginado<TurnoFacturable>((a, b) => db.from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, objetivo_id, estado').eq('objetivo_id', p.objetivoId)
    .gte('fecha', desde).lt('fecha', periodo.hastaExclusivo).order('id').range(a, b))
  // Registros corregidos HACIA este objetivo desde turnos de otro.
  const movidos = await fetchPaginado<RegistroFacturable>((a, b) => db.from('registros_asistencia')
    .select(CAMPOS_REGISTRO).eq('objetivo_final_id', p.objetivoId).order('id').range(a, b))
  const idsMovidos = Array.from(new Set(movidos.map(r => r.turno_id))).filter(id => !turnos.some(t => t.id === id))
  for (let i = 0; i < idsMovidos.length; i += 200) {
    const { data, error: e2 } = await db.from('turnos').select('id, fecha, hora_inicio, hora_fin, objetivo_id, estado')
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
  const horas = horasDelObjetivo({ objetivoId: p.objetivoId, periodo, turnos, registros, franjaNocturna: franja, separarDiurnaNocturna: !!k.separar_diurna_nocturna })
  return { periodo, horas, franjaDefinida: !!franja }
}

/** Recalcula la propuesta en el servidor y la aprueba: el cliente no manda minutos. */
export async function aprobarHoras(db: SupabaseClient, p: { contratoId: string; objetivoId: string; mes: string; notas?: string; reemplazar?: boolean }) {
  const { periodo, horas } = await proponerHoras(db, p)
  const { data, error } = await db.rpc('fact_horas_aprobar', {
    p_objetivo_id: p.objetivoId, p_contrato_id: p.contratoId, p_desde: periodo.desde, p_hasta_excl: periodo.hastaExclusivo,
    p_minutos: { registrados: horas.minutosRegistrados, aprobados: horas.minutosRegistrados, diurnos: horas.minutosDiurnos,
      nocturnos: horas.minutosNocturnos, pendientes: horas.minutosSinRegistro },
    p_detalle: horas.detalle, p_notas: p.notas ?? null, p_reemplazar: !!p.reemplazar,
  })
  if (error) throw new Error(error.message)
  return { id: data as string, horas }
}

/**
 * Genera o recalcula las prefacturas del mes para los contratos vigentes.
 * No pisa texto editado, no toca emitidas ni descartadas.
 */
export async function generarPrefacturas(db: SupabaseClient, mes: string, hoy = fechaArgentina()) {
  const resumen = { creadas: 0, actualizadas: 0, sin_cambios: 0, errores: [] as string[] }
  const [{ data: contratos, error: e1 }, { data: cfg }] = await Promise.all([
    db.from('fact_contratos').select('*, cliente:fact_clientes(id, cuit, razon_social, condicion_iva, tipo_comprobante)').eq('estado', 'vigente'),
    db.from('fact_config').select('valor').eq('clave', 'emision').maybeSingle(),
  ])
  if (e1) throw new Error(e1.message)
  const puntoVenta = cfg?.valor?.punto_venta ?? null

  for (const k of contratos ?? []) {
    try {
      const periodo = periodoFacturacion(reglaDe(k), mes)
      if (!servicioActivoEnPeriodo({ fechaInicio: k.vigencia_desde, fechaFin: k.vigencia_hasta }, periodo)) continue
      const { data: vincs } = await db.from('fact_contrato_objetivos').select('objetivo_id, desde, hasta, objetivo:objetivos(id, nombre)').eq('contrato_id', k.id).is('anulado_at', null)
      // Fechas de inicio/fin del servicio: un objetivo terminado no se reactiva.
      const objetivos = (vincs ?? []).filter((v: any) => servicioActivoEnPeriodo({ fechaInicio: v.desde, fechaFin: v.hasta }, periodo))
      const grupos: Array<{ clave: string; objetivoId: string | null; objs: any[] }> = k.agrupacion === 'objetivo'
        ? objetivos.map((v: any) => ({ clave: `objetivo:${v.objetivo_id}`, objetivoId: v.objetivo_id, objs: [v] }))
        : [{ clave: `contrato:${k.id}`, objetivoId: null, objs: objetivos }]
      if (k.modalidad !== 'abono' && !objetivos.length) { resumen.errores.push(`${k.cliente?.razon_social}: contrato sin objetivos vinculados en el período`); continue }

      const { data: tarifasAll } = await db.from('fact_tarifas').select('*').eq('contrato_id', k.id)
        .lte('vigencia_desde', periodo.desde).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.desde}`)
      const { data: cambios } = await db.from('fact_tarifas').select('id').eq('contrato_id', k.id).gt('vigencia_desde', periodo.desde).lt('vigencia_desde', periodo.hastaExclusivo)

      for (const g of grupos) {
        const objIds = g.objs.map((v: any) => v.objetivo_id)
        const tarifas: TarifaVigente[] = (['hora', 'hora_diurna', 'hora_nocturna', 'abono'] as const).flatMap((concepto): TarifaVigente[] => {
          const cands = (tarifasAll ?? []).filter((t: any) => t.concepto === concepto)
          const t = cands.find((x: any) => g.objetivoId && x.objetivo_id === g.objetivoId) ?? cands.find((x: any) => !x.objetivo_id)
          return t ? [{ id: t.id, concepto, precio: String(t.precio), tratamientoIva: t.tratamiento_iva, alicuotaIva: String(t.alicuota_iva) }] : []
        })

        // Horas aprobadas (foto) de cada objetivo del grupo.
        let horas = null as null | { minutosTotales: number; minutosDiurnos?: number; minutosNocturnos?: number; minutosRegistrados: number; minutosPendientesAprobacion: number; fuentes: string[] }
        const faltanAprobar: string[] = []
        if (objIds.length) {
          const { data: aps } = await db.from('fact_horas_aprobaciones').select('*').in('objetivo_id', objIds)
            .eq('periodo_desde', periodo.desde).eq('periodo_hasta_excl', periodo.hastaExclusivo).eq('estado', 'aprobada')
          for (const v of g.objs) if (!(aps ?? []).some((a: any) => a.objetivo_id === v.objetivo_id)) faltanAprobar.push(v.objetivo?.nombre ?? v.objetivo_id)
          if (aps?.length) {
            const sum = (c: string) => aps.reduce((a: number, x: any) => a + (Number(x[c]) || 0), 0)
            const conClasif = aps.every((a: any) => a.minutos_diurnos != null && a.minutos_nocturnos != null)
            horas = {
              minutosTotales: sum('minutos_aprobados'), minutosRegistrados: sum('minutos_registrados'), minutosPendientesAprobacion: sum('minutos_pendientes'),
              minutosDiurnos: conClasif ? sum('minutos_diurnos') : undefined, minutosNocturnos: conClasif ? sum('minutos_nocturnos') : undefined,
              fuentes: aps.map((a: any) => a.id),
            }
          }
        }

        // OC / presupuesto que cubre el período (compartida: una sola fila).
        const { data: ocs } = await db.from('fact_ordenes_compra').select('*, objetivos:fact_oc_objetivos(objetivo_id), consumos:fact_oc_consumos(neto_c, horas, anulado_at, prefactura_id)')
          .eq('cliente_id', k.cliente_id).eq('estado', 'vigente')
        const ocCubre = (ocs ?? []).find((o: any) =>
          (!o.vigencia_desde || o.vigencia_desde < periodo.hastaExclusivo) && (!o.vigencia_hasta || o.vigencia_hasta >= periodo.desde) &&
          (!o.objetivos?.length || objIds.some((id: string) => o.objetivos.some((x: any) => x.objetivo_id === id))) &&
          (k.modalidad !== 'presupuesto_anticipado' || o.tipo === 'presupuesto'))
        const clave = clavePrestacion({ clienteId: k.cliente_id, agrupacion: g.clave, desde: periodo.desde, hastaExclusivo: periodo.hastaExclusivo })
        const { data: existente } = await db.from('fact_prefacturas').select('id, version, estado, texto_factura')
          .eq('cliente_id', k.cliente_id).eq('agrupacion_clave', g.clave).eq('periodo_desde', periodo.desde)
          .eq('periodo_hasta_excl', periodo.hastaExclusivo).neq('estado', 'descartada').maybeSingle()
        if (existente && existente.estado === 'emitida') { resumen.sin_cambios++; continue }

        const oc: OrdenCompraEstado | null = ocCubre ? {
          id: ocCubre.id, numero: ocCubre.numero, vigenciaDesde: ocCubre.vigencia_desde, vigenciaHasta: ocCubre.vigencia_hasta,
          montoNeto: ocCubre.monto_neto_c != null ? Number(ocCubre.monto_neto_c) : null, horas: ocCubre.horas != null ? Number(ocCubre.horas) : null,
          consumidoNeto: (ocCubre.consumos ?? []).filter((c: any) => !c.anulado_at && c.prefactura_id !== existente?.id).reduce((a: number, c: any) => a + Number(c.neto_c), 0),
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
          pendientesComerciales: k.pendientes_comerciales ?? [],
        })
        if (faltanAprobar.length && modalidad !== 'abono') r.requisitos.push({ tipo: 'horas_aprobadas', detalle: `Faltan aprobar horas de: ${faltanAprobar.join(', ')}` })
        if (cambios?.length) r.avisos.push('Hay un cambio de tarifa dentro del período: revisar el precio aplicado.')
        if (!puntoVenta) r.avisos.push('Falta configurar el punto de venta Web Service (no se puede aprobar sin él).')
        // Ajustes comerciales aprobados de la prefactura existente.
        if (existente) {
          const { data: ajs } = await db.from('fact_ajustes').select('*').eq('prefactura_id', existente.id).is('anulado_at', null)
          if (ajs?.length) {
            const r2 = calcularPrefactura({
              modalidad, cuitReceptor: k.cliente?.cuit ?? null, periodo, horas, tarifas: tarifasCalc, separarDiurnaNocturna: !!k.separar_diurna_nocturna,
              requiere: k.requisitos ?? [], cumplidos, oc, anticipoNeto: 0, pendientesComerciales: k.pendientes_comerciales ?? [],
              ajustes: ajs.map((a: any) => ({ id: a.id, descripcion: a.descripcion, importeNeto: Number(a.importe_neto_c), motivo: a.motivo, responsableId: a.creado_por, aprobado: !!a.aprobado_at })),
            })
            Object.assign(r, { lineas: r2.lineas, importes: r2.importes, avisos: [...r.avisos, ...r2.avisos.filter(x => !r.avisos.includes(x))] })
          }
        }
        const tipoComp = k.tipo_comprobante ?? k.cliente?.tipo_comprobante ?? (k.cliente?.condicion_iva === 'responsable_inscripto' ? 1 : 6)
        const datos: Record<string, unknown> = {
          cliente_id: k.cliente_id, contrato_id: k.id, agrupacion_clave: g.clave, objetivo_id: g.objetivoId, periodo_mes: mes,
          periodo_desde: periodo.desde, periodo_hasta_excl: periodo.hastaExclusivo, estado: estadoSugerido(r),
          horas_aprobacion_ids: horas?.fuentes ?? [], minutos_registrados: horas?.minutosRegistrados ?? null,
          minutos_aprobados: horas?.minutosTotales ?? null, minutos_pendientes: horas?.minutosPendientesAprobacion ?? null,
          lineas: r.lineas, neto_c: r.importes?.neto ?? null, iva_c: r.importes?.iva ?? null, total_c: r.importes?.total ?? null,
          requisitos: r.requisitos, avisos: r.avisos, cuit_receptor: k.cliente?.cuit ?? null, tipo_comprobante: tipoComp,
          punto_venta: puntoVenta, fecha_vencimiento: sumarDias(hoy, Number(k.dias_vencimiento ?? 0)), oc_id: ocCubre?.id ?? null,
          proxima_accion: r.requisitos[0]?.detalle ?? (r.importes ? 'Revisar y aprobar' : null),
        }
        if (!existente) datos.texto_factura = textoPrecargado({ objetivos: g.objs.map((v: any) => v.objetivo?.nombre).filter(Boolean), periodo, lineas: r.lineas, oc: ocCubre?.numero })
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
