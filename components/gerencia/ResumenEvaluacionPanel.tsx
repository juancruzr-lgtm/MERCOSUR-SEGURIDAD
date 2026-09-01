'use client'

/**
 * components/gerencia/ResumenEvaluacionPanel.tsx
 *
 * Cómo viene el mes, en el Dashboard Gerencial.
 *
 * ── Por qué es esto y no el tablero ──────────────────────────────────────────
 * El tablero completo tiene nueve cifras, cuatro secciones y tres gráficos. Eso
 * sirve para estudiar el mes, no para mirarlo de reojo: puesto en el panel, no
 * se entiende nada. Acá van tres cosas y ninguna más —cómo terminó el promedio,
 * cómo se reparte la gente, y cómo viene el uso de la app— y el detalle se abre
 * al tocarlo.
 *
 * Mismo idioma que Control de Rondas, que es el precedente de la casa para un
 * resumen ejecutivo con entrada al detalle.
 *
 * ── Fuente ───────────────────────────────────────────────────────────────────
 * `evaluaciones_mensuales`, sólo publicadas. No recalcula: es el mismo número
 * que ve el vigilador en Mi Desempeño.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { etiquetaDePeriodo, type FilaPublicada } from '@/lib/mi-desempeno'
import { resumirGerencia, type ResumenGerencia } from '@/lib/gerencia'
import { adopcionDeFila, resumirAdopcion, type AdopcionEmpleado } from '@/lib/adopcion-app'

const VERDE = '#4ade80'
const AMARILLO = '#facc15'
const ROJO = '#f87171'
const GRIS = '#475569'

const coma = (v: number | null, dec: number) =>
  v === null ? '—' : v.toFixed(dec).replace('.', ',')

/** Una barra apilada: la única forma de ver el reparto sin leer números. */
function Barra({ partes }: { partes: { valor: number; color: string; titulo: string }[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1
  return (
    <div style={{ display:'flex', height:10, borderRadius:99, overflow:'hidden', background:'#1e293b' }}>
      {partes.filter(p => p.valor > 0).map((p, i) => (
        <div key={i} title={p.titulo} style={{ width:`${(p.valor / total) * 100}%`, background:p.color }} />
      ))}
    </div>
  )
}

function Leyenda({ items }: { items: { valor: number; color: string; texto: string }[] }) {
  return (
    <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:8 }}>
      {items.map(i => (
        <div key={i.texto} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#94a3b8' }}>
          <span style={{ width:8, height:8, borderRadius:99, background:i.color, display:'inline-block' }} />
          <strong style={{ color:'#e2e8f0' }}>{i.valor}</strong> {i.texto}
        </div>
      ))}
    </div>
  )
}

export default function ResumenEvaluacionPanel({ onVerDetalle }: {
  onVerDetalle?: () => void
}) {
  const [cargando, setCargando] = useState(true)
  const [resumen, setResumen] = useState<ResumenGerencia | null>(null)
  const [adopcion, setAdopcion] = useState<ReturnType<typeof resumirAdopcion> | null>(null)
  const [periodo, setPeriodo] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('evaluaciones_mensuales')
      .select('*')
      .eq('estado', 'publicada')
      .order('periodo', { ascending: false })

    const todas = (data ?? []) as FilaPublicada[]
    if (todas.length === 0) { setCargando(false); return }

    // El último período publicado. Si Administración todavía no publicó el mes
    // en curso, esto muestra el anterior, que es el último hecho cierto.
    const ultimo = todas[0].periodo
    const delMes = todas.filter(f => f.periodo === ultimo)
    setPeriodo(ultimo)
    setResumen(resumirGerencia(delMes, ultimo))
    setAdopcion(resumirAdopcion(
      delMes.map(adopcionDeFila).filter((a): a is AdopcionEmpleado => a !== null),
    ))
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  if (cargando) {
    return <div style={{ fontSize:12, color:'#94a3b8' }}>Cargando la evaluación del mes…</div>
  }
  // Sin nada publicado no se ocupa espacio en el panel con una caja vacía.
  if (!resumen || !adopcion) return null

  const nota = resumen.notaPromedio

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800, color:'#e2e8f0', letterSpacing:.3 }}>
          Cumplimiento de {etiquetaDePeriodo(periodo)}
        </div>
        <div style={{ fontSize:12, color:'#64748b' }}>
          evaluación publicada · {resumen.total} vigiladores
        </div>
        {onVerDetalle && (
          <button
            type="button"
            onClick={onVerDetalle}
            style={{
              marginLeft:'auto', background:'transparent', border:'none',
              color:'#38bdf8', fontSize:12, fontWeight:700, cursor:'pointer', padding:0,
            }}
          >
            Ver detalle →
          </button>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:24 }}>
        {/* 1. Cómo terminó el mes */}
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:.5, fontWeight:800 }}>
              Nota promedio
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
              <span style={{
                fontFamily:'Syne,sans-serif', fontSize:38, fontWeight:900, lineHeight:1.1,
                color: (nota ?? 0) >= 8 ? VERDE : (nota ?? 0) >= 6 ? AMARILLO : ROJO,
              }}>
                {coma(nota, 2)}
              </span>
              <span style={{ fontSize:15, color:'#64748b', fontWeight:800 }}>/ 10</span>
            </div>
            <div style={{ fontSize:12, color:'#94a3b8' }}>
              cumplimiento {coma(resumen.ponderadoPromedio, 1)} %
            </div>
          </div>
        </div>

        {/* 2. Cómo se reparte la gente */}
        <div>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:.5, fontWeight:800, marginBottom:8 }}>
            Cómo se reparte
          </div>
          <Barra partes={[
            { valor: resumen.aprobados, color: VERDE, titulo: 'Aprobados' },
            { valor: resumen.aplazados, color: ROJO, titulo: 'Aplazados' },
            { valor: resumen.sinMuestra, color: GRIS, titulo: 'Sin muestra' },
          ]} />
          <Leyenda items={[
            { valor: resumen.aprobados, color: VERDE, texto: 'aprobados' },
            { valor: resumen.aplazados, color: ROJO, texto: 'aplazados' },
            { valor: resumen.sinMuestra, color: GRIS, texto: 'sin muestra' },
          ]} />
        </div>

        {/* 3. El uso de la app, que es otra cosa que la nota */}
        <div>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:.5, fontWeight:800, marginBottom:8 }}>
            Uso de la app
          </div>
          <Barra partes={[
            { valor: adopcion.porClase.uso_correcto, color: VERDE, titulo: 'Uso correcto' },
            { valor: adopcion.porClase.necesita_entrenamiento, color: AMARILLO, titulo: 'Necesita entrenamiento' },
            { valor: adopcion.porClase.uso_deficiente_reiterado, color: ROJO, titulo: 'Uso deficiente reiterado' },
          ]} />
          <Leyenda items={[
            { valor: adopcion.porClase.uso_correcto, color: VERDE, texto: 'usan bien' },
            { valor: adopcion.porClase.necesita_entrenamiento, color: AMARILLO, texto: 'a entrenar' },
            { valor: adopcion.porClase.uso_deficiente_reiterado, color: ROJO, texto: 'reiterado' },
          ]} />
        </div>
      </div>
    </div>
  )
}
