'use client'

/**
 * components/documentacion/MatrizDocumentacion.tsx
 *
 * Situación documental de todo el personal: una fila por persona, una columna
 * por documento del catálogo, con el estado de cada uno. Arriba, el avance
 * general de regularización. Usa los mismos datos y reglas que el legajo
 * (documentacion_control + situacionDeTipo): no hay un segundo cálculo.
 */

import { useMemo, useState } from 'react'
import { situacionDeTipo } from '@/lib/documentacion'
import type { ControlDocumentacionDatos, PersonaControl, SituacionTipo, TipoDocumento } from '@/lib/documentacion'
import { celdaDe } from '@/lib/documentacion-situacion'

const CORTO: Record<string, string> = {
  dni: 'DNI', cuil: 'CUIL', domicilio: 'Domicilio', antecedentes_provincia: 'Antec. prov.', antecedentes_rnr: 'RNR',
  credencial: 'Credencial', acta_credencial: 'Acta cred.', estudios_medicos: 'Médicos', alta_arca: 'Alta ARCA', codem: 'CODEM',
  secundario: 'Secundario', cursos: 'Cursos', sindicato: 'Sindicato', embargos: 'Embargos', sanciones: 'Sanciones',
  cartas_documento: 'CD', baja_arca: 'Baja ARCA', actuaciones_legales: 'Legales',
}
const abreviar = (t: TipoDocumento) => CORTO[t.codigo] ?? t.nombre.slice(0, 12)

export default function MatrizDocumentacion({ datos, personas }: { datos: ControlDocumentacionDatos; personas: PersonaControl[] }) {
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const tipos: TipoDocumento[] = useMemo(() => datos.tipos.filter(t => t.requisito !== 'opcional'), [datos.tipos])

  const filas = useMemo(() => personas.map(p => {
    const celdas = tipos.map(t => ({ t, s: situacionDeTipo(t, p.documentos, datos.hoy, p.situaciones) }))
    const obligatorias = celdas.filter(c => c.t.requisito === 'obligatorio' && c.s.base !== 'no_corresponde')
    const validadas = obligatorias.filter(c => c.s.base === 'validado' || c.s.base === 'por_vencer').length
    return { p, celdas, validadas, obligatorias: obligatorias.length }
  }), [personas, tipos, datos.hoy])

  const ind = useMemo(() => {
    const tot = filas.reduce((a, f) => a + f.obligatorias, 0)
    const ok = filas.reduce((a, f) => a + f.validadas, 0)
    const cuenta = (pred: (c: { s: SituacionTipo }) => boolean) => filas.reduce((a, f) => a + f.celdas.filter(pred).length, 0)
    return {
      avance: tot ? Math.round((ok / tot) * 100) : 0,
      completos: filas.filter(f => f.obligatorias > 0 && f.validadas === f.obligatorias).length,
      enRevision: cuenta(c => c.s.pendiente?.estado === 'pendiente_revision'),
      vencidos: cuenta(c => c.s.base === 'vencido'),
      porVencer: cuenta(c => c.s.base === 'por_vencer'),
      rechazados: cuenta(c => c.s.pendiente?.estado === 'rechazado'),
    }
  }, [filas])

  const visibles = soloFaltantes ? filas.filter(f => f.validadas < f.obligatorias) : filas
  const th: React.CSSProperties = { fontSize: 10.5, color: '#94a3b8', fontWeight: 700, padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#0b1220' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          ['Regularización', `${ind.avance}%`, '#f59e0b'], ['Legajos completos', `${ind.completos} de ${filas.length}`, '#86efac'],
          ['En revisión', ind.enRevision, '#fbbf24'], ['Rechazados', ind.rechazados, '#fca5a5'],
          ['Vencidos', ind.vencidos, '#fca5a5'], ['Por vencer', ind.porVencer, '#fbbf24'],
        ].map(([t, n, c]) => (
          <div key={t as string} style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>{t}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c as string }}>{n}</div>
          </div>
        ))}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
        <input type="checkbox" checked={soloFaltantes} onChange={e => setSoloFaltantes(e.target.checked)} /> Sólo legajos incompletos
      </label>
      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #1e2d42', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2 }}>Persona</th>
              <th style={th}>Oblig.</th>
              {tipos.map(t => <th key={t.codigo} style={th} title={t.nombre}>{abreviar(t)}</th>)}
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
                  return <td key={t.codigo} title={`${t.nombre}: ${c.titulo}`} style={{ textAlign: 'center', color: c.color, background: c.fondo, padding: '5px 3px', fontWeight: 700 }}>{c.corto}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
        OK validado · Rev presentado en revisión · Conf espera constancia · Rech rechazado · Obs error avisado · Venc vencido · xVen por vencer · Sol solicitado · Falta pendiente · N/C no corresponde
      </div>
    </div>
  )
}
