'use client'

/**
 * Página GPS → Vehículos de supervisión (Smart Tag HTAG / red Find Hub).
 *
 * Sólo se monta para quien puede verla (Gerencia / delegación gerencial); la
 * base lo vuelve a exigir con RLS. Todo lo que muestra son detecciones
 * DISCRETAS informadas por la red: no es GPS continuo ni tiempo real. Siempre
 * se muestran por separado la hora de ubicación (detección real) y la hora de
 * consulta (cuándo MERCOSUR preguntó).
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Usuario } from '@/lib/supabase'
import { formatFechaHora } from '@/lib/formato'
import { fechaArgentina, rangoInstantesDiaArgentina } from '@/lib/periodo-argentina'
import { cargarDatosPrueba, cargarHistorialVehiculo, cargarVehiculosSupervision, type FilaVehiculo } from '@/lib/gps-vehiculos/datos'
import {
  ETIQUETA_ANTIGUEDAD, ETIQUETA_ESTADO, clasificarAntiguedad, resumirPrueba, textoEdad, tramosAproximados,
  type ResumenPrueba,
} from '@/lib/gps-vehiculos/posiciones'
import type { PosicionTag, SmartTag } from '@/lib/gps-vehiculos/tipos'
import type { MarcadorTag } from './MapaSmartTags'
import styles from './Gps.module.css'

const MapaSmartTags = dynamic(() => import('./MapaSmartTags'), { ssr: false, loading: () => <div className={styles.vacio}>Cargando mapa…</div> })

const COLOR_ANTIGUEDAD: Record<string, string> = {
  reciente: '#22c55e', horas: '#eab308', antigua: '#f97316', muy_antigua: '#ef4444', sin_posicion: '#64748b',
}

const ESTADO_PRUEBA: Record<ResumenPrueba['estado'], string> = {
  sin_consultas: 'Sin consultas en la ventana: la prueba NO se realizó.',
  incompleta: 'Prueba incompleta: faltan consultas o hubo cortes.',
  completa_simulada: 'Ventana completa, pero con DATOS SIMULADOS (no es un dispositivo real).',
  completa_real: 'Ventana de 24 h completa con consultas reales.',
}

export default function VehiculosSupervision({ guardias, puedeGestionar }: { guardias: Usuario[]; puedeGestionar: boolean }) {
  const [filas, setFilas] = useState<FilaVehiculo[]>([])
  const [tags, setTags] = useState<SmartTag[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const [vehiculoId, setVehiculoId] = useState('')
  const [fecha, setFecha] = useState(fechaArgentina())
  const [historial, setHistorial] = useState<PosicionTag[] | null>(null)

  const [tagPrueba, setTagPrueba] = useState('')
  const [resumen, setResumen] = useState<ResumenPrueba | null>(null)

  const nombre = useCallback((id: string | null) => {
    if (!id) return 'Sin asignar'
    const u = guardias.find(g => g.id === id)
    return u ? `${u.apellido}, ${u.nombre}` : 'Supervisor (sin datos)'
  }, [guardias])
  const supervisores = useMemo(() => guardias.filter(g => String(g.rol).toLowerCase() === 'supervisor'
    || ['supervisor', 'jefe_supervisores'].includes(String((g as any).puesto_organizacional ?? ''))), [guardias])

  const recargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const d = await cargarVehiculosSupervision(supabase)
      setFilas(d.filas); setTags(d.tags)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudieron cargar los vehículos')
    } finally { setCargando(false) }
  }, [])
  useEffect(() => { void recargar() }, [recargar])

  async function verHistorial() {
    if (!vehiculoId) return
    setError(null)
    const r = rangoInstantesDiaArgentina(fecha)
    try { setHistorial(await cargarHistorialVehiculo(supabase, vehiculoId, new Date(r.desde), new Date(r.hasta))) }
    catch (e: any) { setError(e?.message ?? 'No se pudo cargar el historial') }
  }

  async function verPrueba() {
    if (!tagPrueba) return
    setError(null)
    const hasta = new Date(); const desde = new Date(hasta.getTime() - 24 * 3600_000)
    try {
      const d = await cargarDatosPrueba(supabase, tagPrueba, desde, hasta)
      setResumen(resumirPrueba({ ...d, desde, hasta }))
    } catch (e: any) { setError(e?.message ?? 'No se pudo calcular la prueba') }
  }

  async function rpc(nombreRpc: string, args: Record<string, unknown>, ok: string) {
    setError(null); setMensaje(null)
    const { error: e } = await supabase.rpc(nombreRpc, args)
    if (e) { setError(e.message); return }
    setMensaje(ok); void recargar()
  }

  const ahora = new Date()
  const marcadoresActuales: MarcadorTag[] = filas.filter(f => f.ultimaPosicion).map(f => ({
    id: f.vehiculo.id, lat: f.ultimaPosicion!.lat, lng: f.ultimaPosicion!.lng,
    titulo: `${f.vehiculo.identificador} · ${f.vehiculo.patente} — ${nombre(f.ultimaPosicion!.supervisor_id)}`,
    horaUbicacion: f.ultimaPosicion!.hora_ubicacion, horaConsulta: f.ultimaPosicion!.hora_consulta,
    simulado: f.ultimaPosicion!.fuente === 'simulado',
    antigua: ['antigua', 'muy_antigua'].includes(f.antiguedad),
  }))
  const marcadoresHistorial: MarcadorTag[] = (historial ?? []).map(p => ({
    id: String(p.id), lat: p.lat, lng: p.lng, titulo: `Detección · ${nombre(p.supervisor_id)}`,
    horaUbicacion: p.hora_ubicacion, horaConsulta: p.hora_consulta, simulado: p.fuente === 'simulado',
    antigua: clasificarAntiguedad(p.hora_ubicacion, new Date(p.hora_consulta)) !== 'reciente',
  }))
  const tramos = historial ? tramosAproximados(historial) : []
  const haySimulados = filas.some(f => f.tag?.proveedor === 'simulado')

  return (
    <section className={styles.card} style={{ marginTop: 16 }}>
      <div className={styles.panelTitulo}>Vehículos de supervisión · Smart Tag</div>
      <div className={styles.aviso}>
        Posiciones de Smart Tag (red Google Find Hub): se registran sólo cuando un teléfono Android cercano detecta el
        dispositivo. <b>No es GPS continuo ni seguimiento en tiempo real.</b> No se mezclan con el GPS de los teléfonos
        de los supervisores. Integración real con Google Find Hub: <b>no habilitada</b>.
      </div>
      {haySimulados && <div className={styles.aviso}>Hay Smart Tags <b>SIMULADOS</b>: sus posiciones son ficticias, sólo para probar el módulo.</div>}
      {error && <div className={styles.error}>{error}</div>}
      {mensaje && <div className={styles.ok}>{mensaje}</div>}

      {cargando ? <div className={styles.vacio}>Cargando vehículos…</div> : filas.length === 0 ? (
        <div className={styles.vacio}>Todavía no hay vehículos registrados.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#e2e8f0' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
              <th>Vehículo</th><th>Supervisor</th><th>Smart Tag</th><th>Asignación</th>
              <th>Última ubicación</th><th>Hora de ubicación</th><th>Última consulta</th><th>Estado</th>
            </tr></thead>
            <tbody>{filas.map(f => (
              <tr key={f.vehiculo.id} style={{ borderTop: '1px solid #1e2d42' }}>
                <td><b>{f.vehiculo.identificador}</b><br />{f.vehiculo.patente}</td>
                <td>{nombre(f.supervisorId)}</td>
                <td>{f.tag ? <>{f.tag.nombre}{f.tag.proveedor === 'simulado' && <b> · SIMULADO</b>}</> : '—'}</td>
                <td>{f.estadoAsignacion.replace('_', ' ')}</td>
                <td>{f.ultimaPosicion ? `${f.ultimaPosicion.lat.toFixed(5)}, ${f.ultimaPosicion.lng.toFixed(5)}` : '—'}</td>
                <td>
                  {f.ultimaPosicion ? formatFechaHora(f.ultimaPosicion.hora_ubicacion) : '—'}<br />
                  <span style={{ color: COLOR_ANTIGUEDAD[f.antiguedad] }}>
                    {ETIQUETA_ANTIGUEDAD[f.antiguedad]}{f.ultimaPosicion && ` (${textoEdad(f.ultimaPosicion.hora_ubicacion, ahora)})`}
                  </span>
                </td>
                <td>{f.ultimaConsulta ? <>{formatFechaHora(f.ultimaConsulta.hora_consulta)}<br />{f.ultimaConsulta.resultado.replace('_', ' ')}</> : '—'}</td>
                <td>{ETIQUETA_ESTADO[f.estado]}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {marcadoresActuales.length > 0 && !historial && (
        <div style={{ marginTop: 12 }}>
          <MapaSmartTags marcadores={marcadoresActuales} tramos={[]} />
        </div>
      )}

      <div className={styles.filtros} style={{ marginTop: 12 }}>
        <label className={styles.campo}><span className={styles.label}>Historial del vehículo</span>
          <select className={styles.input} value={vehiculoId} onChange={e => { setVehiculoId(e.target.value); setHistorial(null) }}>
            <option value="">Elegir…</option>
            {filas.map(f => <option key={f.vehiculo.id} value={f.vehiculo.id}>{f.vehiculo.identificador} · {f.vehiculo.patente}</option>)}
          </select>
        </label>
        <label className={styles.campo}><span className={styles.label}>Fecha (Argentina)</span>
          <input className={styles.input} type="date" value={fecha} onChange={e => { setFecha(e.target.value); setHistorial(null) }} />
        </label>
        <button className={styles.boton} onClick={verHistorial} disabled={!vehiculoId}>Ver historial</button>
        {historial && <button className={styles.boton} onClick={() => setHistorial(null)}>Volver a últimas ubicaciones</button>}
      </div>

      {historial && (
        <div style={{ marginTop: 8 }}>
          <div className={styles.soloLectura}>
            {historial.length} detecciones el {fecha}. Las líneas punteadas son <b>conexiones aproximadas</b> entre
            detecciones (no se unen huecos de más de 2 h). No representan el recorrido real ni permiten medir kilómetros.
          </div>
          {historial.length > 0 && <MapaSmartTags marcadores={marcadoresHistorial} tramos={tramos} />}
          <ul style={{ fontSize: 12, color: '#cbd5e1', maxHeight: 200, overflowY: 'auto' }}>
            {historial.map(p => (
              <li key={p.id}>
                Detectado {formatFechaHora(p.hora_ubicacion)} · consultado {formatFechaHora(p.hora_consulta)} ·
                {' '}{nombre(p.supervisor_id)}{p.fuente === 'simulado' && ' · SIMULADO'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.filtros} style={{ marginTop: 12 }}>
        <label className={styles.campo}><span className={styles.label}>Prueba de 24 h (últimas 24 h)</span>
          <select className={styles.input} value={tagPrueba} onChange={e => { setTagPrueba(e.target.value); setResumen(null) }}>
            <option value="">Elegir Smart Tag…</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.nombre}{t.proveedor === 'simulado' ? ' (SIMULADO)' : ''}</option>)}
          </select>
        </label>
        <button className={styles.boton} onClick={verPrueba} disabled={!tagPrueba}>Calcular métricas</button>
      </div>
      {resumen && (
        <div className={styles.diagnostico}>
          <b>{ESTADO_PRUEBA[resumen.estado]}</b>
          <div>Consultas: {resumen.consultas} de {resumen.consultasEsperadas} esperadas · omitidas por límite: {resumen.omitidasPorLimite}</div>
          <div>Con posición nueva: {resumen.conNuevaPosicion} · sin posición nueva: {resumen.sinNuevaPosicion} ({resumen.pctSinNuevaPosicion ?? '—'} %) · errores: {resumen.errores}</div>
          <div>Posiciones nuevas: {resumen.posicionesNuevas} · horas con detección: {resumen.horasConDeteccion}/24</div>
          <div>Minutos entre detecciones: mediana {resumen.minutosEntreDetecciones.mediana ?? '—'} · máx {resumen.minutosEntreDetecciones.maximo ?? '—'}</div>
          <div>Antigüedad al recibirlas (min): mediana {resumen.antiguedadAlRecibirMin.mediana ?? '—'} · máx {resumen.antiguedadAlRecibirMin.maximo ?? '—'}</div>
          <div>Mayor hueco entre consultas: {resumen.mayorHuecoEntreConsultasMin ?? '—'} min · historial útil: {resumen.historialUtil ? 'sí' : 'no'}</div>
        </div>
      )}

      {puedeGestionar && <Gestion filas={filas} tags={tags} supervisores={supervisores} rpc={rpc} />}
    </section>
  )
}

function Gestion({ filas, tags, supervisores, rpc }: {
  filas: FilaVehiculo[]; tags: SmartTag[]; supervisores: Usuario[]
  rpc: (n: string, a: Record<string, unknown>, ok: string) => Promise<void>
}) {
  const [ident, setIdent] = useState(''); const [patente, setPatente] = useState('')
  const [tagNombre, setTagNombre] = useState(''); const [tagSimulado, setTagSimulado] = useState(true)
  const [vehiculo, setVehiculo] = useState(''); const [tag, setTag] = useState(''); const [sup, setSup] = useState('')
  return (
    <details style={{ marginTop: 12 }}>
      <summary className={styles.label} style={{ cursor: 'pointer' }}>Gestión de vehículos y Smart Tags (Gerencia)</summary>
      <div className={styles.filtros}>
        <input className={styles.input} placeholder="Identificador (ej. MOV-01)" value={ident} onChange={e => setIdent(e.target.value)} />
        <input className={styles.input} placeholder="Patente" value={patente} onChange={e => setPatente(e.target.value)} />
        <button className={styles.boton} disabled={!ident || !patente}
          onClick={() => rpc('gps_vehiculo_guardar', { p_id: null, p_identificador: ident, p_patente: patente }, 'Vehículo registrado')}>Registrar vehículo</button>
      </div>
      <div className={styles.filtros}>
        <input className={styles.input} placeholder="Nombre del Smart Tag" value={tagNombre} onChange={e => setTagNombre(e.target.value)} />
        <label className={styles.label}><input type="checkbox" checked={tagSimulado} onChange={e => setTagSimulado(e.target.checked)} /> Simulado (sin integración real)</label>
        <button className={styles.boton} disabled={!tagNombre}
          onClick={() => rpc('gps_tag_guardar', {
            p_id: null, p_nombre: tagNombre, p_proveedor: tagSimulado ? 'simulado' : 'google_find_hub',
            p_identificador_externo: null, p_es_prueba: true,
          }, 'Smart Tag registrado')}>Registrar Smart Tag</button>
      </div>
      <div className={styles.filtros}>
        <select className={styles.input} value={vehiculo} onChange={e => setVehiculo(e.target.value)}>
          <option value="">Vehículo…</option>
          {filas.map(f => <option key={f.vehiculo.id} value={f.vehiculo.id}>{f.vehiculo.identificador} · {f.vehiculo.patente}</option>)}
        </select>
        <select className={styles.input} value={tag} onChange={e => setTag(e.target.value)}>
          <option value="">Sin Smart Tag</option>
          {tags.filter(t => t.estado === 'activo').map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
        <button className={styles.boton} disabled={!vehiculo}
          onClick={() => rpc('gps_vehiculo_asignar_tag', { p_vehiculo_id: vehiculo, p_tag_id: tag || null }, 'Smart Tag asignado (la asignación anterior queda en el historial)')}>Asignar tag</button>
        <select className={styles.input} value={sup} onChange={e => setSup(e.target.value)}>
          <option value="">Sin supervisor</option>
          {supervisores.map(s => <option key={s.id} value={s.id}>{s.apellido}, {s.nombre}</option>)}
        </select>
        <button className={styles.boton} disabled={!vehiculo}
          onClick={() => rpc('gps_vehiculo_asignar_supervisor', { p_vehiculo_id: vehiculo, p_supervisor_id: sup || null }, 'Supervisor asignado (los recorridos anteriores siguen atribuidos a quien lo tenía)')}>Asignar supervisor</button>
      </div>
    </details>
  )
}
