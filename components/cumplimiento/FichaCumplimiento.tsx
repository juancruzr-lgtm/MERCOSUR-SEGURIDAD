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
import { supabase } from '@/lib/supabase'
import {
  BANDAS_PUNTUALIDAD, ETIQUETA_ESTADO, PESOS, calcularCumplimiento,
  patronesDeHorarioSospechoso,
} from '@/lib/cumplimiento'
import { INASISTENCIA_ACTIVA, evaluar, faltaPorInasistencia, faltaPorRondas } from '@/lib/evaluacion-final'
import { inasistenciasInjustificadas } from '@/lib/novedades-laborales'
import type { Dimension, EstadoDesempeno, ResumenPuntualidad } from '@/lib/cumplimiento'
import { jornadaCumplimientoDesdeFila, etiquetaMes, mesPorDefecto, mesesDisponibles } from '@/lib/desempeno-datos'
import { faltanteParaMuestra } from '@/lib/desempeno'
import { AYUDA_SIN_ZONAS, MENSAJE_SIN_ZONAS } from '@/lib/bandeja-planillas'
import {
  cargarEvidenciasEmpleado, cargarRondasEmpleado, causasLegibles, fuentesDeEmpleado,
} from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import BloqueEntrenamiento from './BloqueEntrenamiento'

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

/**
 * Las siete dimensiones, agrupadas por lo que significan.
 *
 * "Prestó el servicio" y "lo dejó registrado" son dos cosas distintas, se
 * corrigen distinto, y mezclarlas en una lista de siete filas obliga a quien
 * mira a reconstruir mentalmente cuál es cuál cada vez.
 */
const GRUPOS: Array<{ titulo: string; ayuda: string; claves: string[] }> = [
  {
    titulo: 'PRESTACIÓN DEL SERVICIO',
    ayuda: 'Lo que el cliente recibe: si estuvo, si llegó a horario, si recorrió el '
      + 'objetivo, si se presentó uniformado y si dejó el libro completo.',
    claves: ['asistencia', 'rondas', 'puntualidad', 'uniforme', 'libro_guardia'],
  },
  {
    // Separado del resto a propósito. Uniforme y Libro estaban acá y no
    // corresponde: un uniforme incorrecto lo ve el cliente, y no fichar la
    // salida no lo ve nadie más que nosotros. Mezclarlos hacía que un problema
    // de registro se leyera como un problema de servicio.
    titulo: 'USO DE LA APP',
    ayuda: 'Si dejó registrada su jornada con la aplicación. Es el instrumento con '
      + 'el que medimos, no lo que se mide: alguien puede prestar bien el servicio '
      + 'y usar mal la app.',
    claves: ['procedimiento'],
  },
  {
    titulo: 'CALIDAD DE LA MEDICIÓN',
    ayuda: 'Descriptiva: mide si la foto se podía leer, no lo que muestra. No modifica el puntaje.',
    claves: ['evidencias'],
  },
]

/**
 * Una dimensión, con su nota y con lo que esa nota vale.
 *
 * Las cuatro dimensiones nuevas SÍ muestran número, porque ya se mide cumplido
 * sobre requerido válido. Pero el número va apagado y con la etiqueta
 * "En validación" al lado: lo que no puede pasar es que se lea igual que el de
 * las que sí entran al promedio. Un 7,2 en validación y un 7,2 puntuable no son
 * el mismo dato, y quien mira la pantalla tiene que verlo sin preguntar.
 */
