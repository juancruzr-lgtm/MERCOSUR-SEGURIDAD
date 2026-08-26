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
import { ETIQUETA_ESTADO, calcularCumplimiento } from '@/lib/cumplimiento'
import type { Dimension, EstadoDesempeno } from '@/lib/cumplimiento'
import { jornadaCumplimientoDesdeFila, etiquetaMes, mesPorDefecto, mesesDisponibles } from '@/lib/desempeno-datos'
import { faltanteParaMuestra } from '@/lib/desempeno'

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

function FilaDimension({ d }: { d: Dimension }) {
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
      </span>
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

  const cargar = useCallback(async () => {
    if (!esAdmin) { setCargando(false); return }
    setCargando(true); setError('')
    const { filas: todas, error: err } = await cargarFilasBandeja({ mes, esAdmin, usuarioId })
    if (err) { setError(err); setFilas([]); setCargando(false); return }
    setFilas(todas.filter(f => f.empleadoId === empleadoId))
    setCargando(false)
  }, [mes, esAdmin, usuarioId, empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  const r = useMemo(
    () => calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila)),
    [filas],
  )

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
        {r.dimensiones.map(d => <FilaDimension key={d.clave} d={d} />)}
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
