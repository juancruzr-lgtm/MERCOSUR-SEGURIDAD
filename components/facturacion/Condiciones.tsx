'use client'
// Condiciones comerciales de pago y mora (por contrato), datos fiscales del
// cliente que se imprimen en el comprobante y datos del emisor. Nada se
// completa con valores supuestos: lo vacío queda "pendiente de definir".
import { useEffect, useState } from 'react'
import { leer, rpc } from '@/lib/facturacion/datos'
import { describirTasa, describirTasaContrato, tasaGeneral, type TasaMora } from '@/lib/facturacion/tasa-mora'
import { S, useAccion } from './comun'

const numero = (x: unknown) => { const t = String(x ?? '').trim().replace(',', '.'); const n = Number(t); return t && Number.isFinite(n) ? n : null }
const coma = (x: unknown) => String(x ?? '').replace('.', ',')

export const EVENTOS_PAGO: Record<string, string> = {
  emision: 'desde la emisión', presentacion: 'desde la presentación', recepcion: 'desde la recepción',
  conformidad: 'desde la conformidad', fecha_fija: 'día fijo del mes',
}
export const CONDICIONES_IVA: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto', exento: 'Exento', consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo', sujeto_no_categorizado: 'Sujeto no categorizado',
}

export function resumenCondiciones(k: any): string {
  if (!k.pago_evento) return 'Condición comercial pendiente de definir'
  const plazo = k.pago_evento === 'fecha_fija'
    ? `día ${k.pago_dia_mes} del mes${k.dias_vencimiento ? ` (tras ${k.dias_vencimiento} días)` : ''}`
    : `${k.dias_vencimiento ?? '?'} días ${EVENTOS_PAGO[k.pago_evento]}`
  return `Pago: ${plazo} · ${describirTasaContrato(k)}`
}

export function CondicionesContrato({ contrato, alGuardar }: { contrato: any; alGuardar: () => void }) {
  const [c, setC] = useState({
    pago_evento: contrato.pago_evento ?? '', dias_vencimiento: contrato.dias_vencimiento ?? '', pago_dia_mes: contrato.pago_dia_mes ?? '',
    mora_tasa_tipo: contrato.mora_tasa_tipo ?? '', mora_tasa_factor: contrato.mora_tasa_factor != null ? coma(Number(contrato.mora_tasa_factor)) : '',
    mora_tasa: contrato.mora_tasa != null ? coma(Number(contrato.mora_tasa)) : '', mora_tasa_periodo: contrato.mora_tasa_periodo ?? 'mensual',
    mora_gracia_dias: contrato.mora_gracia_dias ?? 0, mora_condiciones: contrato.mora_condiciones ?? '',
  })
  // La tasa general, para mostrarla en la opción "Tasa general".
  const [general, setGeneral] = useState<TasaMora | null>(null)
  useEffect(() => { leer<{ valor: unknown }>('fact_config', q => q.eq('clave', 'intereses'), 'valor').then(r => setGeneral(tasaGeneral(r[0]?.valor)), () => setGeneral(null)) }, [])
  const { ocupado, correr, Mensaje } = useAccion()
  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 10, margin: '6px 0' }}>
      <div style={S.sub}>CONDICIONES DE PAGO Y MORA — {contrato.nombre}. Dejá vacío lo que el contrato no define.</div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <input style={{ ...S.input, width: 90 }} placeholder="Plazo (días)" value={c.dias_vencimiento} onChange={e => setC({ ...c, dias_vencimiento: e.target.value })} />
        <select style={S.input} value={c.pago_evento} onChange={e => setC({ ...c, pago_evento: e.target.value })}>
          <option value="">El plazo corre… (sin definir)</option>{Object.entries(EVENTOS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {c.pago_evento === 'fecha_fija' && <input style={{ ...S.input, width: 90 }} placeholder="Día del mes" value={c.pago_dia_mes} onChange={e => setC({ ...c, pago_dia_mes: e.target.value })} />}
      </div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <span style={S.sub}>Intereses por mora (informativos, en Cobranzas):</span>
        <select style={S.input} value={c.mora_tasa_tipo} onChange={e => setC({ ...c, mora_tasa_tipo: e.target.value })}>
          <option value="">Tasa general{general ? ` (${describirTasa(general)})` : ''}</option>
          <option value="badlar">BADLAR × factor propio</option>
          <option value="tim">TIM del BCRA</option>
          <option value="fija">Tasa fija pactada</option>
          <option value="sin_interes">Sin intereses</option>
        </select>
        {c.mora_tasa_tipo === 'badlar' && <label style={S.sub}>BADLAR × <input style={{ ...S.input, width: 80 }} inputMode="decimal" placeholder="1,5" value={c.mora_tasa_factor} onChange={e => setC({ ...c, mora_tasa_factor: e.target.value })} /></label>}
        {c.mora_tasa_tipo === 'fija' && <>
          <input style={{ ...S.input, width: 90 }} inputMode="decimal" placeholder="Tasa %" value={c.mora_tasa} onChange={e => setC({ ...c, mora_tasa: e.target.value })} />
          <select style={S.input} value={c.mora_tasa_periodo} onChange={e => setC({ ...c, mora_tasa_periodo: e.target.value })}>
            <option value="anual">anual</option><option value="mensual">mensual</option><option value="diaria">diaria</option>
          </select>
        </>}
      </div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <input style={{ ...S.input, width: 110 }} placeholder="Días de gracia" value={c.mora_gracia_dias} onChange={e => setC({ ...c, mora_gracia_dias: e.target.value })} />
        <input style={{ ...S.input, flex: 1 }} placeholder="Cláusula / respaldo (p. ej. cláusula 8 del contrato)" value={c.mora_condiciones} onChange={e => setC({ ...c, mora_condiciones: e.target.value })} />
      </div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
          const datos: Record<string, unknown> = {
            pago_evento: c.pago_evento, dias_vencimiento: c.dias_vencimiento, pago_dia_mes: c.pago_dia_mes,
            mora_gracia_dias: c.mora_gracia_dias, mora_condiciones: c.mora_condiciones, mora_tasa_tipo: c.mora_tasa_tipo,
            mora_tasa_factor: '', mora_tasa: '', mora_tasa_periodo: '', mora_metodo: '',
          }
          if (c.mora_tasa_tipo === 'badlar') {
            const f = numero(c.mora_tasa_factor)
            if (f == null || f <= 0 || f > 10) throw new Error('Poné el factor de la BADLAR: mayor que 0 y hasta 10 (p. ej. 1,5)')
            datos.mora_tasa_factor = String(f)
          }
          if (c.mora_tasa_tipo === 'fija') {
            const t = numero(c.mora_tasa)
            if (t == null || t <= 0) throw new Error('Poné la tasa fija pactada (en %)')
            Object.assign(datos, { mora_tasa: String(t), mora_tasa_periodo: c.mora_tasa_periodo || 'mensual', mora_metodo: 'simple' })
          }
          await rpc('fact_contrato_condiciones_guardar', { p_contrato_id: contrato.id, p_datos: datos }); alGuardar()
        }, 'Condiciones guardadas (con historial)')}>Guardar condiciones</button>
        <span style={S.sub}>Los intereses sólo se muestran en Cobranzas para avisarle al cliente: no se registran ni se facturan solos.</span>
        <Mensaje />
      </div>
    </div>
  )
}

