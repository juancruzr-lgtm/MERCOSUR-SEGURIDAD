'use client'
// Contratos mixtos: conceptos mensuales FIJOS de un contrato (p. ej. "Servicio de
// guardia de alarmas" de Trading), que salen en el mismo comprobante que las
// horas, cada uno con su IVA. Igual que las tarifas: no se editan; una vigencia
// nueva cierra la anterior y el cierre no borra. Todo queda en el historial.
// Escritura: fact_concepto_fijo_agregar / _cerrar (Gerencia o Administración).
import { useEffect, useState } from 'react'
import { leer, rpc } from '@/lib/facturacion/datos'
import { S, fecha, useAccion } from './comun'

const VACIO = { objetivo_id: '', codigo: '', descripcion: '', importe: '', iva: 'adicional', alicuota: '21', desde: '', sin_horas: false, motivo: '' }
const CAMPO: React.CSSProperties = { ...S.input, width: '100%', boxSizing: 'border-box', minWidth: 0 }
const GRILLA: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, alignItems: 'end', marginTop: 8 }
const FORM: React.CSSProperties = { border: '1px dashed #334155', borderRadius: 8, padding: 10, marginTop: 8 }
const CHICO: React.CSSProperties = { ...S.btn2, padding: '4px 10px', fontSize: 12 }

