'use client'

// Cumplimiento Operativo de UNA persona.
//
// Nunca un número solo. Arriba el puntaje, abajo las siete dimensiones con su
// estado, y al final los hechos que lo formaron. Si alguien va a tomar una
// decisión sobre una persona mirando esto, tiene que poder llegar del número al
// hecho sin preguntarle a nadie.
//
// Las dimensiones que todavía no pesan se muestran igual —con "En validación" y
// el motivo—, porque esconder lo que falta medir es peor que decirlo: hace
// pensar que el número cubre más de lo que cubre.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cargarFilasBandeja } from '@/lib/bandeja-datos'
import {
  BANDAS_PUNTUALIDAD, ETIQUETA_ESTADO, calcularCumplimiento, patronesDeHorarioSospechoso,
} from '@/lib/cumplimiento'
import type { Dimension, EstadoDesempeno, ResumenPuntualidad } from '@/lib/cumplimiento'
import { jornadaCumplimientoDesdeFila, etiquetaMes, mesPorDefecto, mesesDisponibles } from '@/lib/desempeno-datos'
import { faltanteParaMuestra } from '@/lib/desempeno'
import {
  cargarEvidenciasEmpleado, cargarRondasEmpleado, detalleCalidad, detalleEvidencia,
  detalleRondas, resumirCalidad, resumirEvidencias, resumirRondas,
} from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'

const COLOR_ESTADO: Record<EstadoDesempeno, string> = {
  excelente:             '#10b981',
  correcto:              '#38bdf8',
  requiere_seguimiento:  '#f59e0b',
  requiere_intervencion: '#ef4444',
  datos_insuficientes:   '#94a3b8',
}

