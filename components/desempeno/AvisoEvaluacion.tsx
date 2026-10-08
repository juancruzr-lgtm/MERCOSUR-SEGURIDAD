'use client'

/**
 * components/desempeno/AvisoEvaluacion.tsx
 *
 * "Tu evaluación está disponible", al entrar a la app.
 *
 * ── Por qué un cartel y no una franja ────────────────────────────────────────
 * Una franja arriba de la pantalla se pasa de largo: el vigilador entra a
 * fichar, mira el botón de ingreso y no lee nada más. El cartel obliga a
 * decidir, y se muestra una sola vez por persona.
 *
 * ── Por qué no alcanza la push ───────────────────────────────────────────────
 * De los 63 vigiladores activos con evaluación publicada, 24 no tienen ninguna
 * suscripción push. Para ellos este cartel es lo único que les avisa.
 *
 * ── Cuándo deja de aparecer ──────────────────────────────────────────────────
 * Cuando la evaluación queda registrada como Visto, que pasa solo al abrirla.
 * "Después" lo cierra únicamente por esta sesión: no se marca visto lo que no
 * se vio, y la persona tiene que poder encontrarlo mañana. No hay un "no
 * mostrar más", porque sería un tercer estado encubierto.
 *
 * ── Si la evaluación se corrige ───────────────────────────────────────────────
 * Una salida injustificada confirmada recalcula la evaluación publicada (orden
 * de Gerencia del 08/10/2026). Si la versión que vio es anterior a la
 * corrección, el cartel vuelve —una vez por versión— y dice que fue corregida.
 *
 * ── Qué no dice ──────────────────────────────────────────────────────────────
 * La nota. Avisa que está disponible; la calificación se ve adentro.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { etiquetaDePeriodo } from '@/lib/mi-desempeno'

const CLAVE_SESION = 'mercosur_aviso_evaluacion_pospuesto'

export default function AvisoEvaluacion({ empleadoId, onIr }: {
  empleadoId: string
  /** Lleva a Mi Legajo → Mi Desempeño. */
  onIr?: () => void
}) {
  const [pendiente, setPendiente] = useState<{ id: string; periodo: string; version: number; corregida: boolean } | null>(null)
  const [pospuesto, setPospuesto] = useState(true)

  const cargar = useCallback(async () => {
    // RLS ya recorta a lo propio y publicado: esta consulta no puede traer la
    // evaluación de otro aunque se le pase otro id.
    let ev: { data: any[] | null; error: any } = await supabase
      .from('evaluaciones_mensuales')
      .select('id, periodo, version, corregida_at')
      .eq('empleado_id', empleadoId)
      .eq('estado', 'publicada')
      .order('periodo', { ascending: false })
      .limit(1)
    // Sin la migración de salidas anticipadas esas columnas no existen.
    if (ev.error) {
      ev = await supabase
        .from('evaluaciones_mensuales')
        .select('id, periodo')
        .eq('empleado_id', empleadoId)
        .eq('estado', 'publicada')
        .order('periodo', { ascending: false })
        .limit(1)
    }

    const ultima = ev.data?.[0]
    if (!ultima) { setPendiente(null); return }

    let lect: { data: any[] | null; error: any } = await supabase
      .from('lecturas_evaluacion')
      .select('id, version_vista')
      .eq('evaluacion_id', ultima.id)
      .limit(1)
    if (lect.error) {
      lect = await supabase.from('lecturas_evaluacion').select('id').eq('evaluacion_id', ultima.id).limit(1)
    }
    const leida = lect.data?.[0]
    const version = Number(ultima.version ?? 1)
    // Vista, y no corregida después: nada que avisar.
    const corregidaSinVer = Boolean(ultima.corregida_at) && Number(leida?.version_vista ?? 0) < version
    if (leida && !corregidaSinVer) { setPendiente(null); return }

    // El "Después" vale por esta sesión. Si se cierra la app, vuelve.
    let yaPospuesto = false
    try {
      yaPospuesto = sessionStorage.getItem(CLAVE_SESION) === `${ultima.id}:${version}`
    } catch { /* sin sessionStorage el cartel simplemente aparece */ }

    setPospuesto(yaPospuesto)
    setPendiente({ id: ultima.id, periodo: ultima.periodo, version, corregida: Boolean(leida) && corregidaSinVer })
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  if (!pendiente || pospuesto) return null

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1000, background:'rgba(2,6,23,.82)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div style={{
        background:'#0f172a', border:'1px solid #38bdf855', borderRadius:14,
        padding:22, maxWidth:400, width:'100%',
        boxShadow:'0 24px 60px rgba(0,0,0,.5)',
      }}>
        <div style={{ fontSize:30, marginBottom:10 }}>📋</div>

        <div style={{
          fontSize:17, fontWeight:800, color:'#e2e8f0', lineHeight:1.35,
          fontFamily:'Syne,sans-serif',
        }}>
          {pendiente.corregida
            ? `Tu evaluación de ${etiquetaDePeriodo(pendiente.periodo)} fue corregida`
            : `Tu evaluación de ${etiquetaDePeriodo(pendiente.periodo)} ya está disponible`}
        </div>

        <div style={{ fontSize:13.5, color:'#94a3b8', lineHeight:1.6, marginTop:10 }}>
          {pendiente.corregida
            ? 'Se actualizó por una falta confirmada. Entrá a Mi Legajo → Mi Desempeño para ver tu nota y la explicación.'
            : 'Entrá a Mi Legajo → Mi Desempeño para consultar tu calificación y las recomendaciones del Entrenador Operativo.'}
        </div>

        <div style={{ display:'flex', gap:10, marginTop:18 }}>
          <button
            type="button"
            onClick={() => onIr?.()}
            style={{
              flex:1, background:'#38bdf8', border:'none', color:'#04202e',
              borderRadius:10, padding:'12px 14px', fontSize:14, fontWeight:800,
              cursor:'pointer',
            }}
          >
            Ver mi evaluación
          </button>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.setItem(CLAVE_SESION, `${pendiente.id}:${pendiente.version}`) } catch { /* da igual */ }
              setPospuesto(true)
            }}
            style={{
              background:'#1e293b', border:'1px solid #334155', color:'#94a3b8',
              borderRadius:10, padding:'12px 14px', fontSize:14, cursor:'pointer',
            }}
          >
            Después
          </button>
        </div>
      </div>
    </div>
  )
}
