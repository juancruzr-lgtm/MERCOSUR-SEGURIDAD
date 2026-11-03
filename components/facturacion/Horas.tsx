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
      <div style={S.sub}>Fuente: turnos y registros de asistencia de la app, con la misma regla de horas liquidables. Los turnos sin registro quedan como pendientes, no como cero.</div>
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
            <div>Registradas: <b>{horas(h.minutosRegistrados)} h</b>
              {h.minutosDiurnos != null && <> · diurnas {horas(h.minutosDiurnos)} · nocturnas {horas(h.minutosNocturnos)}</>}</div>
            {v.contrato?.separar_diurna_nocturna && !prop.r.franjaDefinida && <div style={S.aviso}>El contrato separa diurnas/nocturnas pero no tiene franja contractual: definirla en el contrato.</div>}
            {h.turnosSinRegistro > 0 && <div style={S.aviso}>{h.turnosSinRegistro} turno(s) ya ocurridos sin registro ({horas(h.minutosSinRegistro)} h programadas): revisar en Revisión Operativa antes de aprobar.</div>}
            <details><summary style={S.sub}>Detalle por turno ({h.detalle.length})</summary>
              {h.detalle.map((d: any) => <div key={d.turno_id} style={S.sub}>{fecha(d.fecha)} · {d.estado === 'con_registro' ? `${horas(d.minutos)} h` : 'sin registro'} · turno {d.turno_id.slice(0, 8)}</div>)}
            </details>
            <div style={{ ...S.fila, marginTop: 8 }}>
              <button style={S.btn} disabled={ocupado} onClick={() => {
                if (ya && !confirm('Ya hay horas aprobadas para este período. ¿Reemplazarlas? (si ya se facturaron, la base lo impide)')) return
                correr(async () => {
                  await api('horas', { accion: 'aprobar', contrato_id: v.contrato_id, objetivo_id: v.objetivo_id, mes, reemplazar: ya })
                  setProp(null); await cargar()
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
