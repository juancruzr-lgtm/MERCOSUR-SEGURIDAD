'use client'

/**
 * components/legajo/LegajoDigital.tsx
 *
 * Entrada única de Administración y Gerencia para el Legajo Digital: reúne las
 * pantallas que ya existían, sin duplicarlas ni cambiar sus permisos:
 *   - Credenciales: tablero de credenciales y habilitaciones de los vigiladores
 *     (la prioridad del legajo: quién tiene credencial, qué falta y a quién le toca).
 *   - Diferencias con ARCA: la consulta de relaciones laborales de ARCA contra los
 *     usuarios activos y el legajo (contratos con fin, no figura, CUIL, identidad).
 *   - Datos personales: cambios propuestos y datos de la planilla histórica.
 *   - Documentación: revisar, personas, situación (matriz), vencimientos y
 *     auditoría (ésta, sólo Gerencia; la base vuelve a controlar).
 *   - Revisión de MEGA (archivo histórico): bandeja central para revisar las
 *     referencias de MEGA sin entrar a cada legajo.
 *   - Habilitación (sólo Gerencia): abrir o cerrar cada módulo al personal.
 * El legajo individual de cada persona sigue en /guardias/<id>.
 */

import { useState } from 'react'
import ControlCambiosDatos from '@/components/legajo/ControlCambiosDatos'
import ControlDocumentacion from '@/components/documentacion/ControlDocumentacion'
import BandejaHistorico from '@/components/legajo/BandejaHistorico'
import HabilitacionLegajo from '@/components/legajo/HabilitacionLegajo'
import DiferenciasArca from '@/components/legajo/DiferenciasArca'
import TableroHabilitaciones from '@/components/habilitacion/TableroHabilitaciones'
import { controlaHabilitacion } from '@/lib/legajo-habilitacion'
import { esFiltroRevision } from '@/lib/legajo-historico'

export type SeccionLegajo = 'credenciales' | 'arca' | 'datos' | 'documentacion' | 'historico' | 'habilitacion'

const SECCIONES: [SeccionLegajo, string][] = [
  ['credenciales', 'Credenciales'], ['datos', 'Datos personales'], ['documentacion', 'Documentación'], ['historico', 'Revisión de MEGA'], ['arca', 'Diferencias con ARCA'],
]

const pestaña = (activa: boolean): React.CSSProperties => ({
  background: activa ? '#1e293b' : 'transparent', color: activa ? '#e2e8f0' : '#94a3b8',
  border: '1px solid ' + (activa ? '#334155' : 'transparent'), borderRadius: 8, padding: '8px 14px',
  fontWeight: activa ? 800 : 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
})

export default function LegajoDigital({ inicial = 'credenciales', user, empleadoHistorico, verHistorico, tipoHistorico }: {
  inicial?: SeccionLegajo; user?: { puesto_organizacional?: string | null } | null
  /** Abre el archivo histórico filtrado por esta persona (desde su legajo). */
  empleadoHistorico?: string
  /** …y en esta lista (pendientes, conflictos, para investigar, revisadas). */
  verHistorico?: string
  /** …y en este tipo de documento (desde «Credencial y Habilitación»). */
  tipoHistorico?: string
}) {
  const verInicial = esFiltroRevision(verHistorico) ? verHistorico : undefined
  const [seccion, setSeccion] = useState<SeccionLegajo>(inicial)
  // Desde la marca histórica de la matriz: abrir el archivo histórico ya filtrado.
  const [filtroHistorico, setFiltroHistorico] = useState<{ texto: string; categoria: string } | null>(empleadoHistorico ? { texto: empleadoHistorico, categoria: tipoHistorico && /^[a-z0-9_]{2,40}$/.test(tipoHistorico) ? tipoHistorico : '' } : null)
  const secciones = controlaHabilitacion(user) ? [...SECCIONES, ['habilitacion', 'Habilitación'] as [SeccionLegajo, string]] : SECCIONES
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>Legajo Digital</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>El legajo de cada persona se abre desde Guardias.</div>
      </div>
      <div role="tablist" aria-label="Secciones del Legajo Digital" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 2 }}>
        {secciones.map(([id, texto]) => (
          <button key={id} type="button" role="tab" aria-selected={seccion === id} style={pestaña(seccion === id)} onClick={() => { setSeccion(id); setFiltroHistorico(null) }}>{texto}</button>
        ))}
      </div>
      {seccion === 'credenciales' && <TableroHabilitaciones />}
      {seccion === 'arca' && <DiferenciasArca />}
      {seccion === 'datos' && <ControlCambiosDatos />}
      {seccion === 'documentacion' && <ControlDocumentacion onVerHistorico={(texto, categoria) => { setFiltroHistorico({ texto, categoria }); setSeccion('historico') }} />}
      {seccion === 'historico' && <BandejaHistorico key={filtroHistorico ? filtroHistorico.texto + filtroHistorico.categoria : 'todo'} busquedaInicial={filtroHistorico?.texto} categoriaInicial={filtroHistorico?.categoria} verInicial={filtroHistorico?.texto === empleadoHistorico ? verInicial : undefined} />}
      {seccion === 'habilitacion' && controlaHabilitacion(user) && <HabilitacionLegajo />}
    </div>
  )
}
