'use client'
// Cobranzas → Intereses por mora: INFORMATIVOS, sólo para avisarle al cliente. No registra intereses ni pide notas
// de débito. Para cada factura pagada fuera de término o todavía vencida, el interés con la tasa de su contrato o,
// si no tiene, la general (al empezar, BADLAR de bancos privados × 1; la cambia Gerencia acá): a la fecha si sigue
// impaga y con los días cerrados el día del pago si ya se cobró (lib/facturacion/intereses-cobranzas). Por factura
// se puede marcar "no cobrar", con motivo e historial.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { conVencimiento, detalleVencimiento, estadoCobro, type CondicionesPago } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago } from '@/lib/facturacion/condiciones-pago'
import { useIntereses } from '@/lib/facturacion/intereses-cobranzas'
import { CALCULADORA_TIM, SERIES_BCRA, type SerieBcra } from '@/lib/facturacion/serie-bcra'
import { TIPOS_TASA, describirTasa, type TasaMora, type TipoTasa } from '@/lib/facturacion/tasa-mora'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { S, fecha, pesos, useAccion } from './comun'
import { AMBAR, DetalleInteres } from './InteresFactura'

const SIN_FILAS: any[] = []
const numero = (s: string) => { const n = Number(String(s).trim().replace(',', '.')); return String(s).trim() && Number.isFinite(n) ? n : null }
const coma = (n: number) => String(n).replace('.', ',')

