'use client'

/**
 * Entrada del Tablero de Gerencia, en simple:
 *  - "Mes a mes": comparación de todos los meses.
 *  - "Un mes": pocas cifras y dónde mirar.
 *  - El detalle completo (casos, mensajes, supervisión, calidad) queda detrás
 *    de un botón, para quien lo necesite.
 */

import { useMemo, useState } from 'react'
import { alcanceDe, esGerenciaReal, tieneCapacidad } from '@/lib/capacidades'
import { objetivoIdsParaAlertas } from '@/lib/alertas-alcance'
import { permisosTablero } from '@/lib/tablero-gerencia/acceso'
import type { cargarHistorico } from '@/lib/tablero-gerencia/cargar'
import TableroGerenciaPanel, { type TableroGerenciaPanelProps } from './TableroGerenciaPanel'
import ComparacionMensual, { useHistorico } from './ComparacionMensual'
import ResumenDelMes from './ResumenDelMes'

export default function TableroGerenciaInicio(props: TableroGerenciaPanelProps & { cargarHistorico?: typeof cargarHistorico }) {
  const [vista, setVista] = useState<'meses' | 'mes' | 'detalle'>('meses')
  const permisos = useMemo(() => {
    const alcance = alcanceDe(props.user)
    const misZonas = new Set(props.supervisorZonas.filter(z => z.supervisor_id === props.user.id).map(z => z.zona_id))
    return permisosTablero({
      alcance,
      objetivosEnAlcance: objetivoIdsParaAlertas(alcance, props.objetivos, misZonas),
      esGerencia: esGerenciaReal(props.user),
      verDashboardGerencial: tieneCapacidad(props.user, 'ver_dashboard_gerencial'),
    })
  }, [props.user, props.objetivos, props.supervisorZonas])
  const h = useHistorico(permisos.verEconomico, props.cargarHistorico)

  const boton = (v: typeof vista, texto: string) => (
    <button onClick={() => setVista(v)} style={{
      background: vista === v ? '#2563eb' : '#0f172a', color: '#e2e8f0', border: `1px solid ${vista === v ? '#2563eb' : '#1e293b'}`,
      borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer',
    }}>{texto}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {boton('meses', 'Mes a mes')}
        {boton('mes', 'Un mes')}
        <span style={{ flex: 1 }} />
        {vista === 'detalle'
          ? <button onClick={() => setVista('meses')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>← Volver al resumen</button>
          : <button onClick={() => setVista('detalle')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Ver detalle completo (casos y mensajes)</button>}
      </div>
      {vista === 'meses' && <ComparacionMensual objetivos={props.objetivos} objetivosPermitidos={permisos.objetivosPermitidos} verEconomico={permisos.verEconomico} {...h} />}
      {vista === 'mes' && (h.datos
        ? <ResumenDelMes datos={h.datos} objetivos={props.objetivos} guardias={props.guardias} objetivosPermitidos={permisos.objetivosPermitidos} verEconomico={permisos.verEconomico} />
        : <div style={{ color: h.error ? '#f87171' : '#94a3b8', padding: 14 }}>{h.error ? `No se pudo cargar: ${h.error}` : h.progreso}</div>)}
      {vista === 'detalle' && <TableroGerenciaPanel {...props} />}
    </div>
  )
}
