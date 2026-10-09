'use client'

/**
 * components/legajo/LegajoDigital.tsx
 *
 * Entrada única de Administración y Gerencia para el Legajo Digital: reúne las
 * pantallas que ya existían, sin duplicarlas ni cambiar sus permisos:
 *   - Datos personales: cambios propuestos y datos de la planilla histórica.
 *   - Documentación: revisar, personas, situación (matriz), vencimientos y
 *     auditoría (ésta, sólo Gerencia; la base vuelve a controlar).
 *   - Archivo histórico: referencias de MEGA para asociar o descartar.
 *   - Habilitación (sólo Gerencia): abrir o cerrar cada módulo al personal.
 * El legajo individual de cada persona sigue en /guardias/<id>.
 */

import { useState } from 'react'
import ControlCambiosDatos from '@/components/legajo/ControlCambiosDatos'
import ControlDocumentacion from '@/components/documentacion/ControlDocumentacion'
import BandejaHistorico from '@/components/legajo/BandejaHistorico'
import HabilitacionLegajo from '@/components/legajo/HabilitacionLegajo'
import { controlaHabilitacion } from '@/lib/legajo-habilitacion'

export type SeccionLegajo = 'datos' | 'documentacion' | 'historico' | 'habilitacion'

const SECCIONES: [SeccionLegajo, string][] = [
  ['datos', 'Datos personales'], ['documentacion', 'Documentación'], ['historico', 'Archivo histórico'],
]

const pestaña = (activa: boolean): React.CSSProperties => ({
  background: activa ? '#1e293b' : 'transparent', color: activa ? '#e2e8f0' : '#94a3b8',
  border: '1px solid ' + (activa ? '#334155' : 'transparent'), borderRadius: 8, padding: '8px 14px',
  fontWeight: activa ? 800 : 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
})

export default function LegajoDigital({ inicial = 'datos', user }: { inicial?: SeccionLegajo; user?: { puesto_organizacional?: string | null } | null }) {
  const [seccion, setSeccion] = useState<SeccionLegajo>(inicial)
  // Desde la marca histórica de la matriz: abrir el archivo histórico ya filtrado.
  const [filtroHistorico, setFiltroHistorico] = useState<{ texto: string; categoria: string } | null>(null)
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
      {seccion === 'datos' && <ControlCambiosDatos />}
      {seccion === 'documentacion' && <ControlDocumentacion onVerHistorico={(texto, categoria) => { setFiltroHistorico({ texto, categoria }); setSeccion('historico') }} />}
      {seccion === 'historico' && <BandejaHistorico key={filtroHistorico ? filtroHistorico.texto + filtroHistorico.categoria : 'todo'} busquedaInicial={filtroHistorico?.texto} categoriaInicial={filtroHistorico?.categoria} />}
      {seccion === 'habilitacion' && controlaHabilitacion(user) && <HabilitacionLegajo />}
    </div>
  )
}
