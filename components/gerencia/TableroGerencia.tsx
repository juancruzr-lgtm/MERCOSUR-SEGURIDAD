'use client'

/**
 * components/gerencia/TableroGerencia.tsx
 *
 * El detalle de la evaluación del mes.
 *
 * ── Por qué está partido en pestañas ─────────────────────────────────────────
 * La primera versión mostraba nueve tarjetas, tres gráficos y cuatro secciones
 * apiladas en una sola pantalla. Con esa densidad no se lee ninguna: para saber
 * cómo estuvo el mes había que recorrer veinte cifras y decidir cuál importaba.
 *
 * Ahora hay tres números arriba —los que contestan "¿cómo terminó?"— y una cosa
 * por vez debajo, en grande. La distribución es la vista por defecto porque es
 * la que responde la pregunta de gerencia: cuánta gente quedó en cada nota, y
 * quiénes son.
 *
 * ── Una sola fuente ──────────────────────────────────────────────────────────
 * `evaluaciones_mensuales`. No se recalcula desde turnos, rondas ni fichajes:
 * es el mismo número que ve el vigilador en Mi Desempeño.
 *
 * ── Nota y cumplimiento no se mezclan ────────────────────────────────────────
 * La nota va sobre 10. El cumplimiento ponderado va en porcentaje, con otro
 * rótulo. En ningún lugar de esta pantalla el ponderado aparece con formato /10.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { etiquetaDePeriodo, type FilaPublicada } from '@/lib/mi-desempeno'
import {
  evolucionMensual, hayTendencia, resumirGerencia,
  type ResumenGerencia,
} from '@/lib/gerencia'
import {
  ETIQUETA_ADOPCION, adopcionDeFila, resumirAdopcion,
  type AdopcionEmpleado, type ClaseAdopcion,
} from '@/lib/adopcion-app'
import {
  ETIQUETA_INTERVENCION, intervencionesDe, proximoEscalon, registrarIntervencion,
  type Intervencion,
} from '@/lib/intervenciones-uso-app'

const VERDE = '#4ade80'
const AMARILLO = '#facc15'
const ROJO = '#f87171'
const GRIS = '#475569'

const S: Record<string, React.CSSProperties> = {
  caja:   { background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:18 },
  tenue:  { fontSize:12, color:'#94a3b8', lineHeight:1.55 },
  titulo: { fontSize:15, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0' },
  rotulo: { fontSize:11, color:'#64748b', letterSpacing:.5, textTransform:'uppercase', fontWeight:800 },
  select: { background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0',
    borderRadius:8, padding:'6px 10px', fontSize:12 },
}

const COLOR_CLASE: Record<ClaseAdopcion, string> = {
  uso_correcto: VERDE,
  necesita_entrenamiento: AMARILLO,
  uso_deficiente_reiterado: ROJO,
}

const coma = (v: number | null, dec: number) =>
  v === null ? '—' : v.toFixed(dec).replace('.', ',')

const colorDeNota = (n: number) => (n >= 8 ? VERDE : n >= 6 ? AMARILLO : ROJO)

type Pestana = 'distribucion' | 'dimensiones' | 'adopcion'

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'distribucion', texto: 'Distribución de notas' },
  { id: 'dimensiones', texto: 'Qué explica el resultado' },
  { id: 'adopcion', texto: 'Uso de la app' },
]

/** Los tres números que contestan "¿cómo terminó el mes?". Nada más. */
function Titular({ rotulo, valor, sufijo, nota, color }: {
  rotulo: string; valor: string; sufijo?: string; nota: string; color?: string
}) {
  return (
    <div style={{ minWidth:180 }}>
      <div style={{ ...S.rotulo, marginBottom:4 }}>{rotulo}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
        <span style={{
          fontFamily:'Syne,sans-serif', fontSize:40, fontWeight:900, lineHeight:1.05,
          color: color ?? '#e2e8f0',
        }}>{valor}</span>
        {sufijo && <span style={{ fontSize:16, color:'#64748b', fontWeight:800 }}>{sufijo}</span>}
      </div>
      <div style={{ ...S.tenue, marginTop:2 }}>{nota}</div>
    </div>
  )
}

