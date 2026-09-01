'use client'

/**
 * components/gerencia/TableroGerencia.tsx
 *
 * El tablero de Gerencia, leído de la evaluación congelada.
 *
 * ── Una sola consulta, a una sola tabla ──────────────────────────────────────
 * `evaluaciones_mensuales`. No se recalcula desde turnos, rondas ni fichajes.
 * Gerencia y el vigilador miran exactamente el mismo número: si hubiera dos
 * cuentas, el día que una cambiara la otra quedaría mintiendo.
 *
 * ── Nota y cumplimiento no se mezclan ────────────────────────────────────────
 * La nota va sobre 10 y se rotula como calificación. El cumplimiento ponderado
 * va en porcentaje, en otra tarjeta y con otra unidad. En ningún lugar de esta
 * pantalla el ponderado aparece con formato /10.
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

const S: Record<string, React.CSSProperties> = {
  caja:   { background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:16 },
  tenue:  { fontSize:12, color:'#94a3b8', lineHeight:1.55 },
  titulo: { fontSize:15, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0' },
  rotulo: { fontSize:11, color:'#64748b', letterSpacing:.5, textTransform:'uppercase' },
  select: { background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0',
    borderRadius:8, padding:'6px 10px', fontSize:12 },
  cifra:  { fontSize:30, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0', lineHeight:1.1 },
}

const COLOR_CLASE: Record<ClaseAdopcion, string> = {
  uso_correcto: '#4ade80',
  necesita_entrenamiento: '#facc15',
  uso_deficiente_reiterado: '#f87171',
}

const coma = (v: number | null, dec: number) =>
  v === null ? '—' : v.toFixed(dec).replace('.', ',')

function Tarjeta({ rotulo, valor, sufijo, nota }: {
  rotulo: string; valor: string; sufijo?: string; nota?: string
}) {
  return (
    <div style={{ ...S.caja, minWidth:150, flex:'1 1 150px' }}>
      <div style={{ ...S.rotulo, marginBottom:6 }}>{rotulo}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:4 }}>
        <span style={S.cifra}>{valor}</span>
        {sufijo && <span style={{ fontSize:15, color:'#64748b', fontWeight:700 }}>{sufijo}</span>}
      </div>
      {nota && <div style={{ ...S.tenue, marginTop:4 }}>{nota}</div>}
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

    // Sólo para poder nombrar a la gente en la lista de casos. Los números no
    // salen de acá: salen del snapshot.
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

  if (cargando) return <div style={{ ...S.caja, ...S.tenue }}>Cargando la evaluación congelada…</div>
  if (error) return <div style={{ ...S.caja, color:'#f87171' }}>{error}</div>

  const notas = Object.keys(r.distribucion).map(Number).sort((a, b) => b - a)
  const maxDistrib = Math.max(1, ...Object.values(r.distribucion))

  return (
    <div style={{ display:'grid', gap:12 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <div>
          <div style={S.titulo}>Tablero de Gerencia · {etiquetaDePeriodo(mes)}</div>
          <div style={S.tenue}>
            Sale de la evaluación mensual congelada, la misma que ve cada vigilador.
            No se recalcula desde turnos ni fichajes.
          </div>
        </div>
        <select style={{ ...S.select, marginLeft:'auto' }} value={mes} onChange={e => setMes(e.target.value)}>
          {periodos.map(p => <option key={p} value={p}>{etiquetaDePeriodo(p)}</option>)}
        </select>
      </div>

      {/* ── Las dos magnitudes, en tarjetas distintas ──────────────────────── */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        <Tarjeta
          rotulo="Nota final promedio" valor={coma(r.notaPromedio, 2)} sufijo="/ 10"
          nota={`sobre ${r.conNota} evaluaciones con calificación`}
        />
        <Tarjeta
          rotulo="Cumplimiento ponderado promedio" valor={coma(r.ponderadoPromedio, 1)} sufijo="%"
          nota="no es la nota: es cuánto del procedimiento se cumplió"
        />
        <Tarjeta
          rotulo="Cobertura evaluativa" valor={coma(r.coberturaPromedio, 1)} sufijo="%"
          nota="cuánto de lo exigible se pudo medir"
        />
      </div>

      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        <Tarjeta rotulo="Evaluados" valor={String(r.total)} nota={`${r.conNota} con calificación`} />
        <Tarjeta rotulo="Aprobados" valor={String(r.aprobados)} nota="nota 6 o más" />
        <Tarjeta rotulo="Aplazados" valor={String(r.aplazados)} nota="nota menor a 6" />
        <Tarjeta rotulo="Sin muestra" valor={String(r.sinMuestra)} nota="no alcanzó para calificar" />
        <Tarjeta rotulo="Parciales" valor={String(r.parciales)} nota="con cobertura limitada" />
        <Tarjeta rotulo="Con tope" valor={String(r.conTope)} nota="falta crítica registrada" />
      </div>

      {/* ── Distribución ───────────────────────────────────────────────────── */}
      <div style={S.caja}>
        <div style={{ ...S.rotulo, marginBottom:10 }}>Distribución de notas</div>
        {notas.length === 0 && <div style={S.tenue}>Todavía no hay notas en este período.</div>}
        {notas.map(n => (
          <div key={n} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <div style={{ width:52, fontSize:12, color:'#94a3b8' }}>{n},0 – {n},9</div>
            <div style={{ flex:1, height:14, background:'#1e293b', borderRadius:4 }}>
              <div style={{
                width:`${(r.distribucion[n] / maxDistrib) * 100}%`, height:14, borderRadius:4,
                background: n >= 8 ? '#4ade80' : n >= 6 ? '#facc15' : '#f87171',
              }} />
            </div>
            <div style={{ width:28, textAlign:'right', fontSize:12, color:'#e2e8f0' }}>
              {r.distribucion[n]}
            </div>
          </div>
        ))}
      </div>

      {/* ── Qué explica el resultado ───────────────────────────────────────── */}
      <div style={S.caja}>
        <div style={{ ...S.rotulo, marginBottom:10 }}>
          Dimensiones que explican el resultado
        </div>
        {r.dimensiones.map(d => (
          <div key={d.clave} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <div style={{ width:130, fontSize:13, color:'#e2e8f0' }}>{d.etiqueta}</div>
            <div style={{ width:44, fontSize:11, color:'#64748b' }}>{d.peso} %</div>
            <div style={{ flex:1, height:6, background:'#1e293b', borderRadius:99 }}>
              <div style={{
                width:`${Math.max(0, Math.min(100, d.promedio * 10))}%`, height:6, borderRadius:99,
                background: d.promedio >= 8 ? '#4ade80' : d.promedio >= 6 ? '#facc15' : '#f87171',
              }} />
            </div>
            <div style={{ width:80, textAlign:'right', fontSize:12, color:'#94a3b8' }}>
              {coma(d.promedio, 2)} · {d.medidas}
            </div>
          </div>
        ))}
        <div style={{ ...S.tenue, marginTop:8 }}>
          Promedio de cada dimensión sobre 10, y sobre cuántas personas se pudo medir.
          A quien no le correspondía una dimensión no cuenta como cero.
        </div>
      </div>

      {/* ── Evolución ──────────────────────────────────────────────────────── */}
      <div style={S.caja}>
        <div style={{ ...S.rotulo, marginBottom:10 }}>Evolución mensual</div>
        {!hayTendencia(serie) ? (
          <div style={S.tenue}>
            Hay un solo mes publicado ({etiquetaDePeriodo(serie[0]?.periodo ?? mes)}). Con un
            punto no se puede hablar de tendencia; cuando se publique el segundo mes la
            comparación aparece sola acá.
          </div>
        ) : (
          serie.map(p => (
            <div key={p.periodo} style={{ display:'flex', gap:10, fontSize:13, color:'#cbd5e1', marginBottom:4 }}>
              <div style={{ width:130 }}>{etiquetaDePeriodo(p.periodo)}</div>
              <div style={{ width:90 }}>{coma(p.notaPromedio, 2)} / 10</div>
              <div style={{ width:90 }}>{coma(p.ponderadoPromedio, 1)} %</div>
              <div style={S.tenue}>{p.evaluados} evaluados</div>
            </div>
          ))
        )}
      </div>

      {/* ── Adopción de la app ─────────────────────────────────────────────────
          Bloque aparte de la nota, a propósito: mide si la persona registra su
          trabajo en la aplicación, no cuánto cumplió el servicio. Funciona
          también para quien no tiene muestra suficiente para una calificación. */}
      <div style={{ ...S.caja, borderColor:'#38bdf855' }}>
        <div style={{ ...S.rotulo, marginBottom:4 }}>Adopción de la app</div>
        <div style={{ ...S.tenue, marginBottom:12 }}>
          Mide el registro de entrada y salida en la aplicación. No incluye Rondas:
          una ronda sin hacer es incumplimiento del servicio, no mal uso de la app.
          Se clasifica también a quien no llegó a tener nota mensual.
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
          {(Object.keys(ETIQUETA_ADOPCION) as ClaseAdopcion[]).map(c => (
            <div key={c} style={{ ...S.caja, minWidth:150, flex:'1 1 150px', borderColor:`${COLOR_CLASE[c]}44` }}>
              <div style={{ ...S.rotulo, marginBottom:6 }}>{ETIQUETA_ADOPCION[c]}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                <span style={{ ...S.cifra, color:COLOR_CLASE[c] }}>{ad.porClase[c]}</span>
                <span style={{ fontSize:13, color:'#64748b' }}>{coma(ad.porcentaje[c], 1)} %</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...S.tenue, marginBottom:10 }}>
          {ad.jornadasSinRegistro} jornadas sin registro propio sobre {ad.jornadasEvaluadas}{' '}
          trabajadas · {ad.sinNota} de los clasificados no tienen nota mensual.
        </div>

        {ad.casos.length > 0 && (
          <>
            <div style={{ ...S.rotulo, marginBottom:8 }}>Casos para revisar</div>
            {ad.casos.map(c => (
              <div
                key={c.empleadoId}
                onClick={() => onAbrirEmpleado?.(c.empleadoId)}
                style={{
                  display:'flex', gap:10, alignItems:'center', padding:'6px 0',
                  borderBottom:'1px solid #1e293b',
                  cursor: onAbrirEmpleado ? 'pointer' : 'default',
                }}
              >
                <div style={{ flex:1, fontSize:13, color:'#e2e8f0' }}>
                  {nombres.get(c.empleadoId) ?? 'Sin nombre'}
                </div>
                <div style={{ fontSize:12, color:COLOR_CLASE[c.clase] }}>
                  {ETIQUETA_ADOPCION[c.clase]}
                </div>
                <div style={{ width:170, textAlign:'right', ...S.tenue }}>
                  {c.sinRegistroPropio} de {c.jornadas} jornadas ({coma(c.proporcion, 1)} %)
                  {c.muestraChica && ' · muestra chica'}
                  {c.sinNota && ' · sin nota'}
                </div>

                {/* La escalera. El sistema propone el escalón mirando lo que ya
                    se hizo; la decisión de darlo la toma una persona. */}
                {esAdmin && (() => {
                  const hechas = previas.get(c.empleadoId) ?? []
                  const siguiente = proximoEscalon(hechas.map(i => i.tipo))
                  const yaEste = hechas.some(i => i.periodo === c.periodo && i.tipo === siguiente)
                  return (
                    <div style={{ display:'flex', gap:6, alignItems:'center' }} onClick={e => e.stopPropagation()}>
                      {hechas.length > 0 && (
                        <span style={{ ...S.tenue, fontSize:11 }}>
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
                          opacity: yaEste ? .4 : 1, fontSize:11, padding:'4px 8px',
                        }}
                      >
                        {yaEste ? 'Registrado' : ETIQUETA_INTERVENCION[siguiente]}
                      </button>
                    </div>
                  )
                })()}
              </div>
            ))}
            <div style={{ ...S.tenue, marginTop:10 }}>
              El botón registra la intervención con la evidencia del período. No manda
              nada ni sanciona: deja el antecedente para que una medida posterior se
              pueda sostener. La escalera es entrenamiento → aviso → advertencia y no
              salta escalones.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