export function DatosFiscalesCliente({ cliente, alGuardar }: { cliente: any; alGuardar: () => void }) {
  const [x, setX] = useState({ condicion_iva: cliente.condicion_iva ?? '', domicilio: cliente.domicilio ?? '' })
  const { ocupado, correr, Mensaje } = useAccion()
  return (
    <div style={S.fila}>
      <select style={S.input} value={x.condicion_iva} onChange={e => setX({ ...x, condicion_iva: e.target.value })}>
        <option value="">Condición frente al IVA (sin cargar)</option>{Object.entries(CONDICIONES_IVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input style={{ ...S.input, flex: 1 }} placeholder="Domicilio (se imprime en la factura)" value={x.domicilio} onChange={e => setX({ ...x, domicilio: e.target.value })} />
      <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
        await rpc('fact_cliente_guardar', { p_id: cliente.id, p_version: cliente.version, p_datos: {
          razon_social: cliente.razon_social, cuit: cliente.cuit, tipo_comprobante: cliente.tipo_comprobante ?? '', notas: cliente.notas, ...x } })
        alGuardar()
      }, 'Datos fiscales guardados')}>Guardar</button>
      <Mensaje />
    </div>
  )
}

export function DatosEmisor() {
  const [e, setE] = useState<any>(null)
  const { ocupado, correr, Mensaje } = useAccion()
  useEffect(() => { correr(async () => setE((await leer('fact_config', q => q.eq('clave', 'emisor')))[0]?.valor ?? {})) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return null
  const falta = ['domicilio', 'iibb', 'inicio_actividades'].filter(k => !e[k])
  return (
    <div style={S.card}>
      <h3 style={S.h3}>Datos del emisor impresos en las facturas</h3>
      <div style={S.sub}>{e.razon_social} · CUIT {e.cuit} · {e.condicion_iva}{falta.length ? ` · FALTAN: ${falta.join(', ')} (sin ellos no se genera el PDF)` : ''}</div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Domicilio comercial" value={e.domicilio ?? ''} onChange={x => setE({ ...e, domicilio: x.target.value })} />
        <input style={S.input} placeholder="Ingresos Brutos N°" value={e.iibb ?? ''} onChange={x => setE({ ...e, iibb: x.target.value })} />
        <input style={S.input} placeholder="Inicio de actividades (dd/mm/aaaa)" value={e.inicio_actividades ?? ''} onChange={x => setE({ ...e, inicio_actividades: x.target.value })} />
        <input style={S.input} placeholder="CBU para FCE" value={e.cbu_fce ?? ''} onChange={x => setE({ ...e, cbu_fce: x.target.value })} />
        <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
          await rpc('fact_emisor_guardar', { p_datos: { domicilio: e.domicilio || null, iibb: e.iibb || null, inicio_actividades: e.inicio_actividades || null, cbu_fce: e.cbu_fce || null } })
        }, 'Datos del emisor guardados')}>Guardar</button>
        <Mensaje />
      </div>
    </div>
  )
}
