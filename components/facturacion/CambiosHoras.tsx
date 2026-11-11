'use client'
// Qué cambió en las horas de un objetivo desde que se aceptaron: turno por turno, quién
// cambió qué y por qué, y qué hacer con la diferencia según el estado de la prefactura.
// Sólo muestra: no acepta ni recalcula nada.
import { useEffect, useState } from 'react'
import { api } from '@/lib/facturacion/datos'
import { guiaDiferencia, textoCampo, valorLegible, type EntradaAuditoria, type TurnoConCambios } from '@/lib/facturacion/cambios-horas'
import { S, fecha, horas } from './comun'

const fechaHora = (iso?: string | null) => (iso
  ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—')
const conSigno = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${horas(Math.abs(m))} h`
const EVENTO: Record<string, string> = { turno_cargado: 'Turno cargado', registro_cargado: 'Registro cargado', anulado: 'Anulado', reemplazo: 'Reemplazo' }

type Respuesta = {
  aceptada: { aprobadoAt: string; aprobadoPor: string | null; minutosAprobados: number; minutosCubiertos: number; minutosDescubiertos: number } | null
  actual: { minutosCubiertos: number; minutosDescubiertos: number }
  turnos: TurnoConCambios[]
  recortado?: boolean
  sinFoto?: boolean
}

function lineaAuditoria(m: EntradaAuditoria) {
  const a = valorLegible(m.campo, m.antes), d = valorLegible(m.campo, m.despues)
  return `${fechaHora(m.cuando)} · ${m.quien ?? 'sin dato'}: ${textoCampo(m.campo)}${a || d ? ` ${a ?? '—'} → ${d ?? '—'}` : ''}${m.motivo ? ` — “${m.motivo}”` : ''}`
}

export default function CambiosHoras({ contratoId, objetivoId, mes, estadoPrefactura }: { contratoId: string; objetivoId: string; mes: string; estadoPrefactura: string | null }) {
  const [r, setR] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    setR(null)
    setError(null)
    api<Respuesta>('horas', { accion: 'cambios', contrato_id: contratoId, objetivo_id: objetivoId, mes })
      .then(x => { if (vivo) setR(x) })
      .catch(e => { if (vivo) setError(e?.message ?? 'No se pudo consultar') })
    return () => { vivo = false }
  }, [contratoId, objetivoId, mes])

  if (error) return <div style={{ ...S.aviso, marginBottom: 8 }}>No se pudo ver qué cambió desde la aceptación: {error}</div>
  if (!r) return <div style={{ ...S.sub, marginBottom: 8 }}>Buscando qué cambió desde la aceptación…</div>
  if (!r.aceptada) return null
  const dif = r.actual.minutosCubiertos - r.aceptada.minutosCubiertos
  const difDesc = r.actual.minutosDescubiertos - r.aceptada.minutosDescubiertos
  return (
    <div style={{ ...S.aviso, marginBottom: 8 }}>
      <div>
        <b>Cambiaron las horas desde que se aceptaron</b> ({fechaHora(r.aceptada.aprobadoAt)}{r.aceptada.aprobadoPor ? `, por ${r.aceptada.aprobadoPor}` : ''}):
        {' '}cubiertas {horas(r.aceptada.minutosCubiertos)} h → hoy {horas(r.actual.minutosCubiertos)} h (<b>{conSigno(dif)}</b>).
        {difDesc !== 0 && <> Descubiertas {horas(r.aceptada.minutosDescubiertos)} h → {horas(r.actual.minutosDescubiertos)} h.</>}
      </div>
      {r.turnos.length > 0 && (
        <table style={{ borderCollapse: 'collapse', marginTop: 6, fontSize: 12 }}>
          <thead><tr>{['Fecha', 'Horario', 'Aceptado', 'Hoy', 'Diferencia', 'Quién cambió qué y por qué'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{r.turnos.map(t => (
            <tr key={t.turnoId}>
              <td style={S.td}>{fecha(t.fecha)}</td>
              <td style={S.td}>{t.horario ?? '—'}</td>
              <td style={S.num}>{t.tipo === 'nuevo' ? 'no estaba' : `${horas(t.antes)} h`}</td>
              <td style={S.num}>{t.tipo === 'quitado' ? 'ya no está' : `${horas(t.ahora)} h`}</td>
              <td style={S.num}><b>{conSigno(t.diferencia)}</b></td>
              <td style={S.td}>
                {t.motivos.length > 0
                  ? t.motivos.map((m, i) => <div key={i}>{lineaAuditoria(m)}</div>)
                  : t.eventos.length > 0
                    ? t.eventos.map((e, i) => <div key={i}>{EVENTO[e.tipo] ?? e.tipo}{e.cuando ? ` el ${fechaHora(e.cuando)}` : ''}{e.detalle ? ` (${e.detalle})` : ''}</div>)
                    : <span style={S.sub}>Sin cambio con motivo registrado (puede ser un fichaje o una corrección automática).</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {r.sinFoto && <div style={S.sub}>Esa aceptación no guardó el detalle por turno: sólo se puede comparar el total.</div>}
      {r.recortado && <div style={S.sub}>Se muestran los primeros 300 turnos con cambios.</div>}
      <div style={{ marginTop: 6 }}><b>Qué hacer:</b> {guiaDiferencia(estadoPrefactura, dif, difDesc)}</div>
    </div>
  )
}
