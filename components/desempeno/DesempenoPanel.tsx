'use client'

// Cumplimiento Operativo — la lista, por empleado.
//
// El detalle de una persona vive en components/cumplimiento/FichaCumplimiento,
// con las siete dimensiones. Esta pantalla es la bandeja: quién necesita una
// decisión primero. No es un podio y el orden no va de mejor a peor.
//
// NO calcula nada: todo sale de lib/desempeno.ts, que es la única definición.
// Las filas salen de la misma carga que usa Revisión de planillas, así que las
// dos pantallas hablan del mismo mes con los mismos turnos.
//
// Es una BANDEJA DE GESTIÓN, no un podio: el orden es operativo —primero lo que
// necesita una decisión— y no hay ranking, ni posición, ni comparación.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cargarFilasBandeja } from '@/lib/bandeja-datos'
import {
  ETIQUETA_ESTADO, MIN_COBERTURA, MIN_OBSERVACIONES, faltanteParaMuestra,
} from '@/lib/desempeno'
import type { EstadoDesempeno } from '@/lib/desempeno'
import {
  desempenoPorEmpleado, etiquetaMes, jornadasDelMotivo, mesPorDefecto,
  mesesDisponibles, resumirDesempeno,
} from '@/lib/desempeno-datos'
import type { DesempenoEmpleado } from '@/lib/desempeno-datos'
import { puedeAbrirDesempeno } from '@/lib/desempeno-visibilidad'

const COLOR_ESTADO: Record<EstadoDesempeno, string> = {
  excelente:             '#10b981',
  correcto:              '#38bdf8',
  requiere_seguimiento:  '#f59e0b',
  requiere_intervencion: '#ef4444',
  datos_insuficientes:   '#94a3b8',
}