function FilaDimension({ d, pie }: { d: Dimension, pie?: React.ReactNode }) {
  const puntua = d.estado === 'puntuable'
  const hayNota = d.nota !== null
  return (
    <div style={S.fila}>
      <span style={{ ...S.dim, flex:'1 1 180px', fontWeight: puntua ? 600 : 400, color: puntua ? '#e2e8f0' : '#94a3b8' }}>
        {d.etiqueta}
      </span>
      <span style={{
        display:'flex', gap:8, alignItems:'baseline', justifyContent:'flex-end',
        minWidth: 150, flexWrap:'wrap' as const,
      }}>
        <span style={{
          fontSize: puntua ? 16 : 14,
          fontWeight: puntua ? 800 : 700,
          color: puntua ? '#e2e8f0' : hayNota ? '#7c8aa0' : '#64748b',
          fontFamily: hayNota ? 'Syne,sans-serif' : 'inherit',
        }}>
          {/* Las tres respuestas sin número NO significan lo mismo y por eso
              se dicen distinto. "Sin datos" sobre alguien que no tuvo la
              obligación suena a que falta información sobre él, y lo que pasa
              es que no le correspondía. */}
          {hayNota ? coma(d.nota as number)
            : d.estado === 'no_aplica'           ? 'No aplica'
            : d.estado === 'datos_insuficientes' ? 'Datos insuficientes'
            :                                      'Sin datos'}
        </span>
        {puntua && (
          <span style={{ ...S.tenue, fontSize:10, whiteSpace:'nowrap' as const }}>
            peso {d.peso}
          </span>
        )}
        {!puntua && hayNota && (
          <span style={{ ...S.chip, fontSize:9.5, color:'#94a3b8', background:'#1e293b',
                         border:'1px solid #33415577', whiteSpace:'nowrap' as const }}>
            EN VALIDACIÓN
          </span>
        )}
      </span>
      {/* pre-line: el detalle de Rondas trae el volumen de turnos en su propia
          línea. Sin esto, "0 de 9 realizadas" y "Obligación en 1 turno" se
          leerían pegados como si fueran la misma frase. */}
      <span style={{ ...S.tenue, flex:'1 1 100%', marginTop:2, whiteSpace:'pre-line' as const }}>
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
  /**
   * Administración ve todo; un supervisor sólo lo que cae en sus zonas.
   *
   * Se pasa tal cual a `cargarFilasBandeja`, que es donde vive el recorte. Con
   * `false` y sin zonas asignadas la carga devuelve vacío, y esta pantalla
   * muestra el aviso en vez de una ficha en blanco.
   */
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
  const [novedades, setNovedades] = useState<any[]>([])
  // Estas dos fuentes no cortan la pantalla si fallan: son descriptivas y de
  // peso 0. El aviso se muestra en su dimensión, no como error general.
  const [avisoFuentes, setAvisoFuentes] = useState('')
  const [sinZonas, setSinZonas] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    const { filas: todas, error: err, sinZonas: sz } = await cargarFilasBandeja({ mes, esAdmin, usuarioId })
    setSinZonas(sz)
    if (err) { setError(err); setFilas([]); setCargando(false); return }
    setTodasLasFilas(todas)
    setFilas(todas.filter(f => f.empleadoId === empleadoId))
    setCargando(false)

    const [rr, ee, nov] = await Promise.all([
      cargarRondasEmpleado(mes, empleadoId),
      cargarEvidenciasEmpleado(mes, empleadoId),
      // Lo que Administración clasificó en Reportes para esta persona. Sólo
      // aprobadas: pendiente y rechazada no afirman nada.
      supabase.from('novedades_laborales')
        .select('empleado_id, tipo, fecha_desde, fecha_hasta, estado')
        .eq('empleado_id', empleadoId)
        .eq('estado', 'aprobada')
        .lte('fecha_desde', `${mes}-31`)
        .gte('fecha_hasta', `${mes}-01`),
    ])
    setRondas(rr.dato)
    setEvidencias(ee.evidencias)
    // Si falla, se sigue sin ellas: nunca se inventa una falta por un error de
    // lectura.
    setNovedades((nov?.data ?? []) as any[])
    setAvisoFuentes([rr.error, ee.error].filter(Boolean).join(' · '))
  }, [mes, esAdmin, usuarioId, empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  const jornadas = useMemo(() => filas.map(jornadaCumplimientoDesdeFila), [filas])
  // Rondas y evidencias entran al cálculo como aportes, con peso 0. Si la
  // consulta falla llegan vacías y las tres dimensiones que puntúan dan
  // exactamente el mismo número: el X/10 no depende de ellas.
  const medido = useMemo(() => fuentesDeEmpleado(rondas, evidencias), [rondas, evidencias])
  const resRondas = medido.rondas
  const r = useMemo(
    () => calcularCumplimiento(jornadas, medido.fuentes),
    [jornadas, medido],
  )
  // El patrón se calcula sobre TODO el mes —hace falta ver a los demás— y
  // después se recorta a los puestos donde ESTA persona llegó tarde: el resto
  // no explica nada de su número.
  const dimensiones = r.dimensiones

  // CAPA 2. Sin puntaje no hay nada que topear: la muestra no alcanzó y eso ya
  // se dice aparte.
  //
  // La falta por inasistencia NO se pasa: hoy no se puede distinguir una falta
  // sin aviso de unas vacaciones aprobadas, y aplazar por esa duda sería peor
  // que no aplazar. Ver INASISTENCIA_ACTIVA en lib/evaluacion-final.ts.
  const evaluacion = useMemo(() => {
    if (r.puntaje === null) return null
    const m = resRondas.medicion
    // Sólo los días en que TENÍA turno: una novedad de rango largo no puede
    // inventar faltas en días que no le tocaba trabajar.
    const inasistencias = INASISTENCIA_ACTIVA
      ? inasistenciasInjustificadas(novedades, empleadoId, filas.map(f => f.fecha))
      : 0
    return evaluar(r.puntaje * 10, r.dimensiones, PESOS, [
      m.estado === 'medible'
        ? faltaPorRondas(m.cumplidos, m.validos, resRondas.turnosConIncumplimiento)
        : null,
      faltaPorInasistencia(inasistencias),
    ])
  }, [r, resRondas, novedades, empleadoId, filas])

  const patrones = useMemo(() => {
    const suyos = new Set(r.puntualidad.tardanzas.map(t => `${t.objetivo}@${t.horaInicioProg}`))
    return patronesDeHorarioSospechoso(todasLasFilas.map(jornadaCumplimientoDesdeFila))
      .filter(pt => suyos.has(`${pt.objetivo}@${pt.horaInicio}`))
  }, [todasLasFilas, r])

  // Un supervisor sin zonas asignadas no ve a nadie, y hay que decirlo: una
  // ficha vacía se lee como "esta persona no tiene nada", que es otra cosa.
  if (sinZonas) {
    return (
      <div style={{ ...S.caja, borderColor:'#f59e0b55' }}>
        <div style={{ color:'#fcd34d', fontWeight:700 }}>{MENSAJE_SIN_ZONAS}</div>
        <div style={{ ...S.tenue, marginTop:6 }}>{AYUDA_SIN_ZONAS}</div>
      </div>
    )
  }

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
        <div style={{ ...S.tenue, letterSpacing:.5 }}>
          {evaluacion ? 'NOTA FINAL' : 'CUMPLIMIENTO OPERATIVO'}
        </div>
        <div style={{ display:'flex', alignItems:'baseline', gap:12, marginTop:6, flexWrap:'wrap' }}>
          <span style={{ fontSize:38, fontWeight:800, color, fontFamily:'Syne,sans-serif' }}>
            {evaluacion ? coma(evaluacion.notaFinal) : r.puntaje === null ? '—' : coma(r.puntaje)}
            {(evaluacion || r.puntaje !== null) && <span style={{ fontSize:15, fontWeight:600, color:'#64748b' }}> / 10</span>}
          </span>
          <span style={{ ...S.chip, color, background:color + '1a', border:`1px solid ${color}55` }}>
            {evaluacion ? evaluacion.concepto : ETIQUETA_ESTADO[r.estado]}
          </span>
        </div>

        {/* La falta crítica va ARRIBA del desempeño y con el hecho a la vista.
            Sin esto, una nota de 4 al lado de un 9,1 de desempeño se lee como
            un error de cuentas. */}
        {evaluacion?.faltas.map(f => (
          <div key={f.clave} style={{
            marginTop:12, padding:'10px 12px', borderRadius:8,
            background:'#ef44441a', border:'1px solid #ef444455',
          }}>
            <div style={{ ...S.tenue, letterSpacing:.5, color:'#fca5a5' }}>FALTA CRÍTICA</div>
            <div style={{ marginTop:4, color:'#fecaca' }}>{f.hecho}</div>
            <div style={{ ...S.tenue, marginTop:4 }}>
              La nota mensual no puede superar {coma(f.tope)}/10.
            </div>
          </div>
        ))}

        {evaluacion && (
          <div style={{ ...S.tenue, marginTop:10, lineHeight:1.7 }}>
            <div>
              Índice de desempeño <b style={{ color:'#e2e8f0' }}>{coma(evaluacion.desempeno)} / 10</b>
              {' '}· {coma(r.puntaje as number)} de cumplimiento ponderado
            </div>
            <div>
              Cobertura <b style={{ color:'#e2e8f0' }}>{evaluacion.cobertura.ajustada ?? 0} %</b>
              {' '}de lo exigible
              {evaluacion.cobertura.noAplica > 0
                && ` · ${evaluacion.cobertura.noAplica} puntos de peso no le aplicaban`}
            </div>
          </div>
        )}

        {/* Con menos del mínimo medido no se afirma un concepto: se dice qué se
            pudo ver. Una mala nota que sale sólo del Registro en App, con la
            mitad del servicio sin medir, no describe a un mal vigilador. */}
        {evaluacion?.alcance === 'parcial' && (
          <div style={{
            marginTop:12, padding:'10px 12px', borderRadius:8,
            background:'#f59e0b1a', border:'1px solid #f59e0b55',
          }}>
            <div style={{ ...S.tenue, letterSpacing:.5, color:'#fcd34d' }}>EVALUACIÓN PARCIAL</div>
            <div style={{ ...S.tenue, marginTop:4 }}>
              Se pudo evaluar el {evaluacion.cobertura.ajustada ?? 0} % de los requerimientos
              aplicables. La nota es orientativa: no alcanza para un concepto integral del mes.
            </div>
          </div>
        )}
        {/* Lo que este número NO dice. Va acá y no en una nota al pie: es la
            confusión más cara que puede provocar la pantalla. */}
        <div style={{ ...S.tenue, marginTop:8, lineHeight:1.5 }}>
          Mide la prestación del servicio: si estuvo, si llegó a horario, si cumplió
          las rondas que le tocaban, y si dejó todo eso registrado. Las dimensiones
          que dicen <b>«En validación»</b> se muestran pero no entran al número.
          Nada de esto mide la calidad del trato ni del criterio del vigilador: la
          evaluación del supervisor y la del cliente son otra capa, y todavía no existen.
        </div>
        {r.puntaje === null && (
          <div style={{ ...S.tenue, marginTop:8, color:'#fcd34d' }}>
            {faltanteParaMuestra(r.base)}
          </div>
        )}
      </div>

      {/* Agrupadas por lo que significan, no por cómo se calculan. Alguien que
          mira esto tiene que poder separar "prestó el servicio" de "lo dejó
          registrado", que son dos cosas distintas y se corrigen distinto. */}
      {GRUPOS.map(g => {
        const suyas = dimensiones.filter(d => g.claves.indexOf(d.clave) >= 0)
        if (suyas.length === 0) return null
        return (
          <div key={g.titulo} style={{ ...S.caja, marginTop:14 }}>
            <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:2 }}>{g.titulo}</div>
            <div style={{ ...S.tenue, color:'#64748b', marginBottom:6 }}>{g.ayuda}</div>
            {suyas.map(d => (
              <FilaDimension
                key={d.clave}
                d={d}
                pie={d.clave === 'puntualidad' ? <DetalleTardanzas p={r.puntualidad} /> : undefined}
              />
            ))}
          </div>
        )
      })}

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

      {resRondas.bajoPausa > 0 && (
        <div style={{ ...S.caja, marginTop:14 }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:8 }}>
            RONDAS BAJO PAUSA · {resRondas.bajoPausa}
          </div>

          {/* Primero la causa, que es el dato con el que se cuenta. */}
          {causasLegibles(resRondas).map(c => (
            <div key={c.causa} style={{ ...S.dim, padding:'4px 0' }}>
              · {c.cantidad} — {c.etiqueta}
              {c.causa === 'no_se_realiza' && (
                <span style={{ color:'#fcd34d' }}> · cuentan como no realizadas</span>
              )}
              {c.causa === 'sin_clasificar' && (
                <span style={{ color:'#94a3b8' }}> · fuera del cálculo</span>
              )}
            </div>
          ))}

          {/* Después el motivo escrito a mano, tal cual, sin interpretar. */}
          {Object.keys(resRondas.motivosPausa).length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:4 }}>
                MOTIVO, TAL COMO SE ESCRIBIÓ
              </div>
              {Object.entries(resRondas.motivosPausa)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .map(([motivo, cuantas]) => (
                  <div key={motivo} style={{ ...S.tenue, padding:'3px 0', color:'#cbd5e1' }}>
                    · {cuantas} — «{motivo}»
                  </div>
                ))}
            </div>
          )}

          <div style={{ ...S.tenue, marginTop:10, lineHeight:1.5 }}>
            {resRondas.pausaSinClasificar > 0 ? (
              <>
                <b>{resRondas.pausaSinClasificar}</b> de estas pausas son anteriores a que
                existiera la causa estructurada, así que no se sabe si el problema era
                técnico o si la ronda no se estaba haciendo. Quedan fuera del cálculo y
                mantienen <b>Rondas en validación</b>: distinguirlas por las palabras del
                motivo sería adivinar. Toda pausa nueva ya tiene causa obligatoria.
              </>
            ) : (
              <>La causa la eligió quien pausó la ronda. Sólo las marcadas «se podía hacer
              y no se estaba haciendo» cuentan como no realizadas; las demás salen del
              cálculo sin penalizar a nadie.</>
            )}
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
      <BloqueEntrenamiento
        empleadoId={empleadoId}
        periodo={mes}
        resultado={r}
        fuentes={{ rondas: medido.rondas, uniforme: medido.uniforme, libro: medido.libro, calidad: medido.calidad }}
      />

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