/** "Servicio de guardia de alarmas" → "servicio_de_guardia_de_alarmas" (código estable del concepto). */
export function codigoDesde(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

/**
 * Importe escrito a mano → decimal con punto. "132.611,71" → "132611.71";
 * "132611.71" queda igual. Con coma, los puntos son de miles. Vacío → null.
 */
export function importeDecimal(texto: string): string | null {
  const t = texto.trim().replace(/\s|\$/g, '')
  if (!t) return null
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
}

export function ConceptosFijosContrato({ contratoId, objetivos, nombreObj }: {
  contratoId: string; objetivos: Array<{ objetivo_id: string; objetivo?: { nombre?: string } }>; nombreObj: (id: string) => string
}) {
  const [lista, setLista] = useState<any[]>([])
  const [disponible, setDisponible] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState(VACIO)
  const [cierre, setCierre] = useState<{ id: string; hasta: string; motivo: string } | null>(null)
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    try {
      setLista(await leer('fact_conceptos_fijos', q => q.eq('contrato_id', contratoId).order('codigo').order('vigencia_desde')))
      setDisponible(true)
    } catch (e: any) {
      // Sin la migración 20261208100000 la tabla no existe: la sección se informa, no rompe la ficha.
      if (/fact_conceptos_fijos/.test(e?.message ?? '')) setDisponible(false)
      else throw e
    }
  }
  useEffect(() => { correr(cargar) }, [contratoId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!disponible) return <div style={{ ...S.sub, marginTop: 12 }}>Conceptos mensuales fijos: disponibles cuando se aplique la migración 20261208100000.</div>

  const codigo = f.codigo || codigoDesde(f.descripcion)
  return (
    <div>
      <div style={{ ...S.fila, justifyContent: 'space-between', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Conceptos mensuales fijos <span style={S.sub}>(van en la misma factura que las horas, cada uno con su IVA; sin prorrateo)</span></span>
        <button style={CHICO} onClick={() => { setF(VACIO); setAbierto(!abierto) }}>+ Concepto fijo</button>
      </div>
      <Mensaje />
      {lista.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
          <thead><tr>{['Concepto', 'Objetivo', 'Importe mensual', 'IVA', 'Vigencia', 'Sin horas', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{lista.map(c => (
            <tr key={c.id} style={{ opacity: c.vigencia_hasta ? 0.55 : 1 }}>
              <td style={S.td}>{c.descripcion} <span style={S.sub}>({c.codigo})</span></td>
              <td style={S.td}>{c.objetivo_id ? nombreObj(c.objetivo_id) : 'todo el contrato'}</td>
              <td style={S.num}>$ {c.importe}</td>
              <td style={S.td}>{c.tratamiento_iva === 'sin_definir' ? <b style={{ color: '#fbbf24' }}>SIN DEFINIR</b> : `${c.tratamiento_iva} ${c.alicuota_iva}%`}</td>
              <td style={S.td}>{fecha(c.vigencia_desde)} a {c.vigencia_hasta ? fecha(c.vigencia_hasta) : 'vigente'}</td>
              <td style={S.td}>{c.factura_sin_horas ? 'sí' : 'no'}</td>
              <td style={S.td}>{!c.vigencia_hasta && <button style={CHICO} onClick={() => setCierre({ id: c.id, hasta: '', motivo: '' })}>Cerrar</button>}</td>
            </tr>))}</tbody>
        </table>
      ) : <div style={S.sub}>Sin conceptos fijos: el contrato factura sólo horas o abono.</div>}

      {cierre && (
        <div style={FORM}>
          <div style={{ ...GRILLA, marginTop: 0 }}>
            <label style={{ fontSize: 11, color: '#64748b' }}>Último día que se factura<input style={CAMPO} type="date" value={cierre.hasta} onChange={e => setCierre({ ...cierre, hasta: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: '#64748b', gridColumn: '1 / -1' }}>Motivo<input style={CAMPO} value={cierre.motivo} onChange={e => setCierre({ ...cierre, motivo: e.target.value })} /></label>
          </div>
          <div style={{ ...S.fila, marginTop: 8 }}>
            <button style={S.btn} disabled={ocupado || !cierre.hasta || !cierre.motivo.trim()} onClick={() => correr(async () => {
              await rpc('fact_concepto_fijo_cerrar', { p_id: cierre.id, p_hasta: cierre.hasta, p_motivo: cierre.motivo }); setCierre(null); await cargar()
            }, 'Concepto cerrado')}>Cerrar vigencia</button>
            <button style={S.btn2} onClick={() => setCierre(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {abierto && (
        <div style={FORM}>
          <div style={{ ...GRILLA, marginTop: 0 }}>
            <label style={{ fontSize: 11, color: '#64748b', gridColumn: '1 / -1' }}>Texto del renglón (p. ej. "Servicio de guardia de alarmas")<input style={CAMPO} value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>Código (identifica el concepto; para una vigencia nueva usar el mismo)
              <input style={CAMPO} placeholder={codigoDesde(f.descripcion) || 'guardia_alarmas'} value={f.codigo} onChange={e => setF({ ...f, codigo: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>Objetivo<select style={CAMPO} value={f.objetivo_id} onChange={e => setF({ ...f, objetivo_id: e.target.value })}><option value="">Todo el contrato</option>{objetivos.map(v => <option key={v.objetivo_id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}</select></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>Importe mensual<input style={CAMPO} value={f.importe} onChange={e => setF({ ...f, importe: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>IVA<select style={CAMPO} value={f.iva} onChange={e => setF({ ...f, iva: e.target.value })}><option value="adicional">+ IVA</option><option value="incluido">IVA incluido</option><option value="exento">Exento</option><option value="sin_definir">sin definir</option></select></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>Alícuota %<select style={CAMPO} value={f.alicuota} onChange={e => setF({ ...f, alicuota: e.target.value })}>{['21', '10.5', '27', '0'].map(a => <option key={a}>{a}</option>)}</select></label>
            <label style={{ fontSize: 11, color: '#64748b' }}>Vigente desde<input style={CAMPO} type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: '#64748b', gridColumn: '1 / -1' }}>Motivo / respaldo<input style={CAMPO} value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} /></label>
          </div>
          <label style={{ ...S.sub, display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={f.sin_horas} onChange={e => setF({ ...f, sin_horas: e.target.checked })} />
            Facturar aunque el mes no tenga horas aprobadas (sólo si el contrato lo establece)
          </label>
          <div style={{ ...S.fila, marginTop: 8 }}>
            <button style={S.btn} disabled={ocupado || !f.descripcion.trim() || !f.importe || !f.desde || !f.motivo.trim() || !codigo} onClick={() => correr(async () => {
              await rpc('fact_concepto_fijo_agregar', { p_contrato_id: contratoId, p_objetivo_id: f.objetivo_id || null, p_codigo: codigo, p_descripcion: f.descripcion,
                p_importe: importeDecimal(f.importe),
                p_tratamiento_iva: f.iva, p_alicuota: f.alicuota, p_desde: f.desde, p_factura_sin_horas: f.sin_horas, p_motivo: f.motivo })
              setF(VACIO); setAbierto(false); await cargar()
            }, 'Concepto fijo cargado: se aplica al recalcular las prefacturas en preparación')}>Agregar concepto</button>
            <button style={S.btn2} onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