const S = {
  caja:   { background:'#0f172a', border:'1px solid #1e2d42', borderRadius:10, padding:16 },
  fila:   { display:'flex', gap:12, alignItems:'center', padding:'10px 12px', borderBottom:'1px solid #1e2d4266', flexWrap:'wrap' as const },
  chip:   { fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999 },
  btn:    { background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 11px', fontSize:12, cursor:'pointer' },
  select: { background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 10px', fontSize:12.5 },
  tenue:  { fontSize:11.5, color:'#94a3b8' },
  dim:    { fontSize:12.5, color:'#e2e8f0' },
}

const coma = (v: number, d = 1) => v.toFixed(d).replace('.', ',')

function Chip({ estado }: { estado: EstadoDesempeno }) {
  const c = COLOR_ESTADO[estado]
  return (
    <span style={{ ...S.chip, color:c, background:c + '1a', border:'1px solid ' + c + '55' }}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  )
}

/** El número nunca va solo: siempre con dimensiones y motivos. */
function Puntaje({ d }: { d: DesempenoEmpleado }) {
  // `cumplimiento`, no `resultado`: el segundo es sólo el núcleo —Asistencia
  // y Procedimiento— y no incluye Puntualidad. Usarlo acá hacía que esta
  // pantalla mostrara un número distinto al de la tabla para la misma persona.
  const r = d.cumplimiento
  if (r.puntaje === null) return <span style={{ ...S.tenue, fontWeight:600 }}>—</span>
  return (
    <span style={{ fontSize:17, fontWeight:800, color:COLOR_ESTADO[r.estado], fontFamily:'Syne,sans-serif' }}>
      {coma(r.puntaje)}
      <span style={{ fontSize:11, fontWeight:600, color:'#64748b' }}> / 10</span>
    </span>
  )
}

interface Props {
  esAdmin: boolean
  usuarioId: string | null
  /**
   * Rol del usuario. En Etapa 1 el vigilador NO ve el indicador: la guarda
   * esta aca ademas de en el ruteo, porque una pantalla que no deberia
   * mostrarse no tiene que depender de que nadie se olvide de esconderla.
   */
  rol?: string | null
  /** app_config.desempeno_visible_vigilador. Apagado por defecto. */
  visibleParaVigilador?: boolean
  /** Sólo este empleado. Lo usa Administración para abrir un legajo. */
  empleadoId?: string | null
  /** Oculta el encabezado cuando se embebe en el legajo. */
  compacto?: boolean
}

export default function DesempenoPanel({
  esAdmin, usuarioId, empleadoId = null, compacto = false,
  rol = null, visibleParaVigilador = false,
}: Props) {
  // Etapa 1: solo Administracion y Supervision. Se decide antes de cualquier
  // consulta: sin acceso no se lee ni un dato.
  const habilitado = esAdmin || puedeAbrirDesempeno(rol, visibleParaVigilador)
  const [mes, setMes] = useState(() => mesPorDefecto())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [lista, setLista] = useState<DesempenoEmpleado[]>([])
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoDesempeno>('todos')
  const [filtroObjetivo, setFiltroObjetivo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  const soloUno = Boolean(empleadoId)

  const cargar = useCallback(async () => {
    if (!habilitado) { setCargando(false); return }
    setCargando(true)
    const { filas, error: err } = await cargarFilasBandeja({ mes, esAdmin, usuarioId })
    if (err) { setError(err); setLista([]); setCargando(false); return }
    const propias = empleadoId ? filas.filter(f => f.empleadoId === empleadoId) : filas
    setLista(desempenoPorEmpleado(propias))
    setError('')
    setCargando(false)
  }, [mes, esAdmin, usuarioId, empleadoId, habilitado])

  useEffect(() => { void cargar() }, [cargar])

  const objetivos = useMemo(() => {
    const s = new Set<string>()
    lista.forEach(d => d.objetivos.forEach(o => s.add(o)))
    return Array.from(s).sort()
  }, [lista])

  const visibles = useMemo(() => lista.filter(d => {
    if (filtroEstado !== 'todos' && d.cumplimiento.estado !== filtroEstado) return false
    if (filtroObjetivo && d.objetivos.indexOf(filtroObjetivo) < 0) return false
    if (busqueda && d.empleado.toLowerCase().indexOf(busqueda.toLowerCase()) < 0) return false
    return true
  }), [lista, filtroEstado, filtroObjetivo, busqueda])

  const resumen = useMemo(() => resumirDesempeno(lista), [lista])
  const meses = useMemo(() => mesesDisponibles('2026-06'), [])
  const estados = Object.keys(ETIQUETA_ESTADO) as EstadoDesempeno[]

  if (!habilitado) return null

  return (
    <div>
      {!compacto && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:15, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0' }}>
            Cumplimiento operativo · {etiquetaMes(mes)}
          </div>
          <div style={S.tenue}>
            Mide el cumplimiento del procedimiento —presencia, horario y uso de la aplicación—,
            no la calidad del trabajo del vigilador: alguien puede ser el que el cliente pide
            por nombre y tener un problema concreto con la app. La evaluación del supervisor y
            la del cliente son otra capa y todavía no existen. No modifica horas ni liquidación.
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select style={S.select} value={mes} onChange={e => setMes(e.target.value)}>
          {meses.map(m => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
        </select>

        {!soloUno && (
          <>
            <select
              style={S.select}
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value as 'todos' | EstadoDesempeno)}
            >
              <option value="todos">Todos los estados</option>
              {estados.map(k => (
                <option key={k} value={k}>
                  {ETIQUETA_ESTADO[k]} ({resumen.porEstado[k] || 0})
                </option>
              ))}
            </select>
            <select style={S.select} value={filtroObjetivo} onChange={e => setFiltroObjetivo(e.target.value)}>
              <option value="">Todos los objetivos</option>
              {objetivos.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input
              style={{ ...S.select, minWidth:180 }}
              placeholder="Buscar empleado…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </>
        )}
        <button style={S.btn} type="button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {error && <div style={{ ...S.caja, color:'#f87171', marginBottom:12 }}>{error}</div>}

      {cargando ? (
        <div style={S.tenue}>Calculando desempeño…</div>
      ) : visibles.length === 0 ? (
        <div style={{ ...S.caja, ...S.tenue }}>
          {lista.length === 0
            ? 'No hay jornadas evaluables en ' + etiquetaMes(mes) + '.'
            : 'Ningún empleado coincide con los filtros.'}
        </div>
      ) : (
        <div style={S.caja}>
          {!soloUno && (
            <div style={{ ...S.tenue, marginBottom:8 }}>
              {visibles.length} de {lista.length} empleados · ordenados por prioridad
              operativa, no por puntaje
            </div>
          )}
          {visibles.map(d => (
            <Empleado
              key={d.empleadoId}
              d={d}
              soloUno={soloUno}
              mes={mes}
              abierto={soloUno || abierto === d.empleadoId}
              onAbrir={() => setAbierto(abierto === d.empleadoId ? null : d.empleadoId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Empleado({ d, abierto, onAbrir, soloUno, mes }: {
  d: DesempenoEmpleado
  abierto: boolean
  onAbrir: () => void
  soloUno: boolean
  mes: string
}) {
  const r = d.cumplimiento
  const nucleo = d.resultado

  return (
    <div>
      <div style={S.fila}>
        <div style={{ flex:1, minWidth:190 }}>
          {!soloUno && (
            <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{d.empleado}</div>
          )}
          <div style={S.tenue}>{d.objetivos.join(' · ')}</div>
        </div>

        <Chip estado={r.estado} />
        <div style={{ minWidth:78, textAlign:'right' }}><Puntaje d={d} /></div>

        {/* Las tres que puntúan, en el mismo orden que la ficha. Se leen del
            resultado de Cumplimiento para que no puedan discrepar del número. */}
        {!nucleo.datosInsuficientes && (
          <div style={{ ...S.tenue, minWidth:210 }}>
            {r.dimensiones
              .filter(dim => dim.estado === 'puntuable' && dim.nota !== null)
              .map((dim, k) => (
                <span key={dim.clave}>
                  {k > 0 ? ' · ' : ''}
                  {dim.etiqueta.split(' /')[0]}{' '}
                  <strong style={{ color:'#e2e8f0' }}>{coma(dim.nota!)}</strong>
                </span>
              ))}
          </div>
        )}

        <div style={{ ...S.tenue, minWidth:150 }}>
          {nucleo.observacionesValidas}/{nucleo.jornadasAplicables} jornadas ·
          {' '}{Math.round(nucleo.cobertura * 100)} % de cobertura
        </div>

        {!soloUno && (
          <button style={S.btn} type="button" onClick={onAbrir}>
            {abierto ? 'Cerrar' : 'Ver detalle'}
          </button>
        )}
      </div>

      {abierto && <Detalle d={d} mes={mes} />}
    </div>
  )
}

const BLOQUES = [
  { tipo:'sin_registro_propio' as const, titulo:'Jornadas trabajadas sin registro propio', penaliza:true },
  { tipo:'entrada_sin_salida'  as const, titulo:'Entradas registradas sin salida',         penaliza:true },
  { tipo:'ausencia'            as const, titulo:'Ausencias confirmadas',                    penaliza:true },
  { tipo:'sin_evidencia'       as const, titulo:'Jornadas sin datos suficientes',           penaliza:false },
]

function Detalle({ d, mes }: { d: DesempenoEmpleado; mes: string }) {
  const r = d.resultado
  const c = d.cumplimiento

  if (r.datosInsuficientes) {
    return (
      <div style={{ padding:'4px 12px 16px' }}>
        <div style={{ ...S.caja, background:'#0b1220' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#94a3b8', marginBottom:6 }}>
            Datos insuficientes para calcular desempeño
          </div>
          <div style={S.tenue}>{faltanteParaMuestra(r)}</div>
          <div style={{ ...S.tenue, marginTop:8 }}>
            {r.observacionesValidas} de {MIN_OBSERVACIONES} observaciones mínimas
            <br />
            Cobertura del período: {Math.round(r.cobertura * 100)} % · mínimo requerido:
            {' '}{Math.round(MIN_COBERTURA * 100)} %
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'4px 12px 16px' }}>
      <div style={{ ...S.caja, background:'#0b1220' }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'#e2e8f0', marginBottom:10 }}>
          Qué explica este resultado
        </div>

        {r.motivos.length === 0 && (
          <div style={S.tenue}>
            Sin observaciones en {etiquetaMes(mes)}: todas las jornadas evaluadas quedaron
            registradas correctamente.
          </div>
        )}

        {BLOQUES.map(b => {
          const jornadas = jornadasDelMotivo(d, b.tipo)
          if (jornadas.length === 0) return null
          return (
            <div key={b.tipo} style={{ marginBottom:12 }}>
              <div style={{ ...S.dim, fontWeight:700, marginBottom:4 }}>
                {jornadas.length} · {b.titulo}
                {!b.penaliza && (
                  <span style={{ ...S.tenue, fontWeight:400 }}> — no afectan el puntaje</span>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {jornadas.map(j => (
                  <div key={j.turnoId} style={S.tenue}>
                    {j.fecha} · {j.objetivo} · {j.puesto} · {j.horario}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <div style={{ ...S.tenue, marginTop:10, paddingTop:10, borderTop:'1px solid #1e2d4266' }}>
          Puntualidad, Rondas y Calidad todavía no participan del cálculo: no tienen
          historia comparable suficiente.
        </div>
      </div>
    </div>
  )
}