export default function InteresesMora() {
  const hoy = fechaArgentina()
  const [hasta, setHasta] = useState(hoy)
  const [cli, setCli] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'pagadas' | 'impagas'>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [base, setBase] = useState<{ filas: any[]; cond: CondicionesPago | null; clientes: Map<string, string> } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [saldos, cond, cls] = await Promise.all([
      leer('fact_v_saldos', q => q.in('tipo', [1, 6, 201]).limit(5000)),
      cargarCondicionesPago(),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social'),
    ])
    setBase({ filas: conVencimiento(saldos, cond), cond, clientes: new Map(cls.map((c: any) => [c.id, c.razon_social])) })
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const intereses = useIntereses(base?.filas ?? SIN_FILAS, base?.cond ?? null, hasta, recarga)
  const calculadas = useMemo(() => {
    const pf = intereses.porFactura
    if (!base || !pf) return []
    return base.filas.flatMap(f => {
      const i = pf.get(f.comprobante_id)
      if (!i || (i.interes_c <= 0 && !i.sin_dato)) return []
      return [{ f, i, est: estadoCobro(f, hasta).estado, cliente: base.clientes.get(f.cliente_id) ?? 'sin cliente',
        nv: numeroVisible({ tipo: Number(f.tipo), puntoVenta: Number(f.punto_venta), numero: Number(f.numero) }) }]
    })
  }, [base, intereses.porFactura, hasta])

  const visibles = calculadas.filter(x => (!cli || x.f.cliente_id === cli) && (filtro === 'todas' || (filtro === 'pagadas') === (x.est === 'pagada')))
  const total = visibles.reduce((s, x) => s + (x.i.noCobrar ? 0 : x.i.interes_c), 0)
  const noSeCobran = visibles.filter(x => x.i.noCobrar)
  const clientesConInteres = Array.from(new Set(calculadas.map(x => x.f.cliente_id))).map(id => ({ id, nombre: base?.clientes.get(id) ?? 'sin cliente' })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const fuentes = (Object.keys(intereses.series) as SerieBcra[]).map(s => {
    const x = intereses.series[s]
    return `${SERIES_BCRA[s].descripcion}${x?.ultima ? `, último dato ${fecha(x.ultima.fecha)}` : ''}`
  })

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Intereses por mora · informativos</h3>
      <div style={S.sub}>
        Sólo para avisarle al cliente: no se registran ni se facturan solos. Cada factura usa la tasa de su contrato (Maestros → Contratos → Condiciones) o,
        si no tiene, la general. Si sigue impaga, es lo acumulado a la fecha; si ya se pagó, los días quedan cerrados el día del pago. Si se decide cobrarlos,
        va con una nota de débito aparte (Comprobantes → NC/ND).
      </div>
      <TasaGeneral general={intereses.general} alGuardar={() => setRecarga(x => x + 1)} />
      <div style={{ ...S.fila, marginTop: 8 }}>
        <label style={S.sub}>Calcular hasta <input type="date" style={S.input} value={hasta} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
        <select style={S.input} value={cli} onChange={e => setCli(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientesConInteres.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {(['todas', 'pagadas', 'impagas'] as const).map(k => <button key={k} style={filtro === k ? S.btn : S.btn2} onClick={() => setFiltro(k)}>
          {k === 'todas' ? 'Todas' : k === 'pagadas' ? 'Pagadas fuera de término' : 'Vencidas sin pagar'}</button>)}
        <Mensaje />
      </div>
      {intereses.error && <div style={{ ...S.err, marginTop: 6 }}>{intereses.error}</div>}
      {fuentes.length > 0 && <div style={{ ...S.sub, marginTop: 6 }}>
        Series del BCRA: {fuentes.join(' · ')}.{intereses.series.tim && <> La TIM se calcula como su <a href={CALCULADORA_TIM} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd' }}>calculadora oficial</a>.</>}
        {' '}La BADLAR, día por día con la tasa del último día hábil (interés simple).
      </div>}
      {(ocupado || intereses.cargando) && <div style={{ ...S.sub, marginTop: 8 }}>Calculando…</div>}
      {!intereses.cargando && base && <>
        <div style={{ marginTop: 10, fontSize: 15 }}>
          <b style={{ color: AMBAR }}>{pesos(total)}</b> <span style={S.sub}>de interés en {visibles.length - noSeCobran.length} factura(s)</span>
          {noSeCobran.length > 0 && <span style={S.sub}> · {noSeCobran.length} marcada(s) «no cobrar» por {pesos(noSeCobran.reduce((s, x) => s + x.i.interes_c, 0))}</span>}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Factura', 'Cliente', 'Vence', 'Pagada el / saldo', 'Tasa', 'Días de mora', 'Interés'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {visibles.map(({ f, i, est, cliente, nv }) => <Fragment key={f.comprobante_id}>
                <tr onClick={() => setAbierta(abierta === f.comprobante_id ? null : f.comprobante_id)} style={{ cursor: 'pointer', background: abierta === f.comprobante_id ? '#111c35' : undefined, opacity: i.noCobrar ? 0.6 : 1 }}>
                  <td style={S.td}>{nv}<div style={S.sub}>{fecha(f.fecha_emision)}</div></td>
                  <td style={S.td}>{cliente}</td>
                  <td style={S.td} title={detalleVencimiento(f)}>{fecha(i.vencimiento)}{!f.vto_comercial && <div style={{ ...S.sub, color: AMBAR }}>{detalleVencimiento(f)}</div>}</td>
                  <td style={S.td}>{!i.cerradaEl ? `saldo ${pesos(f.saldo_c)}` : est === 'pagada' ? `pagada el ${fecha(i.cerradaEl)}` : `cobrada el ${fecha(i.cerradaEl)} (faltan retenciones)`}</td>
                  <td style={S.td}>{describirTasa(i.tasa)}<div style={S.sub}>{i.propia ? 'del contrato' : 'general'}{i.graciaDias ? ` · ${i.graciaDias} días de gracia` : ''}</div></td>
                  <td style={S.num}>{i.dias_mora}</td>
                  <td style={S.num}>{i.noCobrar ? <><span style={{ textDecoration: 'line-through' }}>{pesos(i.interes_c)}</span><div style={S.sub}>no se cobra</div></>
                    : i.interes_c > 0 ? <b style={{ color: AMBAR }}>{pesos(i.interes_c)}</b> : <span style={S.sub}>sin dato</span>}</td>
                </tr>
                {abierta === f.comprobante_id && <tr><td style={S.td} colSpan={7}>
                  <DetalleInteres comprobanteId={f.comprobante_id} i={i} cargando={false} alCambiar={() => setRecarga(x => x + 1)} />
                </td></tr>}
              </Fragment>)}
              {!visibles.length && <tr><td style={S.td} colSpan={7}><span style={S.sub}>Ninguna factura genera interés con estos datos.</span></td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  )
}

/** Tasa general de los intereses (fact_config.intereses). Sólo Gerencia la cambia; queda en el historial. */
function TasaGeneral({ general, alGuardar }: { general: TasaMora | null; alGuardar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [t, setT] = useState<{ tipo: TipoTasa; factor: string; tasa: string; periodo: string }>({ tipo: 'badlar', factor: '1', tasa: '', periodo: 'mensual' })
  const { ocupado, correr, Mensaje } = useAccion()
  useEffect(() => {
    if (general) setT({ tipo: general.tipo, factor: general.tipo === 'badlar' ? coma(general.factor) : '1',
      tasa: general.tipo === 'fija' ? coma(general.tasa) : '', periodo: general.tipo === 'fija' ? general.periodo : 'mensual' })
  }, [general])
  return (
    <div style={{ ...S.fila, marginTop: 10, padding: '8px 10px', border: '1px solid #1e293b', borderRadius: 8 }}>
      <span style={{ fontSize: 13 }}>Tasa general: <b>{general ? describirTasa(general) : '…'}</b> <span style={S.sub}>(la de todos los contratos sin tasa propia)</span></span>
      {!abierto && <button style={S.btn2} onClick={() => setAbierto(true)}>Cambiar (sólo Gerencia)</button>}
      {abierto && <>
        <select style={S.input} value={t.tipo} onChange={e => setT({ ...t, tipo: e.target.value as TipoTasa })}>
          {Object.entries(TIPOS_TASA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {t.tipo === 'badlar' && <label style={S.sub}>BADLAR × <input style={{ ...S.input, width: 80 }} inputMode="decimal" value={t.factor} onChange={e => setT({ ...t, factor: e.target.value })} /></label>}
        {t.tipo === 'fija' && <>
          <input style={{ ...S.input, width: 90 }} inputMode="decimal" placeholder="Tasa %" value={t.tasa} onChange={e => setT({ ...t, tasa: e.target.value })} />
          <select style={S.input} value={t.periodo} onChange={e => setT({ ...t, periodo: e.target.value })}>
            <option value="anual">anual</option><option value="mensual">mensual</option><option value="diaria">diaria</option>
          </select>
        </>}
        <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
          const valor = t.tipo === 'badlar' ? { tipo: 'badlar', factor: numero(t.factor) } : t.tipo === 'fija' ? { tipo: 'fija', tasa: numero(t.tasa), periodo: t.periodo } : { tipo: t.tipo }
          await rpc('fact_intereses_config_guardar', { p_valor: valor })
          setAbierto(false); alGuardar()
        }, 'Tasa general guardada (queda en el historial)')}>Guardar</button>
        <button style={S.btn2} onClick={() => setAbierto(false)}>Cancelar</button>
      </>}
      <Mensaje />
    </div>
  )
}