const S = {
  caja:   { background:'#0f172a', border:'1px solid #1e2d42', borderRadius:10, padding:16 },
  fila:   { display:'flex', gap:12, alignItems:'baseline', padding:'9px 0', borderBottom:'1px solid #1e2d4266', flexWrap:'wrap' as const },
  chip:   { fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999 },
  select: { background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0', borderRadius:8, padding:'6px 10px', fontSize:12.5 },
  tenue:  { fontSize:11.5, color:'#94a3b8' },
  dim:    { fontSize:13, color:'#e2e8f0' },
}

const coma = (v: number) => v.toFixed(1).replace('.', ',')

function FilaDimension({ d, pie }: { d: Dimension, pie?: React.ReactNode }) {
  const puntua = d.estado === 'puntuable'
  return (
    <div style={S.fila}>
      <span style={{ ...S.dim, flex:'1 1 180px', fontWeight: puntua ? 600 : 400, color: puntua ? '#e2e8f0' : '#94a3b8' }}>
        {d.etiqueta}
      </span>
      <span style={{
        fontSize: puntua ? 16 : 12.5,
        fontWeight: puntua ? 800 : 600,
        color: puntua ? '#e2e8f0' : '#64748b',
        minWidth: 92, textAlign:'right', fontFamily: puntua ? 'Syne,sans-serif' : 'inherit',
      }}>
        {/* Una dimensión que no pesa NO muestra su nota como si contara: se
            informa el estado. Ver el número al lado de los que sí pesan haría
            creer que participa del promedio. */}
        {puntua && d.nota !== null ? coma(d.nota) : 'En validación'}
      </span>
      <span style={{ ...S.tenue, flex:'1 1 100%', marginTop:2 }}>
        {d.detalle}
        {d.faltante && <span style={{ color:'#64748b' }}> · {d.faltante}</span>}
        {pie}
      </span>
    </div>
  )
}


/**
 * Las tardanzas, una por una. El pedido fue explicito: no alcanza con
 * "Puntualidad 8,7" — hay que poder ver que jornada, a que hora empezaba el
 * turno, a que hora ficho y cuantos minutos fueron.
 */
function DetalleTardanzas({ p }: { p: ResumenPuntualidad }) {
  const [abierto, setAbierto] = useState(false)
  if (p.tardanzas.length === 0) return null
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setAbierto(v => !v)}
        style={{ background:'transparent', border:'none', padding:0, cursor:'pointer',
                 color:'#38bdf8', fontSize:11.5, textDecoration:'underline', textUnderlineOffset:3 }}>
        {abierto ? 'Ocultar' : `Ver las ${p.tardanzas.length} tardanzas`}
      </button>
      {abierto && (
        <div style={{ marginTop:6 }}>
          {p.tardanzas.map(t => (
            <div key={t.turnoId} style={{ ...S.tenue, padding:'3px 0', color:'#cbd5e1' }}>
              {t.fecha ? t.fecha.slice(8, 10) + '/' + t.fecha.slice(5, 7) : '—'}
              {t.objetivo ? ' · ' + t.objetivo : ''}
              {' · turno ' + (t.horaInicioProg ?? '—')}
              {' · fichó ' + (t.entrada ?? '—')}
              <span style={{ color:'#fcd34d', fontWeight:700 }}>{' · +' + t.minutos + ' min'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  empleadoId: string
  /** Sólo Administración. El vigilador no ve nada de esto. */
  esAdmin: boolean
  usuarioId: string | null
}

export default function FichaCumplimiento({ empleadoId, esAdmin, usuarioId }: Props) {
  const [mes, setMes] = useState(() => mesPorDefecto())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [filas, setFilas] = useState<any[]>([])
  // Todas las del mes, no sólo las de esta persona: el patrón de horario es
  // del puesto y necesita ver a los demás.
  const [todasLasFilas, setTodasLasFilas] = useState<any[]>([])
  const [rondas, setRondas] = useState<RondasEmpleado | null>(null)
  const [evidencias, setEvidencias] = useState<EvidenciaCumplimiento[]>([])
  // Estas dos fuentes no cortan la pantalla si fallan: son descriptivas y de
  // peso 0. El aviso se muestra en su dimensión, no como error general.
  const [avisoFuentes, setAvisoFuentes] = useState('')

  const cargar = useCallback(async () => {
    if (!esAdmin) { setCargando(false); return }
    setCargando(true); setError('')
    const { filas: todas, error: err } = await cargarFilasBandeja({ mes, esAdmin, usuarioId })
    if (err) { setError(err); setFilas([]); setCargando(false); return }
    setTodasLasFilas(todas)
    setFilas(todas.filter(f => f.empleadoId === empleadoId))
    setCargando(false)

    const [rr, ee] = await Promise.all([
      cargarRondasEmpleado(mes, empleadoId),
      cargarEvidenciasEmpleado(mes, empleadoId),
    ])
    setRondas(rr.dato)
    setEvidencias(ee.evidencias)
    setAvisoFuentes([rr.error, ee.error].filter(Boolean).join(' · '))
  }, [mes, esAdmin, usuarioId, empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  const jornadas = useMemo(() => filas.map(jornadaCumplimientoDesdeFila), [filas])
  const r = useMemo(() => calcularCumplimiento(jornadas), [jornadas])
  // El patrón se calcula sobre TODO el mes —hace falta ver a los demás— y
  // después se recorta a los puestos donde ESTA persona llegó tarde: el resto
  // no explica nada de su número.
  const resRondas = useMemo(() => resumirRondas(rondas), [rondas])
  const resUniforme = useMemo(() => resumirEvidencias(evidencias, 'uniforme'), [evidencias])
  const resLibro = useMemo(() => resumirEvidencias(evidencias, 'libro_guardia'), [evidencias])
  const resCalidad = useMemo(() => resumirCalidad(evidencias), [evidencias])

  /**
   * El detalle real de las cuatro que no puntúan. Se reemplaza acá y no en
   * lib/cumplimiento porque el cálculo del X/10 no debe depender de consultas
   * que pueden fallar: si Rondas no carga, el número sigue siendo el mismo.
   */
  const dimensiones = useMemo(() => r.dimensiones.map(d => {
    if (d.clave === 'rondas') {
      const etiqueta = resRondas.estado === 'no_aplica' ? 'No aplica'
        : resRondas.estado === 'datos_insuficientes' ? 'Datos insuficientes'
        : `${resRondas.porcentaje} % de cumplimiento`
      return { ...d, detalle: `${etiqueta} · ${detalleRondas(resRondas)}` }
    }
    if (d.clave === 'uniforme') return { ...d, detalle: detalleEvidencia(resUniforme) }
    if (d.clave === 'libro_guardia') return { ...d, detalle: detalleEvidencia(resLibro) }
    if (d.clave === 'evidencias') return { ...d, detalle: detalleCalidad(resCalidad) }
    return d
  }), [r, resRondas, resUniforme, resLibro, resCalidad])

  const patrones = useMemo(() => {
    const suyos = new Set(r.puntualidad.tardanzas.map(t => `${t.objetivo}@${t.horaInicioProg}`))
    return patronesDeHorarioSospechoso(todasLasFilas.map(jornadaCumplimientoDesdeFila))
      .filter(pt => suyos.has(`${pt.objetivo}@${pt.horaInicio}`))
  }, [todasLasFilas, r])

  // Sin acceso no se carga ni se muestra nada. La guarda está acá además de en
  // el ruteo: una pantalla que no debería verse no puede depender de que nadie
  // se olvide de esconderla.
  if (!esAdmin) return null

  const color = COLOR_ESTADO[r.estado]

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:14 }}>
        <select value={mes} onChange={e => setMes(e.target.value)} style={S.select}>
          {mesesDisponibles('2026-08').map(m => (
            <option key={m} value={m}>{etiquetaMes(m)}</option>
          ))}
        </select>
        {cargando && <span style={S.tenue}>Cargando…</span>}
      </div>

      {error && (
        <div style={{ ...S.caja, borderColor:'#ef444455', color:'#fca5a5', marginBottom:12 }}>{error}</div>
      )}

      <div style={S.caja}>
        <div style={{ ...S.tenue, letterSpacing:.5 }}>CUMPLIMIENTO OPERATIVO</div>
        <div style={{ display:'flex', alignItems:'baseline', gap:12, marginTop:6, flexWrap:'wrap' }}>
          <span style={{ fontSize:38, fontWeight:800, color, fontFamily:'Syne,sans-serif' }}>
            {r.puntaje === null ? '—' : coma(r.puntaje)}
            {r.puntaje !== null && <span style={{ fontSize:15, fontWeight:600, color:'#64748b' }}> / 10</span>}
          </span>
          <span style={{ ...S.chip, color, background:color + '1a', border:`1px solid ${color}55` }}>
            {ETIQUETA_ESTADO[r.estado]}
          </span>
        </div>
        {/* Lo que este número NO dice. Va acá y no en una nota al pie: es la
            confusión más cara que puede provocar la pantalla. */}
        <div style={{ ...S.tenue, marginTop:8, lineHeight:1.5 }}>
          Mide el cumplimiento del procedimiento — presencia, horario y uso de la app.
          No mide la calidad del trabajo del vigilador: la evaluación del supervisor
          y la del cliente son otra capa, y todavía no existen.
        </div>
        {r.puntaje === null && (
          <div style={{ ...S.tenue, marginTop:8, color:'#fcd34d' }}>
            {faltanteParaMuestra(r.base)}
          </div>
        )}
      </div>

      <div style={{ ...S.caja, marginTop:14 }}>
        <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:4 }}>DIMENSIONES</div>
        {dimensiones.map(d => (
          <FilaDimension
            key={d.clave}
            d={d}
            pie={d.clave === 'puntualidad' ? <DetalleTardanzas p={r.puntualidad} /> : undefined}
          />
        ))}
      </div>

      {r.motivos.length > 0 && (
        <div style={{ ...S.caja, marginTop:14 }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:8 }}>PRINCIPALES INCIDENCIAS</div>
          {r.motivos.map((m, i) => (
            <div key={i} style={{ ...S.dim, padding:'5px 0' }}>· {m.texto}</div>
          ))}
          <div style={{ ...S.tenue, marginTop:8 }}>
            Cada motivo sale de un contador sobre jornadas reales del período, no de un texto fijo.
          </div>
        </div>
      )}

      {avisoFuentes && (
        <div style={{ ...S.caja, marginTop:14, borderColor:'#f59e0b55', ...S.tenue }}>
          No se pudieron leer las fuentes de Rondas o evidencias: {avisoFuentes}.
          {' '}El puntaje no depende de ellas y no cambió.
        </div>
      )}

      {Object.keys(resRondas.motivosPausa).length > 0 && (
        <div style={{ ...S.caja, marginTop:14 }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:8 }}>
            RONDAS EXCLUIDAS POR PAUSA
          </div>
          {Object.entries(resRondas.motivosPausa)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .map(([motivo, cuantas]) => (
              <div key={motivo} style={{ ...S.dim, padding:'4px 0' }}>
                · {cuantas} — «{motivo}»
              </div>
            ))}
          <div style={{ ...S.tenue, marginTop:8, lineHeight:1.5 }}>
            El motivo lo escribió quien pausó la ronda, y se muestra tal cual. Una pausa
            por un problema técnico y otra porque la ronda no se estaba haciendo se leen
            igual acá: por eso <b>Rondas todavía no puntúa</b>. Distinguirlas por las
            palabras del motivo sería adivinar.
          </div>
        </div>
      )}
      {patrones.length > 0 && (
        <div style={{ ...S.caja, marginTop:14, borderColor:'#f59e0b55' }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:8, color:'#fcd34d' }}>
            POSIBLE HORARIO A REVISAR
          </div>
          {patrones.map(pt => (
            <div key={pt.objetivo + pt.horaInicio} style={{ ...S.dim, padding:'4px 0' }}>
              · {pt.objetivo} · turno {pt.horaInicio} — {pt.entradas} entradas de{' '}
              {pt.personas} vigilador{pt.personas === 1 ? '' : 'es'},{' '}
              {pt.porcentajeTarde} % posteriores al inicio,{' '}
              demora promedio +{pt.promedioTarde} min
            </div>
          ))}
          <div style={{ ...S.tenue, marginTop:8, lineHeight:1.5 }}>
            Varias personas llegando tarde al mismo puesto suele ser el horario cargado,
            no las personas. <b>Esto no descuenta ninguna tardanza</b>: si el horario
            estaba mal, hay que corregirlo por el circuito de siempre y el indicador pasa
            a usar el dato corregido.
          </div>
        </div>
      )}
      <div style={{ ...S.caja, marginTop:14 }}>
        <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:6 }}>TODAVÍA NO IMPLEMENTADO</div>
        <div style={{ ...S.tenue, lineHeight:1.6 }}>
          <b style={{ color:'#94a3b8' }}>Evaluación del supervisor</b> — presentación, cumplimiento
          de consignas, actitud, comunicación, confiabilidad, iniciativa, trato. Periódica y
          auditada: quién evaluó, cuándo y qué período.
          <br />
          <b style={{ color:'#94a3b8' }}>Evaluación del cliente</b> — conformidad, trato, confianza,
          presentación, y si el cliente pide a esta persona.
          <br />
          Ninguna de las dos puntúa todavía, y ninguna se mezcla con este número.
        </div>
      </div>
    </div>
  )
}
