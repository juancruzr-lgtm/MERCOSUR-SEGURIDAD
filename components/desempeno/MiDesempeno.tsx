'use client'

/**
 * components/desempeno/MiDesempeno.tsx
 *
 * La evaluación mensual, como la ve el vigilador.
 *
 * ── Una sola consulta, a una sola tabla ──────────────────────────────────────
 * Lee `evaluaciones_mensuales` y nada más. No recalcula desde turnos, rondas ni
 * evidencias: lo que se le muestra a la persona es exactamente lo que quedó
 * congelado y publicado, y no puede moverse solo mientras Administración sigue
 * corrigiendo el mes.
 *
 * ── Quién ve qué ─────────────────────────────────────────────────────────────
 * El corte lo hace RLS, no esta pantalla. La política del vigilador exige
 * `empleado_id = rondas_usuario_actual_id() and estado = 'publicada'`, así que
 * un vigilador no puede leer la evaluación de otro ni la suya sin publicar,
 * aunque alguien llame a la consulta con otro id. Esconder botones no habría
 * alcanzado.
 *
 * ── Lo que esta pantalla no hace ─────────────────────────────────────────────
 * No compara con nadie, no ordena, no dice en qué puesto quedó la persona y no
 * anuncia consecuencias. Cuenta hechos y una acción concreta por cada cosa que
 * conviene corregir.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  etiquetaDePeriodo, vistaDeEvaluacion,
  type FilaPublicada, type VistaDesempeno,
} from '@/lib/mi-desempeno'

const S: Record<string, React.CSSProperties> = {
  caja:    { background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:16 },
  tenue:   { fontSize:12, color:'#94a3b8', lineHeight:1.55 },
  titulo:  { fontSize:15, fontWeight:800, fontFamily:'Syne,sans-serif', color:'#e2e8f0' },
  rotulo:  { fontSize:11, color:'#64748b', letterSpacing:.5, textTransform:'uppercase' },
}

const COLOR_NOTA = (n: number) =>
  n >= 8 ? '#4ade80' : n >= 6 ? '#facc15' : '#f87171'

export default function MiDesempeno({
  empleadoId, periodo, encabezado = true,
}: {
  empleadoId: string
  /** `2026-08`. Sin esto se muestra el último período disponible. */
  periodo?: string
  encabezado?: boolean
}) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [vista, setVista] = useState<VistaDesempeno | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    setVista(null)

    let q = supabase
      .from('evaluaciones_mensuales')
      .select('*')
      .eq('empleado_id', empleadoId)
    if (periodo) q = q.eq('periodo', periodo)

    const { data, error: err } = await q.order('periodo', { ascending: false }).limit(1)

    setCargando(false)
    if (err) { setError(err.message); return }
    if (!data || data.length === 0) { setVista(null); return }
    setVista(vistaDeEvaluacion(data[0] as FilaPublicada))
  }, [empleadoId, periodo])

  useEffect(() => { void cargar() }, [cargar])

  if (cargando) return <div style={{ ...S.caja, ...S.tenue }}>Buscando tu evaluación…</div>
  if (error) return <div style={{ ...S.caja, color:'#f87171' }}>{error}</div>

  // Sin fila visible: o todavía no se publicó, o ese mes no le corresponde.
  if (!vista) {
    return (
      <div style={{ ...S.caja, ...S.tenue }}>
        Todavía no hay una evaluación publicada
        {periodo ? ` de ${etiquetaDePeriodo(periodo)}` : ''}. Cuando esté disponible
        vas a poder verla acá.
      </div>
    )
  }

  return (
    <div style={{ display:'grid', gap:12 }}>
      {encabezado && (
        <div>
          <div style={S.titulo}>Tu evaluación · {etiquetaDePeriodo(vista.periodo)}</div>
          <div style={S.tenue}>
            Mide cómo se cumplió el procedimiento: presencia, horario, rondas y uso de
            la aplicación. No mide tu trato con el cliente ni modifica tus horas.
          </div>
        </div>
      )}

      {/* ── Sin muestra: se explica, no se puntúa ───────────────────────────── */}
      {vista.sinMuestra ? (
        <div style={{ ...S.caja, borderColor:'#334155' }}>
          <div style={{ ...S.rotulo, marginBottom:8 }}>Sin evaluación este mes</div>
          <div style={{ fontSize:13, color:'#cbd5e1', lineHeight:1.6 }}>
            {vista.explicacionSinMuestra}
          </div>
          {/* Hechos, nunca puntajes: un 9,00 acá se leería como nota parcial. */}
          {vista.hechosSinMuestra.length > 0 && (
            <div style={{ marginTop:12, borderTop:'1px solid #1e293b', paddingTop:10 }}>
              <div style={{ ...S.rotulo, marginBottom:6 }}>Lo que sí quedó registrado</div>
              {vista.hechosSinMuestra.map((h, i) => (
                <div key={i} style={{ ...S.tenue, marginBottom:3 }}>· {h}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── La nota, y el cumplimiento bien lejos de ella ────────────────── */}
          <div style={{ ...S.caja, display:'flex', gap:20, alignItems:'center', flexWrap:'wrap' }}>
            <div>
              <div style={{ ...S.rotulo, marginBottom:4 }}>Tu calificación</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                <span style={{
                  fontSize:44, fontWeight:800, fontFamily:'Syne,sans-serif',
                  color: COLOR_NOTA(Number(vista.nota!.replace(',', '.'))), lineHeight:1,
                }}>
                  {vista.nota}
                </span>
                <span style={{ fontSize:18, color:'#64748b', fontWeight:700 }}>/ 10</span>
              </div>
              {vista.concepto && (
                <div style={{ fontSize:13, color:'#cbd5e1', marginTop:6, fontWeight:700 }}>
                  {vista.concepto}
                </div>
              )}
            </div>

            {/* Otra unidad, otro rótulo y sin el "/ 10": es la capa de abajo, no la nota. */}
            <div style={{ borderLeft:'1px solid #1e293b', paddingLeft:20 }}>
              <div style={{ ...S.rotulo, marginBottom:4 }}>Cumplimiento del procedimiento</div>
              <div style={{ fontSize:24, fontWeight:700, color:'#cbd5e1' }}>
                {vista.cumplimiento} %
              </div>
              <div style={{ ...S.tenue, maxWidth:300, marginTop:4 }}>
                Es el porcentaje de lo que se cumplió, no la calificación: la nota sale
                de aplicarle la escala.
              </div>
            </div>
          </div>

          {vista.avisoDeCobertura && (
            <div style={{ ...S.caja, ...S.tenue, borderColor:'#f59e0b55' }}>
              {vista.avisoDeCobertura}
            </div>
          )}

          {vista.topeAplicado && (
            <div style={{ ...S.caja, borderColor:'#f8717155' }}>
              <div style={{ ...S.rotulo, marginBottom:6 }}>Por qué la nota quedó ahí</div>
              <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:6 }}>
                {vista.topeAplicado.hecho}
              </div>
              <div style={S.tenue}>{vista.topeAplicado.texto}</div>
            </div>
          )}

          {vista.aTenerEnCuenta.length > 0 && (
            <div style={{ ...S.caja }}>
              <div style={{ ...S.rotulo, marginBottom:6 }}>A tener en cuenta</div>
              {vista.aTenerEnCuenta.map((h, i) => (
                <div key={i} style={{ fontSize:13, color:'#cbd5e1', marginBottom:4 }}>{h}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── De dónde sale la nota ─────────────────────────────────────────────
          Sólo cuando hay nota. Sin muestra esta lista viene vacía: los puntajes
          sueltos de un mes que no se pudo evaluar se leen como nota parcial. */}
      {vista.dimensiones.length > 0 && (
        <div style={S.caja}>
          <div style={{ ...S.rotulo, marginBottom:10 }}>Qué se mira, y cuánto pesa</div>
          <div style={{ display:'grid', gap:8 }}>
            {vista.dimensiones.map(d => (
              <div key={d.etiqueta} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:130, fontSize:13, color:'#e2e8f0' }}>{d.etiqueta}</div>
                <div style={{ width:44, fontSize:11, color:'#64748b' }}>{d.peso} %</div>
                <div style={{ flex:1, height:6, background:'#1e293b', borderRadius:99 }}>
                  {d.nota !== null && (
                    <div style={{
                      width:`${Math.max(0, Math.min(100, d.nota * 10))}%`, height:6,
                      background: COLOR_NOTA(d.nota), borderRadius:99,
                    }} />
                  )}
                </div>
                <div style={{ width:96, textAlign:'right', fontSize:12, color:'#94a3b8' }}>
                  {d.nota !== null
                    ? d.nota.toFixed(2).replace('.', ',')
                    : <span style={{ fontSize:11 }}>{d.aclaracion}</span>}
                </div>
              </div>
            ))}
          </div>
          {vista.informativas.length > 0 && (
            <div style={{ ...S.tenue, marginTop:10 }}>
              {vista.informativas.join(' y ')} se mide y se te informa, pero todavía no
              pesa en la nota.
            </div>
          )}
        </div>
      )}

      {/* ── El balance ────────────────────────────────────────────────────────── */}
      {vista.loQueSalioBien.length > 0 && (
        <div style={{ ...S.caja, borderColor:'#4ade8033' }}>
          <div style={{ ...S.rotulo, marginBottom:8 }}>Lo que hiciste bien</div>
          {vista.loQueSalioBien.map(b => (
            <div key={b.etiqueta} style={{ marginBottom:8 }}>
              <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:700 }}>{b.etiqueta}</div>
              {b.hechos.map((h, i) => (
                <div key={i} style={S.tenue}>{h}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {vista.loQueConvieneMejorar.length > 0 && (
        <div style={{ ...S.caja, borderColor:'#facc1533' }}>
          <div style={{ ...S.rotulo, marginBottom:8 }}>Lo que conviene mejorar</div>
          {vista.loQueConvieneMejorar.map(b => (
            <div key={b.etiqueta} style={{ marginBottom:10 }}>
              <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:700 }}>{b.etiqueta}</div>
              {b.hechos.map((h, i) => (
                <div key={i} style={S.tenue}>{h}</div>
              ))}
              {b.recomendacion && (
                <div style={{ fontSize:12, color:'#facc15', marginTop:4 }}>
                  → {b.recomendacion}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
