'use client'
// Horas para facturación: una fila por objetivo con la propuesta (horas de
// Reportes → reglas comerciales) al lado, notas, Aprobar y el detalle por turno
// desplegable en la misma fila. "Aprobar todas" aprueba las pendientes de una.
// No modifica ningún registro operativo: cada aprobación es una foto auditada.
import { Fragment, useEffect, useState } from 'react'
import { api, leer } from '@/lib/facturacion/datos'
import { avisosHoras } from '@/lib/facturacion/revision'
import { S, horas, useAccion } from './comun'
import DetalleHoras from './DetalleHoras'

type Fila = { v: any; prop: any | null; error: string | null }

/** Advertencias que conviene mirar antes de aprobar (no bloquean). */
const avisos = (v: any, r: any) => avisosHoras(Boolean(v.contrato?.separar_diurna_nocturna), r)

export default function Horas({ mes }: { mes: string }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [aprobadas, setAprobadas] = useState<any[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [trat, setTrat] = useState<Record<string, 'no_facturar' | 'facturar'>>({})
  const [calculando, setCalculando] = useState(false)
  const { ocupado, correr, Mensaje } = useAccion()
  const clave = (v: any) => `${v.contrato_id}:${v.objetivo_id}`

  async function cargar() {
    const vs = (await leer('fact_contrato_objetivos', q => q.is('anulado_at', null),
      'contrato_id, objetivo_id, desde, hasta, objetivo:objetivos(nombre), contrato:fact_contratos(nombre, estado, separar_diurna_nocturna, cliente:fact_clientes(razon_social))'))
      .filter(x => x.contrato?.estado === 'vigente')
      .sort((a, b) => `${a.contrato?.cliente?.razon_social} ${a.objetivo?.nombre}`.localeCompare(`${b.contrato?.cliente?.razon_social} ${b.objetivo?.nombre}`))
    setAprobadas(await leer('fact_horas_aprobaciones', q => q.eq('estado', 'aprobada').order('aprobado_at', { ascending: false }).limit(1000)))
    setFilas(vs.map(v => ({ v, prop: null, error: null })))
    // Propuestas de todos los objetivos, de a 4 para no saturar el servidor.
    setCalculando(true)
    const res: Fila[] = vs.map(v => ({ v, prop: null, error: null }))
    let i = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < vs.length) {
        const n = i++
        try { res[n] = { v: vs[n], prop: await api('horas', { accion: 'proponer', contrato_id: vs[n].contrato_id, objetivo_id: vs[n].objetivo_id, mes }), error: null } }
        catch (e: any) { res[n] = { v: vs[n], prop: null, error: e?.message ?? 'No se pudo calcular' } }
        setFilas([...res])
      }
    }))
    setCalculando(false)
  }
  useEffect(() => { correr(cargar) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const aprobadaDe = (v: any) => aprobadas.find(a => a.objetivo_id === v.objetivo_id && a.contrato_id === v.contrato_id
    && a.periodo_desde.slice(0, 7) <= mes && a.periodo_hasta_excl.slice(0, 7) >= mes)

  async function aprobar(f: Fila) {
    const k = clave(f.v), t = trat[k] ?? 'no_facturar', ya = Boolean(aprobadaDe(f.v))
    await api('horas', { accion: 'aprobar', contrato_id: f.v.contrato_id, objetivo_id: f.v.objetivo_id, mes, reemplazar: ya, tratamiento_descubiertos: t, notas: notas[k] ?? '' })
  }

  const pendientes = filas.filter(f => f.prop && !aprobadaDe(f.v))
  return (
    <div style={S.card}>
      <div style={{ ...S.fila, justifyContent: 'space-between' }}>
        <h3 style={S.h3}>Horas de {mes} por objetivo</h3>
        <button style={S.btn} disabled={ocupado || calculando || !pendientes.length} onClick={() => {
          if (!confirm(`Aprobar las horas propuestas de ${pendientes.length} objetivo(s) pendiente(s)? Lo ya aprobado no se toca.`)) return
          correr(async () => {
            const errores: string[] = []
            for (const f of pendientes) { try { await aprobar(f) } catch (e: any) { errores.push(`${f.v.objetivo?.nombre}: ${e?.message}`) } }
            await cargar()
            if (errores.length) throw new Error(`No se aprobaron: ${errores.join(' · ')}`)
          }, 'Horas aprobadas')
        }}>{calculando ? 'Calculando…' : `Aprobar todas (${pendientes.length})`}</button>
      </div>
      <div style={S.sub}>Horas de Reportes → Planilla objetivo con las reglas comerciales (sin capacitación; simultáneos se facturan; lo descubierto sólo por decisión). No modifica fichajes ni liquidación.</div>
      <Mensaje />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead><tr>{['', 'Cliente', 'Objetivo', 'Propuestas', 'Aprobadas', 'Notas', ''].map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {filas.map(f => {
            const k = clave(f.v), ap = aprobadaDe(f.v), h = f.prop?.horas, av = f.prop ? avisos(f.v, f.prop) : []
            const t = trat[k] ?? 'no_facturar'
            const propuestas = h ? (t === 'facturar' ? h.minutosCubiertos + h.minutosDescubiertos : h.minutosCubiertos) : null
            const igual = ap && propuestas != null && ap.minutos_aprobados === propuestas
            return (
              <Fragment key={k}>
                <tr style={{ background: abierta === k ? '#111c35' : undefined }}>
                  <td style={S.td}><button style={{ ...S.btn2, padding: '2px 8px' }} disabled={!h} onClick={() => setAbierta(abierta === k ? null : k)}>{abierta === k ? '▾' : '▸'}</button></td>
                  <td style={S.td}>{f.v.contrato?.cliente?.razon_social}</td>
                  <td style={S.td}>{f.v.objetivo?.nombre}{av.length > 0 && <div style={{ color: '#fbbf24', fontSize: 12 }}>⚠ {av.join(' · ')}</div>}</td>
                  <td style={S.num}>{f.error ? <span style={S.err}>{f.error}</span> : propuestas == null ? <span style={S.sub}>…</span> : <b>{horas(propuestas)} h</b>}</td>
                  <td style={S.num}>{ap ? <span style={{ color: igual ? '#4ade80' : '#fbbf24' }}>{horas(ap.minutos_aprobados)} h</span> : <span style={S.sub}>—</span>}</td>
                  <td style={S.td}><input style={{ ...S.input, minWidth: 160 }} placeholder={t === 'facturar' ? 'Motivo (obligatorio)' : 'Notas'} value={notas[k] ?? ''} onChange={e => setNotas({ ...notas, [k]: e.target.value })} /></td>
                  <td style={S.td}>
                    <button style={ap ? S.btn2 : S.btn} disabled={ocupado || !h || Boolean(igual)} onClick={() => {
                      if (ap && !confirm('Ya hay horas aprobadas: ¿reemplazarlas por la propuesta actual? (si ya se facturaron, la base lo impide)')) return
                      correr(async () => { await aprobar(f); await cargar() }, 'Horas aprobadas')
                    }}>{igual ? 'Aprobado' : ap ? 'Reemplazar' : 'Aprobar'}</button>
                  </td>
                </tr>
                {abierta === k && h && (
                  <tr><td style={{ ...S.td, background: '#0b1428' }} colSpan={7}>
                    <DetalleHoras h={h} trat={t} alCambiarTrat={x => setTrat({ ...trat, [k]: x })} />
                  </td></tr>
                )}
              </Fragment>
            )
          })}
          {!filas.length && <tr><td style={S.td} colSpan={7}><span style={S.sub}>No hay objetivos vinculados a contratos vigentes.</span></td></tr>}
        </tbody>
      </table>
    </div>
  )
}
