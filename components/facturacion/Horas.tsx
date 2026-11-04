'use client'
// Horas para facturación: propuesta calculada con los turnos y registros de la
// app → revisión → aprobación (foto). No modifica ningún registro operativo.
import { useEffect, useState } from 'react'
import { api, leer } from '@/lib/facturacion/datos'
import { S, fecha, horas, useAccion } from './comun'

export default function Horas({ mes }: { mes: string }) {
  const [vinculos, setVinculos] = useState<any[]>([])
  const [aprobadas, setAprobadas] = useState<any[]>([])
  const [prop, setProp] = useState<{ key: string; r: any } | null>(null)
  const [trat, setTrat] = useState<'no_facturar' | 'facturar'>('no_facturar')
  const [notas, setNotas] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const v = await leer('fact_contrato_objetivos', q => q.is('anulado_at', null),
      'contrato_id, objetivo_id, desde, hasta, objetivo:objetivos(nombre), contrato:fact_contratos(nombre, estado, regla_periodo, dia_corte, separar_diurna_nocturna, cliente:fact_clientes(razon_social))')
    setVinculos(v.filter(x => x.contrato?.estado === 'vigente'))
    setAprobadas(await leer('fact_horas_aprobaciones', q => q.eq('estado', 'aprobada').order('aprobado_at', { ascending: false }).limit(500)))
  }
  useEffect(() => { correr(cargar) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const clave = (v: any) => `${v.contrato_id}:${v.objetivo_id}`
  return (
    <div style={S.card}>
      <h3 style={S.h3}>Horas de {mes} por objetivo</h3>
      <div style={S.sub}>Fuente: turnos y registros de asistencia de la app. Se factura el tiempo programado efectivamente CUBIERTO por puesto; los relevos superpuestos cuentan una vez y lo descubierto lo decide Administración. No modifica fichajes ni liquidación.</div>
      <Mensaje />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead><tr>{['Cliente', 'Objetivo', 'Servicio', 'Aprobadas', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {vinculos.map(v => {
            const ap = aprobadas.find(a => a.objetivo_id === v.objetivo_id && a.contrato_id === v.contrato_id && a.periodo_desde.slice(0, 7) <= mes && a.periodo_hasta_excl.slice(0, 7) >= mes)
            return (
              <tr key={clave(v)}>
                <td style={S.td}>{v.contrato?.cliente?.razon_social}</td>
                <td style={S.td}>{v.objetivo?.nombre}</td>
                <td style={S.td}>{v.desde ? fecha(v.desde) : '—'} a {v.hasta ? fecha(v.hasta) : 'vigente'}</td>
                <td style={S.td}>{ap ? `${horas(ap.minutos_aprobados)} h (${fecha(ap.periodo_desde)})` : <span style={S.sub}>sin aprobar</span>}</td>
                <td style={S.td}>
                  <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
                    setProp({ key: clave(v), r: await api('horas', { accion: 'proponer', contrato_id: v.contrato_id, objetivo_id: v.objetivo_id, mes }) })
                  })}>Ver propuesta</button>
                </td>
              </tr>
            )
          })}
          {!vinculos.length && <tr><td style={S.td} colSpan={5}><span style={S.sub}>No hay objetivos vinculados a contratos vigentes.</span></td></tr>}
        </tbody>
      </table>

      {prop && (() => {
        const v = vinculos.find(x => clave(x) === prop.key)!
        const h = prop.r.horas
        const ya = aprobadas.some(a => a.objetivo_id === v.objetivo_id && a.periodo_desde === prop.r.periodo.desde && a.periodo_hasta_excl === prop.r.periodo.hastaExclusivo)
        return (
          <div style={{ ...S.card, marginTop: 12 }}>
            <h3 style={S.h3}>{v.objetivo?.nombre} · {fecha(prop.r.periodo.desde)} al {fecha(prop.r.periodo.hastaExclusivo)} (excl.)</h3>
            <div style={S.sub}>Horas FACTURABLES: lo programado cubierto más lo que el supervisor aceptó fuera de turno, lo mismo que se liquida.</div>
            <table style={{ borderCollapse: 'collapse', margin: '6px 0' }}><tbody>
              <tr><td style={S.td}>Horas programadas</td><td style={S.num}>{horas(h.minutosProgramados + h.minutosCapacitacionProgramados)}</td></tr>
              <tr><td style={S.td}>Horas efectivamente cubiertas</td><td style={S.num}>{horas(h.minutosCubiertos + h.minutosCapacitacionLiquidables)}</td></tr>
              <tr><td style={S.td}>Horas de capacitación excluidas{h.turnosCapacitacion ? ` (${h.turnosCapacitacion} turno/s: se liquidan, no se facturan)` : ''}</td><td style={S.num}>{horas(h.minutosCapacitacionLiquidables)}</td></tr>
              <tr><td style={S.td}><b>Horas facturables</b></td><td style={S.num}><b>{horas(h.minutosCubiertos)}</b></td></tr>
              {h.minutosDescubiertos > 0 && <tr><td style={S.td}>Descubiertas (no se facturan salvo decisión)</td><td style={S.num}>{horas(h.minutosDescubiertos)}</td></tr>}
              {h.minutosDiurnos != null && <tr><td style={S.td}>Facturables diurnas / nocturnas</td><td style={S.num}>{horas(h.minutosDiurnos)} / {horas(h.minutosNocturnos)}</td></tr>}
            </tbody></table>
            {h.minutosSuperpuestos > 0 && <div style={S.sub}>{horas(h.minutosSuperpuestos)} h de superposición entre turnos del mismo puesto (relevos): {prop.r.superposicion === 'sumar' ? 'se SUMAN según el contrato' : 'se facturan una sola vez'}.</div>}
            {h.minutosAceptadosFuera > 0 && <div style={S.sub}>Incluye {horas(h.minutosAceptadosFuera)} h fuera del horario programado aceptadas por el supervisor: se liquidan y se facturan.</div>}
            {h.minutosExcedentes > 0 && <div style={S.sub}>{horas(h.minutosExcedentes)} h fichadas fuera del horario programado sin aceptar: no se liquidan ni se facturan.</div>}
            {h.turnosSinPuesto > 0 && <div style={S.aviso}>{h.turnosSinPuesto} turno(s) sin puesto: no se puede controlar la superposición entre ellos.</div>}
            {h.turnosFuturos > 0 && <div style={S.aviso}>{h.turnosFuturos} turno(s) todavía no ocurrieron: el período no está cerrado.</div>}
            {v.contrato?.separar_diurna_nocturna && !prop.r.franjaDefinida && <div style={S.aviso}>El contrato separa diurnas/nocturnas pero no tiene franja contractual: definirla en el contrato.</div>}
            {h.turnosSinRegistro > 0 && <div style={S.aviso}>{h.turnosSinRegistro} turno(s) ya ocurridos sin registro: revisar en Revisión Operativa antes de aprobar.</div>}
            {prop.r.desvio?.hayDiferencia && <div style={S.aviso}>Los registros cambiaron después de la aprobación del {fecha(prop.r.desvio.aprobadoAt)}: aprobado {horas(prop.r.desvio.cubiertosAprobados)} h cubiertas, hoy {horas(prop.r.desvio.cubiertosActuales)} h. La prefactura sigue usando lo aprobado hasta que se reemplace.</div>}
            <details><summary style={S.sub}>Detalle por turno ({h.detalle.length})</summary>
              {h.detalle.map((d: any) => <div key={d.turno_id} style={S.sub}>{fecha(d.fecha)} · {d.estado} · programado {horas(d.programados)} h · cubierto {horas(d.cubiertos)} h · turno {d.turno_id.slice(0, 8)}</div>)}
            </details>
            <div style={{ ...S.fila, marginTop: 8 }}>
              {h.minutosDescubiertos > 0 && <select style={S.input} value={trat} onChange={e => setTrat(e.target.value as 'no_facturar' | 'facturar')}>
                <option value="no_facturar">Descubiertas: no facturar</option>
                <option value="facturar">Descubiertas: facturar igual (decisión comercial)</option>
              </select>}
              <input style={{ ...S.input, minWidth: 260 }} placeholder={trat === 'facturar' ? 'Motivo comercial (obligatorio)' : 'Notas (opcional)'} value={notas} onChange={e => setNotas(e.target.value)} />
              <button style={S.btn} disabled={ocupado} onClick={() => {
                if (ya && !confirm('Ya hay horas aprobadas para este período. ¿Reemplazarlas? (si ya se facturaron, la base lo impide)')) return
                correr(async () => {
                  await api('horas', { accion: 'aprobar', contrato_id: v.contrato_id, objetivo_id: v.objetivo_id, mes, reemplazar: ya, tratamiento_descubiertos: trat, notas })
                  setProp(null); setNotas(''); setTrat('no_facturar'); await cargar()
                }, 'Horas aprobadas para facturación')
              }}>{ya ? 'Reemplazar aprobación' : 'Aprobar estas horas'}</button>
              <button style={S.btn2} onClick={() => setProp(null)}>Cerrar</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
