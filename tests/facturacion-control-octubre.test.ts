// Corrida en seco del control de octubre 2026 con datos REALES de producción
// (lectura del 03/11/2026: turnos y fichajes de PSA y CIRSE, sin datos personales).
// Formato por turno: fecha|inicio|fin|puesto|estado|entrada_real,salida_real,tipo,anulada|cantidad de registros.
// Lo que debe dar es lo que informó la planilla de octubre: PSA 182 h, CIRSE 248 h.
import { describe, it, expect } from 'vitest'
import { horasDelObjetivo } from '@/lib/facturacion/horas'
import { periodoFacturacion } from '@/lib/facturacion/periodos'
import { calcularPrefactura } from '@/lib/facturacion/prefacturacion'
import { compararConFacturaReal } from '@/lib/facturacion/control'

const PSA = '2026-09-30|09:30:00|18:00:00|59984e2f|programado|09:02:16,17:59:38,fichaje_gps,f|1;2026-10-01|09:30:00|18:00:00|59984e2f|programado|09:08:13,17:57:17,fichaje_gps,f|1;2026-10-02|09:30:00|18:00:00|59984e2f|programado|09:07:52,17:57:07,fichaje_gps,f|1;2026-10-05|09:30:00|18:00:00|59984e2f|programado|09:22:33,17:57:32,fichaje_gps,f|1;2026-10-06|09:30:00|18:00:00|59984e2f|programado|09:17:57,17:57:16,fichaje_gps,f|1;2026-10-07|09:30:00|18:00:00|59984e2f|programado|09:14:27,17:59:58,fichaje_gps,f|1;2026-10-08|09:30:00|18:00:00|59984e2f|programado|09:01:56,18:00:01,fichaje_gps,f|1;2026-10-09|09:30:00|18:00:00|59984e2f|programado|09:02:08,18:00:02,fichaje_gps,f|1;2026-10-13|09:30:00|18:00:00|59984e2f|programado|09:11:28,18:00:03,fichaje_gps,f|1;2026-10-14|09:30:00|18:00:00|59984e2f|programado|09:10:27,18:00:01,fichaje_gps,f|1;2026-10-15|09:30:00|18:00:00|59984e2f|programado|09:13:12,17:56:30,fichaje_gps,f|1;2026-10-16|09:30:00|18:00:00|59984e2f|programado|09:12:21,17:57:51,fichaje_gps,f|1;2026-10-17|09:30:00|13:00:00|59984e2f|programado|09:14:29,13:00:04,fichaje_gps,f|1;2026-10-19|09:30:00|18:00:00|59984e2f|programado|09:18:13,18:00:01,fichaje_gps,f|1;2026-10-20|09:30:00|18:00:00|59984e2f|programado|09:31:59,18:00:13,fichaje_gps,f|1;2026-10-21|09:30:00|18:00:00|59984e2f|programado|09:18:02,18:00:05,fichaje_gps,f|1;2026-10-22|09:30:00|18:00:00|59984e2f|programado|09:13:54,18:00:05,fichaje_gps,f|1;2026-10-23|09:30:00|18:00:00|59984e2f|programado|09:15:08,18:00:15,fichaje_gps,f|1;2026-10-26|09:30:00|18:00:00|59984e2f|programado|09:12:03,18:00:02,fichaje_gps,f|1;2026-10-27|09:30:00|18:00:00|59984e2f|programado|09:07:22,18:00:02,fichaje_gps,f|1;2026-10-28|09:30:00|18:00:00|59984e2f|programado|09:05:19,18:00:13,fichaje_gps,f|1;2026-10-29|09:30:00|18:00:00|59984e2f|programado|09:20:28,18:00:01,fichaje_gps,f|1;2026-10-30|09:30:00|18:00:00|59984e2f|programado|09:20:57,18:00:14,fichaje_gps,f|1'
const CIRSE = '2026-09-30|22:00:00|06:00:00|d2dce7a9|programado|21:56:19,05:54:26,fichaje_gps,f|1;2026-10-01|22:00:00|06:00:00|d2dce7a9|programado|21:38:48,05:53:34,fichaje_gps,f|1;2026-10-02|22:00:00|06:00:00|d2dce7a9|programado|21:34:23,06:00:39,fichaje_gps,f|1;2026-10-03|22:00:00|06:00:00|d2dce7a9|programado|21:43:39,06:12:48,fichaje_gps,f|1;2026-10-04|22:00:00|06:00:00|d2dce7a9|programado|21:43:29,05:55:30,fichaje_gps,f|1;2026-10-05|22:00:00|06:00:00|d2dce7a9|programado|21:37:32,05:58:18,fichaje_gps,f|1;2026-10-06|22:00:00|06:00:00|d2dce7a9|programado|21:45:42,05:40:36,fichaje_gps,f|1;2026-10-07|22:00:00|06:00:00|d2dce7a9|programado|21:41:55,05:57:15,fichaje_gps,f|1;2026-10-08|22:00:00|06:00:00|d2dce7a9|programado|21:49:51,06:00:02,fichaje_gps,f|1;2026-10-09|22:00:00|06:00:00|d2dce7a9|programado|21:42:50,06:01:46,fichaje_gps,f|1;2026-10-10|22:00:00|06:00:00|d2dce7a9|programado|21:33:23,06:01:31,fichaje_gps,f|1;2026-10-11|22:00:00|06:00:00|d2dce7a9|programado|21:38:02,06:04:01,fichaje_gps,f|1;2026-10-12|22:00:00|06:00:00|d2dce7a9|programado|21:42:05,06:02:01,fichaje_gps,f|1;2026-10-13|22:00:00|06:00:00|d2dce7a9|programado|21:37:52,05:44:12,fichaje_gps,f|1;2026-10-14|22:00:00|06:00:00|d2dce7a9|programado|21:41:29,06:00:58,fichaje_gps,f|1;2026-10-15|22:00:00|06:00:00|d2dce7a9|programado|21:44:45,06:01:47,fichaje_gps,f|1;2026-10-16|22:00:00|06:00:00|d2dce7a9|programado|21:46:11,06:02:26,fichaje_gps,f|1;2026-10-17|22:00:00|06:00:00|d2dce7a9|programado|21:55:55,06:06:13,fichaje_gps,f|1;2026-10-18|22:00:00|06:00:00|d2dce7a9|programado|21:52:34,06:00:25,fichaje_gps,f|1;2026-10-19|22:00:00|06:00:00|d2dce7a9|programado|21:45:04,06:00:40,fichaje_gps,f|1;2026-10-20|22:00:00|06:00:00|d2dce7a9|programado|21:51:17,06:02:03,fichaje_gps,f|1;2026-10-21|22:00:00|06:00:00|d2dce7a9|programado|21:47:25,05:51:53,fichaje_gps,f|1;2026-10-22|22:00:00|06:00:00|d2dce7a9|programado|21:52:21,06:01:52,fichaje_gps,f|1;2026-10-23|22:00:00|06:00:00|d2dce7a9|programado|21:44:24,06:05:31,fichaje_gps,f|1;2026-10-24|22:00:00|06:00:00|d2dce7a9|programado|21:52:29,06:16:01,fichaje_gps,f|1;2026-10-25|22:00:00|06:00:00|d2dce7a9|programado|21:40:29,06:00:01,fichaje_gps,f|1;2026-10-26|22:00:00|06:00:00|d2dce7a9|programado|21:35:19,06:05:22,fichaje_gps,f|1;2026-10-27|22:00:00|06:00:00|d2dce7a9|programado|21:46:55,06:00:02,fichaje_gps,f|1;2026-10-28|22:00:00|06:00:00|d2dce7a9|programado|21:42:28,06:01:32,fichaje_gps,f|1;2026-10-29|22:00:00|06:00:00|d2dce7a9|programado|21:40:05,05:52:24,fichaje_gps,f|1;2026-10-30|22:00:00|06:00:00|d2dce7a9|programado|21:42:25,06:00:24,fichaje_gps,f|1;2026-10-31|22:00:00|06:00:00|d2dce7a9|programado|21:39:17,06:00:05,fichaje_gps,f|1'

