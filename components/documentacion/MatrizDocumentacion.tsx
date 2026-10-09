'use client'

/**
 * components/documentacion/MatrizDocumentacion.tsx
 *
 * Situación documental de todo el personal: una fila por persona, una columna
 * por documento del catálogo, con el estado de cada uno. Arriba, el avance
 * general de regularización. Usa los mismos datos y reglas que el legajo
 * (documentacion_control + situacionDeTipo): no hay un segundo cálculo.
 *
 * Las referencias del archivo histórico (MEGA) se muestran como una PISTA
 * aparte (H / H? / H✓) para Administración: no cambian la celda, los
 * indicadores ni el cumplimiento.
 */

import { useEffect, useMemo, useState } from 'react'
import { situacionDeTipo } from '@/lib/documentacion'
import type { ControlDocumentacionDatos, PersonaControl, TipoDocumento } from '@/lib/documentacion'
import { ESTADOS_MATRIZ, celdaDe, filtrarMatriz, indicadoresMatriz } from '@/lib/documentacion-situacion'
import type { FilaMatriz } from '@/lib/documentacion-situacion'
import { TEXTO_PISTA, cargarPistasMatriz } from '@/lib/legajo-historico'
import type { PistaHistorica } from '@/lib/legajo-historico'

const CORTO: Record<string, string> = {
  dni: 'DNI', cuil: 'CUIL', domicilio: 'Domicilio', antecedentes_provincia: 'Antec. prov.', antecedentes_rnr: 'RNR',
  credencial: 'Credencial', acta_credencial: 'Acta cred.', estudios_medicos: 'Médicos', alta_arca: 'Alta ARCA', codem: 'CODEM',
  secundario: 'Secundario', cursos: 'Cursos', sindicato: 'Sindicato', embargos: 'Embargos', sanciones: 'Sanciones',
  cartas_documento: 'CD', baja_arca: 'Baja ARCA', actuaciones_legales: 'Legales',
}
const abreviar = (t: TipoDocumento) => CORTO[t.codigo] ?? t.nombre.slice(0, 12)

export default function MatrizDocumentacion({ datos, personas }: { datos: ControlDocumentacionDatos; personas: PersonaControl[] }) {
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('')
  const [tipo, setTipo] = useState('')
  const [pistas, setPistas] = useState<Map<string, PistaHistorica>>(new Map())
  useEffect(() => { void cargarPistasMatriz().then(setPistas) }, [])
  const tipos: TipoDocumento[] = useMemo(() => datos.tipos.filter(t => t.requisito !== 'opcional'), [datos.tipos])

  const filas: FilaMatriz[] = useMemo(() => personas.map(p => {
    const celdas = tipos.map(t => ({ t, s: situacionDeTipo(t, p.documentos, datos.hoy, p.situaciones) }))
    const obligatorias = celdas.filter(c => c.t.requisito === 'obligatorio' && c.s.base !== 'no_corresponde')
    const validadas = obligatorias.filter(c => c.s.base === 'validado' || c.s.base === 'por_vencer').length
    return { p, celdas, validadas, obligatorias: obligatorias.length }
  }), [personas, tipos, datos.hoy])

  // Los indicadores son del total; los filtros sólo cambian lo que se lista.
  const ind = useMemo(() => indicadoresMatriz(filas), [filas])
  const visibles = useMemo(() => filtrarMatriz(filas, { texto, estado, tipo, soloIncompletos: soloFaltantes }),
    [filas, texto, estado, tipo, soloFaltantes])
  const columnas = tipo ? tipos.filter(t => t.codigo === tipo) : tipos
  const control: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42', borderRadius: 8, padding: '6px 8px', fontSize: 13, minWidth: 0 }
  const th: React.CSSProperties = { fontSize: 10.5, color: '#94a3b8', fontWeight: 700, padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#0b1220' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          ['Empleados', ind.empleados, '#e2e8f0'], ['Legajos completos', ind.completos, '#86efac'],
          ['Legajos incompletos', ind.incompletos, '#fca5a5'], ['Regularización', `${ind.avance}%`, '#f59e0b'],
          ['Vencidos', ind.vencidos, '#fca5a5'], ['Por vencer', ind.porVencer, '#fbbf24'],
          ['En revisión', ind.enRevision, '#fbbf24'], ['Rechazados', ind.rechazados, '#fca5a5'],
          ['Pendientes de presentar', ind.pendientesPresentacion, '#fca5a5'],
        ].map(([t, n, c]) => (
          <div key={t as string} style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>{t}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c as string }}>{n}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar persona o legajo" aria-label="Buscar persona o legajo" style={{ ...control, flex: '1 1 180px' }} />
        <select value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Categoría" style={control}>
          <option value="">Todas las categorías</option>
          {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
        </select>
        <select value={estado} onChange={e => setEstado(e.target.value)} aria-label="Estado" style={control}>
          <option value="">Todos los estados</option>
          {ESTADOS_MATRIZ.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#94a3b8' }}>
          <input type="checkbox" checked={soloFaltantes} onChange={e => setSoloFaltantes(e.target.checked)} /> Sólo legajos incompletos
        </label>
        <span style={{ fontSize: 12, color: '#64748b' }}>{visibles.length} de {filas.length}</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #1e2d42', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2 }}>Persona</th>
              <th style={th}>Oblig.</th>
              {columnas.map(t => <th key={t.codigo} style={th} title={t.nombre}>{abreviar(t)}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ p, celdas, validadas, obligatorias }) => (
              <tr key={p.empleado_id} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: '5px 6px', position: 'sticky', left: 0, background: '#0f172a', whiteSpace: 'nowrap' }}>
                  <a href={`/guardias/${p.empleado_id}?seccion=documentacion`} style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.apellido}, {p.nombre}</a>
                </td>
                <td style={{ textAlign: 'center', color: validadas === obligatorias ? '#86efac' : '#cbd5e1' }}>{validadas}/{obligatorias}</td>
                {celdas.map(({ t, s }) => {
                  const c = celdaDe(s)
                  const h = s.base === 'validado' || s.base === 'por_vencer' ? undefined : pistas.get(`${p.empleado_id}|${t.codigo}`)
                  return (
                    <td key={t.codigo} title={`${t.nombre}: ${c.titulo}${h ? ` · ${TEXTO_PISTA[h.nivel].texto} (${h.referencias})` : ''}`}
                      style={{ textAlign: 'center', color: c.color, background: c.fondo, padding: '5px 3px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {c.corto}{h && <sup style={{ color: '#93c5fd', fontWeight: 600, marginLeft: 2 }}>{TEXTO_PISTA[h.nivel].corto}</sup>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
        OK validado · Rev presentado en revisión · Conf espera constancia · Rech rechazado · Obs error avisado · Venc vencido · xVen por vencer · Sol solicitado · Falta pendiente · N/C no corresponde
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
        Archivo histórico (sólo pista, no cuenta como presentado): <span style={{ color: '#93c5fd' }}>H?</span> localizada con conflicto ·{' '}
        <span style={{ color: '#93c5fd' }}>H</span> asociación pendiente · <span style={{ color: '#93c5fd' }}>H✓</span> asociada sin validar. Sin marca: no localizada.
      </div>
    </div>
  )
}
