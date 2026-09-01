'use client'

// De qué está hecha la nota de una persona, de un vistazo.
//
// ── Qué problema resuelve ───────────────────────────────────────────────────
// "7,5 · Requiere seguimiento" no dice si el problema es que no presta el
// servicio o que no lo registra, y esas dos cosas se corrigen de manera
// completamente distinta. Con las barras al lado del número queda a la vista
// que ROSÓN tiene Asistencia 10, Uniforme 10 y Libro 10 y baja por Registro en
// App 3,1: está haciendo el trabajo, lo que falla es la app.
//
// ── Lo que NO hace ──────────────────────────────────────────────────────────
// No calcula nada. Dibuja valores que ya vienen resueltos por
// `calcularCumplimiento`. No hay una segunda fórmula acá, y por eso no puede
// contradecir al número que tiene al lado.
//
// ── Los tres estados sin barra ──────────────────────────────────────────────
// Una dimensión sin nota NO se dibuja como una barra en cero: en un gráfico,
// cero se lee como "sacó cero", que es lo contrario de "no le correspondía".
//
//   No aplica            N/A     no tuvo esa obligación
//   Datos insuficientes  Sin datos   había obligación pero no alcanza para medir
//   En validación        se dibuja, con la marca de que todavía no pesa
//
// Calidad de evidencias queda afuera: pesa 0 y meterla haría pensar que empuja
// el número para algún lado.

import type { Dimension } from '@/lib/cumplimiento'

/** El orden es el del modelo, no el de la nota: se lee igual en todas las filas. */
const ORDEN: string[] = [
  'asistencia', 'rondas', 'puntualidad', 'procedimiento', 'uniforme', 'libro_guardia',
]

/** Nombres cortos: en 140 px no entra "Registro en la aplicación". */
const CORTA: Record<string, string> = {
  asistencia: 'Asistencia',
  rondas: 'Rondas',
  puntualidad: 'Puntualidad',
  procedimiento: 'Registro App',
  uniforme: 'Uniforme',
  libro_guardia: 'Libro',
}

/**
 * El color dice qué tan alta es la barra, no a qué dimensión pertenece: seis
 * colores distintos obligarían a mirar una leyenda cada vez.
 */
function colorDe(nota: number): string {
  if (nota >= 8) return '#10b981'
  if (nota >= 6) return '#38bdf8'
  if (nota >= 4) return '#f59e0b'
  return '#ef4444'
}

const coma = (v: number) => v.toFixed(1).replace('.', ',')

export interface Props {
  dimensiones: Dimension[]
  /** `compacto` va en la fila de la bandeja; `amplio` en el detalle. */
  tamano?: 'compacto' | 'amplio'
}

export default function ComposicionNota({ dimensiones, tamano = 'compacto' }: Props) {
  const amplio = tamano === 'amplio'
  const anchoBarra = amplio ? 190 : 96
  const fuente = amplio ? 11.5 : 9.5
  const alto = amplio ? 9 : 6
  const anchoEtiqueta = amplio ? 92 : 66

  const filas = ORDEN
    .map(clave => dimensiones.find(d => d.clave === clave))
    .filter((d): d is Dimension => Boolean(d))

  if (filas.length === 0) return null

  return (
    <div style={{ display:'flex', flexDirection:'column', gap: amplio ? 4 : 2, minWidth: anchoBarra + anchoEtiqueta + 34 }}>
      {filas.map(d => {
        const hayNota = d.nota !== null && d.nota !== undefined
        const enValidacion = hayNota && d.estado !== 'puntuable'

        return (
          <div key={d.clave} style={{ display:'flex', alignItems:'center', gap:6, fontSize:fuente, lineHeight:1.2 }}>
            <span style={{ width:anchoEtiqueta, color:'#94a3b8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {CORTA[d.clave] ?? d.etiqueta}
            </span>

            <span style={{
              width:anchoBarra, height:alto, borderRadius:99, background:'#1e293b',
              position:'relative', flexShrink:0, overflow:'hidden',
            }}>
              {hayNota && (
                <span style={{
                  display:'block', height:'100%', borderRadius:99,
                  width: `${Math.max(0, Math.min(100, (d.nota as number) * 10))}%`,
                  background: colorDe(d.nota as number),
                  // Media tinta cuando todavía no pesa: se ve el valor sin que
                  // se lea igual que una dimensión que sí entra al promedio.
                  opacity: enValidacion ? 0.45 : 1,
                }} />
              )}
            </span>

            {/* Sin nota NUNCA una barra en cero: en un gráfico, cero se lee
                como "sacó cero", que es lo contrario de "no le correspondía". */}
            <span style={{
              width: amplio ? 62 : 46, textAlign:'right', whiteSpace:'nowrap',
              color: hayNota ? '#e2e8f0' : '#64748b',
              fontWeight: hayNota ? 700 : 400,
              fontSize: hayNota ? fuente + 0.5 : fuente - 0.5,
            }}>
              {hayNota ? coma(d.nota as number)
                : d.estado === 'no_aplica' ? 'N/A'
                : 'Sin datos'}
            </span>

            {amplio && enValidacion && (
              <span style={{ fontSize:9, color:'#64748b', whiteSpace:'nowrap' }}>en validación</span>
            )}
          </div>
        )
      })}

      {amplio && (
        <div style={{ fontSize:10.5, color:'#64748b', marginTop:4, lineHeight:1.5 }}>
          Las barras muestran la nota ya calculada de cada dimensión: no recalculan
          el puntaje. Las que están en validación se ven más tenues porque todavía
          no pesan. Calidad de las fotos no aparece: su peso es 0.
        </div>
      )}
    </div>
  )
}
