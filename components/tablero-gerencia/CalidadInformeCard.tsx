'use client'

/**
 * Calidad (problemas agrupados, reclamos, efectividad) e informe mensual
 * versionado dentro del Tablero de Gerencia. Guardar el informe queda
 * deshabilitado hasta aprobar la migración 20261216120000.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { agruparProblemas, indicadoresCalidad, type ReclamoCliente } from '@/lib/tablero-gerencia/calidad'
import type { Caso, ResumenCasos } from '@/lib/tablero-gerencia/casos'
import type { ComparacionMensual, ResumenHorasMes } from '@/lib/tablero-gerencia/horas'
import { coberturaPreventiva, type SupervisionVisita, type TurnoFranja } from '@/lib/tablero-gerencia/supervision-preventiva'
import { armarInformeMensual, huellaInforme } from '@/lib/tablero-gerencia/informe'

const C = { fondo: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', ambar: '#f59e0b', verde: '#22c55e' }
const sub: CSSProperties = { fontSize: 12, color: C.sub }
const th: CSSProperties = { textAlign: 'left', fontSize: 11, color: C.sub, fontWeight: 600, padding: '6px 8px', borderBottom: `1px solid ${C.borde}` }
const td: CSSProperties = { fontSize: 13, color: C.texto, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' }
const pct = (n: number | null) => n == null ? '—' : `${n} %`

function Tile({ titulo, valor, detalle, color }: { titulo: string; valor: string | number; detalle?: string; color?: string }) {
  return (
    <div style={{ background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '10px 12px', minWidth: 150, flex: '1 1 150px' }}>
      <div style={sub}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? C.texto }}>{valor}</div>
      {detalle && <div style={sub}>{detalle}</div>}
    </div>
  )
}

export default function CalidadInformeCard(p: {
  mes: string
  mesCerrado: boolean
  casos: Caso[]
  resumen: ResumenCasos
  horas: { resumen: ResumenHorasMes; comparacion: ComparacionMensual } | null
  reclamos: ReclamoCliente[] | null
  informes: { version: number; generado_at: string; sha256: string; motivo: string | null }[] | null
  facturacion: { cliente: string; total: number }[] | null
  objetivos: { id: string; nombre?: string | null; frecuencia_supervision_horas?: number | null }[]
  supervisiones: SupervisionVisita[]
  turnos: TurnoFranja[]
  esGerencia: boolean
  nombreObjetivo: (id: string) => string
  nombre: (id: string) => string
  etiquetaTipo: (t: string) => string
}) {
  const ahoraIso = useMemo(() => new Date().toISOString(), [p.casos])
  const cal = useMemo(() => indicadoresCalidad(p.casos, p.reclamos ?? [], ahoraIso), [p.casos, p.reclamos, ahoraIso])
  const problemas = useMemo(() => agruparProblemas(p.casos).filter(x => x.casos.length > 1).slice(0, 10), [p.casos])
  const [verInforme, setVerInforme] = useState(false)
  const [huella, setHuella] = useState<string | null>(null)

  const informe = useMemo(() => {
    if (!p.horas) return null
    const [y, m] = p.mes.split('-').map(Number)
    const desde = new Date(Date.UTC(y, m - 1, 1, 3)).toISOString()
    const hasta = new Date(Math.min(Date.UTC(y, m, 1, 3), Date.now())).toISOString()
    const supervision = coberturaPreventiva({
      desdeIso: desde, hastaIso: hasta, casos: p.casos, supervisiones: p.supervisiones, turnos: p.turnos,
      objetivos: p.objetivos.map(o => ({ id: o.id, nombre: o.nombre ?? '—', frecuencia_supervision_horas: o.frecuencia_supervision_horas ?? null })),
    })
    return armarInformeMensual({
      mes: p.mes, ahoraIso, mesCerrado: p.mesCerrado, horas: p.horas.resumen, comparacion: p.horas.comparacion,
      casos: p.resumen, calidad: cal, supervision, facturacion: p.facturacion,
      advertencias: p.reclamos == null ? ['Reclamos de clientes: falta aplicar la migración 20261216120000; el % detectado antes del reclamo no está disponible.'] : [],
    })
  }, [p, ahoraIso, cal])

  useEffect(() => {
    let vivo = true
    setHuella(null)
    if (verInforme && informe) void huellaInforme(informe).then(h => { if (vivo) setHuella(h) })
    return () => { vivo = false }
  }, [verInforme, informe])

  const motivoNoGuardar = !p.esGerencia ? 'Sólo Gerencia guarda el cierre mensual.'
    : p.informes == null ? 'Guardar versiones requiere aprobar la migración 20261216120000.'
    : !p.mesCerrado ? 'El cierre se guarda cuando termina el mes.'
    : 'Guardado deshabilitado en esta vista previa.'

  return (
    <div style={{ background: '#0b1220', border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: C.texto }}>Calidad del servicio</h3>
      <div style={{ ...sub, marginBottom: 8 }}>Varias alertas de una misma causa cuentan como un solo problema (los casos originales se conservan).</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Tile titulo="Problemas detectados" valor={cal.problemas} detalle={`${cal.detectadosInternamente} casos internos`} />
        <Tile titulo="Reclamos de clientes" valor={p.reclamos == null ? '—' : cal.reclamosClientes} detalle={p.reclamos == null ? 'requiere migración' : `${cal.reclamosConCasoPrevio} ya detectados antes`} />
        <Tile titulo="Detectado antes del reclamo" valor={pct(cal.pctDetectadoAntesDelReclamo)} color={C.verde} />
        <Tile titulo="Tiempo promedio de resolución" valor={cal.horasPromedioResolucion == null ? '—' : `${cal.horasPromedioResolucion} h`} />
        <Tile titulo="Corregidos / verificados" valor={`${cal.resueltos} / ${cal.verificados}`} />
        <Tile titulo="Problemas que reincidieron" valor={cal.problemasReincidentes} color={cal.problemasReincidentes ? C.ambar : undefined} />
        <Tile titulo="Efectividad correctiva" valor={pct(cal.efectividadCorrectiva)} detalle="corregidos que no volvieron" />
      </div>

      {problemas.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <div style={{ ...sub, fontWeight: 600, marginBottom: 4 }}>Problemas repetidos</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Problema', 'Objetivo', 'Persona', 'Casos', 'Desde – hasta', 'Abiertos', 'Reincidió'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{problemas.map(x => (
              <tr key={x.clave}>
                <td style={td}>{p.etiquetaTipo(x.tipo)}{x.causa !== 'indeterminada' && <div style={sub}>causa probable: {x.causa.replace('_', ' ')}</div>}</td>
                <td style={td}>{x.objetivoId ? p.nombreObjetivo(x.objetivoId) : '—'}</td>
                <td style={td}>{x.empleadoId ? p.nombre(x.empleadoId) : <span style={sub}>no es de una persona</span>}</td>
                <td style={td}>{x.casos.length}</td>
                <td style={td}>{x.desde.slice(8, 10)}/{x.desde.slice(5, 7)} – {x.hasta.slice(8, 10)}/{x.hasta.slice(5, 7)}</td>
                <td style={td}>{x.abiertos}</td>
                <td style={td}>{x.reincidio ? <span style={{ color: C.ambar }}>Sí</span> : 'No'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.borde}`, paddingTop: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: C.texto }}>Informe mensual {p.mes}</strong>
          <span style={sub}>{p.informes == null ? 'sin versiones guardadas (requiere migración)' : p.informes.length ? `${p.informes.length} versión(es) guardada(s)` : 'sin versiones guardadas'}</span>
          <button onClick={() => setVerInforme(v => !v)} style={{ background: C.fondo, color: C.texto, border: `1px solid ${C.borde}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>{verInforme ? 'Ocultar' : 'Ver vista previa'}</button>
          <button disabled title={motivoNoGuardar} style={{ background: '#1e293b', color: C.sub, border: 'none', borderRadius: 6, padding: '6px 10px' }}>Guardar versión</button>
          <span style={sub}>{motivoNoGuardar}</span>
        </div>
        {p.informes && p.informes.length > 0 && (
          <div style={{ ...sub, marginTop: 6 }}>{p.informes.map(i => `v${i.version} · ${i.generado_at.slice(0, 16).replace('T', ' ')}${i.motivo ? ` · ${i.motivo}` : ''}`).join('  |  ')}</div>
        )}
        {verInforme && informe && (
          <div style={{ marginTop: 8, fontSize: 13, color: C.texto, display: 'grid', gap: 4 }}>
            <div>Horas trabajadas: <b>{informe.horas.trabajadas.toLocaleString('es-AR')}</b> de {informe.horas.programadasTerminadas.toLocaleString('es-AR')} programadas (turnos terminados) · {informe.horas.comparacionMesAnterior.variacionPct ?? '—'} % vs mes anterior</div>
            <div>Sin fichaje: {informe.horas.cargadasSinFichaje.toLocaleString('es-AR')} h · turnos sin horas: {informe.horas.turnosSinHoras}</div>
            <div>Casos: {informe.operacion.casos.total} (abiertos {informe.operacion.casos.abiertos}, vencidos {informe.operacion.casos.vencidos}, verificados {informe.operacion.casos.verificados}, descartados {informe.operacion.casos.descartados}) · reincidencias {informe.operacion.reincidencias}</div>
            <div>Supervisión: {informe.supervision.visitas} visitas · {informe.supervision.adecuados} objetivos adecuados, {informe.supervision.insuficientes + informe.supervision.sinVisitas} insuficientes · {informe.supervision.pctNocturnas ?? 0} % nocturnas</div>
            <div>Facturación: {informe.facturacion.prefacturado == null ? 'no disponible' : informe.facturacion.prefacturado.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} ({informe.facturacion.fuente})</div>
            <div>Rentabilidad: no disponible — {informe.rentabilidad.motivo}</div>
            {informe.advertencias.map(a => <div key={a} style={{ ...sub, color: C.ambar }}>⚠ {a}</div>)}
            <div style={sub}>Huella SHA-256 de esta vista: {huella ?? 'calculando…'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