function armar(texto: string, objetivoId: string) {
  const turnos: any[] = [], registros: any[] = []
  texto.split(';').forEach((linea, i) => {
    const [fecha, ini, fin, puesto, estado, reg] = linea.split('|')
    const id = `t${i}`
    turnos.push({ id, fecha, hora_inicio: ini, hora_fin: fin, objetivo_id: objetivoId, puesto_id: puesto, estado })
    if (reg !== 'SIN') {
      const [entrada, salida, tipo, anulada] = reg.split(',')
      registros.push({ id: `r${i}`, turno_id: id, guardia_id: `g${i}`, hora_entrada_real: entrada, hora_salida_real: salida,
        tipo_registro: tipo, cobertura_anulada_at: anulada === 't' ? '2026-10-31T00:00:00Z' : null })
    }
  })
  return { turnos, registros }
}

describe('comparación prefactura ↔ factura real (septiembre, comprobantes reales de ARCA)', () => {
  const sep = { desde: '2026-09-01', hastaExclusivo: '2026-10-01' }
  const pref = (horas: number, precio: string, iva: 'adicional' | 'incluido', cuit: string, tipo: number) => {
    const r = calcularPrefactura({ modalidad: 'por_hora', cuitReceptor: cuit, periodo: sep, ajustes: [], separarDiurnaNocturna: false,
      requiere: [], cumplidos: [], oc: null, anticipoNeto: 0, pendientesComerciales: [],
      horas: { minutosTotales: horas * 60, minutosProgramados: horas * 60, minutosCubiertos: horas * 60, minutosDescubiertosNoFacturados: 0, fuentes: ['h'] },
      tarifas: [{ id: 't', concepto: 'hora', precio, tratamientoIva: iva, alicuotaIva: '21' }] })
    return { tipo_comprobante: tipo, cuit_receptor: cuit, neto_c: r.importes!.neto, iva_c: r.importes!.iva, total_c: r.importes!.total }
  }

  it('PSA FA 2049 (190,5 h × $13.315 + IVA): total exacto; ARCA informó el neto 2 centavos arriba → registrable', () => {
    const real = { tipo: 1, punto_venta: 1, numero: 2049, doc_nro_receptor: '30547847586', neto_c: 253650752, iva_c: 53266658, total_c: 306917408 }
    const r = compararConFacturaReal(pref(190.5, '13315', 'adicional', '30547847586', 1), real)
    expect(r.coincideTotal).toBe(true)
    expect(r.registrable).toBe(true)
  })

  it('CIRSE FB 835 (240 h × $13.539,49 IVA incluido): mismo total → registrable', () => {
    const real = { tipo: 6, punto_venta: 1, numero: 835, doc_nro_receptor: '30544099457', neto_c: 268551867, iva_c: 56395892, total_c: 324947760 }
    const r = compararConFacturaReal(pref(240, '13539.49', 'incluido', '30544099457', 6), real)
    expect(r.coincideTotal).toBe(true)
    expect(r.registrable).toBe(true)
  })

  it('una hora de diferencia se ve con importe y porcentaje, y no se registra', () => {
    const real = { tipo: 1, punto_venta: 1, numero: 2049, doc_nro_receptor: '30547847586', neto_c: 253650752, iva_c: 53266658, total_c: 306917408 }
    const r = compararConFacturaReal(pref(189.5, '13315', 'adicional', '30547847586', 1), real)
    expect(r.registrable).toBe(false)
    expect(r.filas.find(f => f.campo === 'Total')!.diferencia).toContain('%')
  })
})

