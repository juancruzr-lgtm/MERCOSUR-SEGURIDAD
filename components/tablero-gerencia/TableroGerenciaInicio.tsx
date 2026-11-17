'use client'

/**
 * Entrada del Tablero de Gerencia: arranca con la comparación mes a mes
 * (simple) y deja el detalle del mes en una segunda pestaña.
 */

import { useMemo, useState } from 'react'
import { alcanceDe, esGerenciaReal, tieneCapacidad } from '@/lib/capacidades'
import { objetivoIdsParaAlertas } from '@/lib/alertas-alcance'
import { permisosTablero } from '@/lib/tablero-gerencia/acceso'
import TableroGerenciaPanel, { type TableroGerenciaPanelProps } from './TableroGerenciaPanel'
import ComparacionMensual from './ComparacionMensual'

export default function TableroGerenciaInicio(props: TableroGerenciaPanelProps & { cargarHistorico?: Parameters<typeof ComparacionMensual>[0]['cargar'] }) {
  const [vista, setVista] = useState<'meses' | 'detalle'>('meses')
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

  const boton = (v: typeof vista, texto: string) => (
    <button onClick={() => setVista(v)} style={{
      background: vista === v ? '#2563eb' : '#0f172a', color: '#e2e8f0', border: `1px solid ${vista === v ? '#2563eb' : '#1e293b'}`,
      borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer',
    }}>{texto}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {boton('meses', 'Comparación mes a mes')}
        {boton('detalle', 'Detalle de un mes')}
      </div>
      {vista === 'meses'
        ? <ComparacionMensual objetivos={props.objetivos} objetivosPermitidos={permisos.objetivosPermitidos} verEconomico={permisos.verEconomico} cargar={props.cargarHistorico} />
        : <TableroGerenciaPanel {...props} />}
    </div>
  )
}