export default function TableroGerencia({
  mesInicial = '2026-08', onAbrirEmpleado, esAdmin = false, usuarioId = null,
}: {
  mesInicial?: string
  /** Para entrar al detalle individual. Los permisos los sigue aplicando RLS. */
  onAbrirEmpleado?: (empleadoId: string) => void
  esAdmin?: boolean
  usuarioId?: string | null
}) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [filas, setFilas] = useState<FilaPublicada[]>([])
  const [nombres, setNombres] = useState<Map<string, string>>(new Map())
  const [mes, setMes] = useState(mesInicial)
  const [previas, setPrevias] = useState<Map<string, Intervencion[]>>(new Map())
  const [registrando, setRegistrando] = useState('')
  const [pestana, setPestana] = useState<Pestana>('distribucion')
  /** Banda de nota abierta: 8 son los que sacaron 8,0 a 8,9. */
  const [banda, setBanda] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    const { data, error: err } = await supabase
      .from('evaluaciones_mensuales')
      .select('*')
      .order('periodo', { ascending: false })

    if (err) { setError(err.message); setCargando(false); return }
    const todas = (data ?? []) as FilaPublicada[]
    setFilas(todas)

    // Sólo para poder nombrar a la gente. Los números salen del snapshot.
    const ids = Array.from(new Set(todas.map(f => f.empleado_id)))
    if (ids.length > 0) {
      const { data: us } = await supabase
        .from('usuarios').select('id, nombre, apellido').in('id', ids)
      setNombres(new Map((us ?? []).map((u: any) =>
        [u.id, `${u.apellido ?? ''}, ${u.nombre ?? ''}`.replace(/^, |, $/, '')])))
    }
    setPrevias(await intervencionesDe(mes))
    setCargando(false)
  }, [mes])

  useEffect(() => { void cargar() }, [cargar])

  const periodos = useMemo(
    () => Array.from(new Set(filas.map(f => f.periodo))).sort().reverse(),
    [filas],
  )
  const delMes = useMemo(() => filas.filter(f => f.periodo === mes), [filas, mes])
  const r: ResumenGerencia = useMemo(() => resumirGerencia(delMes, mes), [delMes, mes])
  const serie = useMemo(() => evolucionMensual(filas), [filas])

  const adopciones = useMemo(
    () => delMes.map(adopcionDeFila).filter((a): a is AdopcionEmpleado => a !== null),
    [delMes],
  )
  const ad = useMemo(() => resumirAdopcion(adopciones), [adopciones])

  /** Quiénes quedaron en cada banda. Sin esto, la barra no se puede accionar. */
  const gente = useMemo(() => {
    const m = new Map<number, FilaPublicada[]>()
    for (const f of delMes) {
      if (f.datos_insuficientes || f.nota_final === null) continue
      const piso = Math.floor(Number(f.nota_final))
      if (!m.has(piso)) m.set(piso, [])
      m.get(piso)!.push(f)
    }
    return m
  }, [delMes])

  if (cargando) return <div style={{ ...S.caja, ...S.tenue }}>Cargando la evaluación congelada…</div>
  if (error) return <div style={{ ...S.caja, color:'#f87171' }}>{error}</div>

  const bandas = Object.keys(r.distribucion).map(Number).sort((a, b) => b - a)
  const maxBanda = Math.max(1, ...Object.values(r.distribucion))

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* ── Encabezado ────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
        <div>
          <div style={S.titulo}>Cumplimiento de {etiquetaDePeriodo(mes)}</div>
          <div style={S.tenue}>
            Evaluación publicada, la misma que ve cada vigilador. No se recalcula.
          </div>
        </div>
        <select style={{ ...S.select, marginLeft:'auto' }} value={mes} onChange={e => setMes(e.target.value)}>
          {periodos.map(p => <option key={p} value={p}>{etiquetaDePeriodo(p)}</option>)}
        </select>
      </div>

      {/* ── Los tres números ──────────────────────────────────────────────── */}
      <div style={{ ...S.caja, display:'flex', gap:40, flexWrap:'wrap' }}>
        <Titular
          rotulo="Nota promedio" valor={coma(r.notaPromedio, 2)} sufijo="/ 10"
          nota={`${r.conNota} con calificación · ${r.aprobados} aprobados, ${r.aplazados} aplazados`}
          color={colorDeNota(r.notaPromedio ?? 0)}
        />
        <Titular
          rotulo="Cumplimiento del procedimiento" valor={coma(r.ponderadoPromedio, 1)} sufijo="%"
          nota="no es la nota: es cuánto se cumplió"
        />
        <Titular
          rotulo="Evaluados" valor={String(r.total)}
          nota={`${r.sinMuestra} sin muestra · ${r.parciales} parciales · ${r.conTope} con tope`}
        />
      </div>

      {/* ── Una cosa por vez ──────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {PESTANAS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setPestana(p.id); setBanda(null) }}
            style={{
              background: pestana === p.id ? '#38bdf818' : '#1e293b',
              border: `1px solid ${pestana === p.id ? '#38bdf8' : '#334155'}`,
              color: pestana === p.id ? '#38bdf8' : '#e2e8f0',
              borderRadius:8, padding:'8px 14px', fontSize:12.5, fontWeight:700, cursor:'pointer',
            }}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {/* ── Distribución ───────────────────────────────────────────────────── */}
      {pestana === 'distribucion' && (
        <div style={S.caja}>
          <div style={{ ...S.tenue, marginBottom:16 }}>
            Cuánta gente quedó en cada nota. Tocá una barra para ver quiénes son.
          </div>

          {bandas.length === 0 && <div style={S.tenue}>Todavía no hay notas en este período.</div>}

          {bandas.map(n => {
            const cantidad = r.distribucion[n]
            const abierta = banda === n
            return (
              <div key={n} style={{ marginBottom:10 }}>
                <div
                  onClick={() => setBanda(abierta ? null : n)}
                  style={{ display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}
                >
                  <div style={{ width:70, fontSize:14, color:'#e2e8f0', fontWeight:700 }}>
                    {n},0 – {n},9
                  </div>
                  <div style={{ flex:1, height:26, background:'#1e293b', borderRadius:6, position:'relative' }}>
                    <div style={{
                      width:`${(cantidad / maxBanda) * 100}%`, height:26, borderRadius:6,
                      background: colorDeNota(n), transition:'width .2s',
                    }} />
                  </div>
                  <div style={{ width:74, textAlign:'right', fontSize:15, color:'#e2e8f0', fontWeight:800 }}>
                    {cantidad}
                    <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>
                      {' '}{cantidad === 1 ? 'persona' : 'personas'}
                    </span>
                  </div>
                </div>

                {abierta && (
                  <div style={{ margin:'8px 0 0 82px', paddingLeft:12, borderLeft:'2px solid #1e293b' }}>
                    {(gente.get(n) ?? [])
                      .sort((a, b) => Number(b.nota_final) - Number(a.nota_final))
                      .map(f => (
                        <div
                          key={f.empleado_id}
                          onClick={() => onAbrirEmpleado?.(f.empleado_id)}
                          style={{
                            display:'flex', gap:10, padding:'5px 0', fontSize:13, color:'#cbd5e1',
                            cursor: onAbrirEmpleado ? 'pointer' : 'default',
                          }}
                        >
                          <span style={{ flex:1 }}>{nombres.get(f.empleado_id) ?? 'Sin nombre'}</span>
                          <span style={{ color: colorDeNota(Number(f.nota_final)), fontWeight:700 }}>
                            {coma(Number(f.nota_final), 2)}
                          </span>
                          <span style={{ width:96, textAlign:'right', ...S.tenue }}>
                            {f.concepto}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}

          {r.sinMuestra > 0 && (
            <div style={{ ...S.tenue, marginTop:14, paddingTop:12, borderTop:'1px solid #1e293b' }}>
              Otras {r.sinMuestra} personas no entran en el gráfico: no hubo jornadas
              suficientes para calificarlas. No es una nota baja, es que no hay con qué medir.
            </div>
          )}
        </div>
      )}

      {/* ── Dimensiones ────────────────────────────────────────────────────── */}
      {pestana === 'dimensiones' && (
        <div style={S.caja}>
          <div style={{ ...S.tenue, marginBottom:16 }}>
            Promedio de cada dimensión, de la que peor anduvo a la que mejor. A quien no le
            correspondía una dimensión no cuenta como cero.
          </div>
          {r.dimensiones.map(d => (
            <div key={d.clave} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
              <div style={{ width:150, fontSize:14, color:'#e2e8f0', fontWeight:700 }}>{d.etiqueta}</div>
              <div style={{ width:52, fontSize:11, color:'#64748b' }}>pesa {d.peso} %</div>
              <div style={{ flex:1, height:22, background:'#1e293b', borderRadius:6 }}>
                <div style={{
                  width:`${Math.max(0, Math.min(100, d.promedio * 10))}%`, height:22, borderRadius:6,
                  background: colorDeNota(d.promedio),
                }} />
              </div>
              <div style={{ width:112, textAlign:'right' }}>
                <span style={{ fontSize:15, color:'#e2e8f0', fontWeight:800 }}>{coma(d.promedio, 2)}</span>
                <span style={{ ...S.tenue, fontSize:11 }}> sobre {d.medidas}</span>
              </div>
            </div>
          ))}

          <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid #1e293b' }}>
            <div style={{ ...S.rotulo, marginBottom:8 }}>Evolución mensual</div>
            {!hayTendencia(serie) ? (
              <div style={S.tenue}>
                Hay un solo mes publicado ({etiquetaDePeriodo(serie[0]?.periodo ?? mes)}). Con un
                punto no se puede hablar de tendencia; cuando se publique el segundo mes la
                comparación aparece sola acá.
              </div>
            ) : (
              serie.map(p => (
                <div key={p.periodo} style={{ display:'flex', gap:12, fontSize:13, color:'#cbd5e1', marginBottom:5 }}>
                  <div style={{ width:150 }}>{etiquetaDePeriodo(p.periodo)}</div>
                  <div style={{ width:90, fontWeight:700 }}>{coma(p.notaPromedio, 2)} / 10</div>
                  <div style={{ width:90 }}>{coma(p.ponderadoPromedio, 1)} %</div>
                  <div style={S.tenue}>{p.evaluados} evaluados</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Adopción de la app ───────────────────────────────────────────────
          Bloque aparte de la nota, a propósito: mide si la persona registra su
          trabajo, no cuánto cumplió el servicio. Funciona también para quien no
          tiene muestra suficiente para una calificación. */}
      {pestana === 'adopcion' && (
        <div style={S.caja}>
          <div style={{ ...S.tenue, marginBottom:16 }}>
            Mide el registro de entrada y salida. No incluye Rondas: una ronda sin hacer es
            incumplimiento del servicio, no mal uso de la app. Se clasifica también a quien
            no llegó a tener nota mensual.
          </div>

          <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:18 }}>
            {(Object.keys(ETIQUETA_ADOPCION) as ClaseAdopcion[]).map(c => (
              <div key={c} style={{ flex:'1 1 170px' }}>
                <div style={{ ...S.rotulo, marginBottom:4 }}>{ETIQUETA_ADOPCION[c]}</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:7 }}>
                  <span style={{
                    fontFamily:'Syne,sans-serif', fontSize:34, fontWeight:900,
                    color:COLOR_CLASE[c], lineHeight:1.05,
                  }}>{ad.porClase[c]}</span>
                  <span style={{ fontSize:14, color:'#64748b', fontWeight:700 }}>
                    {coma(ad.porcentaje[c], 1)} %
                  </span>
                </div>
                <div style={{ height:6, background:'#1e293b', borderRadius:99, marginTop:6 }}>
                  <div style={{
                    width:`${ad.porcentaje[c]}%`, height:6, borderRadius:99, background:COLOR_CLASE[c],
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...S.tenue, marginBottom:14 }}>
            {ad.jornadasSinRegistro} jornadas sin registro propio sobre {ad.jornadasEvaluadas}{' '}
            trabajadas · {ad.sinNota} de los clasificados no tienen nota mensual.
          </div>

          {ad.casos.length > 0 && (
            <>
              <div style={{ ...S.rotulo, marginBottom:8 }}>
                Casos para revisar · {ad.casos.length}
              </div>
              {ad.casos.map(c => {
                const hechas = previas.get(c.empleadoId) ?? []
                const siguiente = proximoEscalon(hechas.map(i => i.tipo))
                const yaEste = hechas.some(i => i.periodo === c.periodo && i.tipo === siguiente)
                return (
                  <div
                    key={c.empleadoId}
                    style={{
                      display:'flex', gap:10, alignItems:'center', padding:'8px 0',
                      borderBottom:'1px solid #1e293b',
                    }}
                  >
                    <div
                      onClick={() => onAbrirEmpleado?.(c.empleadoId)}
                      style={{ flex:1, fontSize:13.5, color:'#e2e8f0', cursor: onAbrirEmpleado ? 'pointer' : 'default' }}
                    >
                      {nombres.get(c.empleadoId) ?? 'Sin nombre'}
                      <span style={{ ...S.tenue, marginLeft:8 }}>
                        {c.sinRegistroPropio} de {c.jornadas} jornadas ({coma(c.proporcion, 1)} %)
                        {c.muestraChica && ' · muestra chica'}
                        {c.sinNota && ' · sin nota'}
                      </span>
                    </div>
                    <div style={{ fontSize:12, color:COLOR_CLASE[c.clase], width:170, textAlign:'right' }}>
                      {ETIQUETA_ADOPCION[c.clase]}
                    </div>

                    {/* La escalera. El sistema propone el escalón mirando el
                        antecedente; la decisión de darlo la toma una persona. */}
                    {esAdmin && (
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        {hechas.length > 0 && (
                          <span style={{ ...S.tenue, fontSize:11 }} title={hechas.map(i => ETIQUETA_INTERVENCION[i.tipo]).join(' · ')}>
                            {hechas.map(i => ETIQUETA_INTERVENCION[i.tipo][0]).join('·')}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={yaEste || registrando === c.empleadoId}
                          onClick={async () => {
                            setRegistrando(c.empleadoId)
                            await registrarIntervencion(c, siguiente, usuarioId)
                            setPrevias(await intervencionesDe(c.periodo))
                            setRegistrando('')
                          }}
                          style={{
                            ...S.select, cursor: yaEste ? 'default' : 'pointer',
                            opacity: yaEste ? .4 : 1, fontSize:11, padding:'4px 9px', width:118,
                          }}
                        >
                          {yaEste ? 'Registrado' : ETIQUETA_INTERVENCION[siguiente]}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ ...S.tenue, marginTop:12 }}>
                El botón registra la intervención con la evidencia del período. No manda nada
                ni sanciona: deja el antecedente para que una medida posterior se pueda
                sostener. La escalera es entrenamiento → aviso → advertencia y no salta
                escalones.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