describe('control de octubre 2026 (datos reales, corrida en seco)', () => {
  const oct = periodoFacturacion({ tipo: 'mes_calendario' }, '2026-10')
  const base = { periodo: oct, separarDiurnaNocturna: false, franjaNocturna: null, ahora: new Date('2026-11-03T12:00:00Z') }

  it('PSA: 22 turnos de octubre (21 × 8,5 h + 3,5 h) = 182 h, como la planilla; el 30/09 no entra', () => {
    const r = horasDelObjetivo({ ...base, objetivoId: 'PSA', ...armar(PSA, 'PSA') })
    expect(r.minutosProgramados / 60).toBe(182)
    expect(r.minutosCubiertos / 60).toBe(182)
    expect(r.minutosDescubiertos).toBe(0)
    expect(r.turnosSinPuesto).toBe(0)
  })

  it('CIRSE: noches 22→06; el turno del 30/09 aporta 6 h y el del 31/10, 2 h → 248 h en el mes calendario', () => {
    const r = horasDelObjetivo({ ...base, objetivoId: 'CIRSE', ...armar(CIRSE, 'CIRSE') })
    expect(r.minutosProgramados / 60).toBe(248)
    expect(r.minutosCubiertos / 60).toBe(248)
    expect(r.minutosDescubiertos).toBe(0)
  })
})
