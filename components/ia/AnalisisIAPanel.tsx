'use client'
//
// Análisis IA — disparo manual, bandeja de revisión, incorrectas y métricas.
//
// La revisión humana escribe SOLO por la RPC ia_registrar_revision: append-only
// en el historial + desnormalización, en una transacción. El resultado original
// del modelo no se toca nunca.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import { ETIQUETA_MOTIVO } from '@/lib/ia/contratos'
import IngresosDiaPanel from '@/components/ia/IngresosDiaPanel'

const FONT = brandTypography?.fontFamily ?? 'system-ui, sans-serif'
const C = {
  card: '#111827', border: '#1e2d42', muted: '#64748b', text: '#e2e8f0', sub: '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#22c55e',
  red: semanticColors.error ?? '#ef4444',
  blue: '#3b82f6',
}

const card = (extra: Record<string, unknown> = {}): React.CSSProperties => ({
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', ...extra,
})
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 10px', borderRadius: 999,
  fontSize: 11, fontWeight: 700, background: color + '22', color, fontFamily: FONT,
})
const boton = (color: string, activo = true): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
  border: `1px solid ${color}55`, background: activo ? color + '22' : 'transparent',
  color, cursor: activo ? 'pointer' : 'not-allowed', fontFamily: FONT, opacity: activo ? 1 : 0.5,
})
const input: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: '#0a0e1a', border: `1px solid ${C.border}`, color: C.text, fontFamily: FONT,
}

const COLOR_CLASIF: Record<string, string> = {
  SIN_OBSERVACIONES: C.green, REVISAR: C.yellow, EVIDENCIA_INSUFICIENTE: C.blue,
}
const ETIQUETA_TIPO_EV: Record<string, string> = {
  uniforme: 'Uniforme', libro_guardia: 'Libro de guardia', punto_control: 'Ronda',
}

type Analisis = {
  id: string
  analisis_tipo: string
  clasificacion_ia: string | null
  clasificacion_efectiva: string | null
  motivos: string[] | null
  resumen: string | null
  confianza: number | null
  estado: string
  modo: string
  modelo: string | null
  configuracion_version: string
  revision_estado: string
  revisado_at: string | null
  en_muestra_control: boolean
  evidencia_created_at: string
  objetivo_id: string
  guardia_id: string | null
  resultado_json: any
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function headersAuth(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión requerida')
  return { Authorization: `Bearer ${token}` }
}

// ════════════════════════════════════════════════════════════════════════════

export default function AnalisisIAPanel({
  user, objetivos = [], guardias = [],
}: { user?: { rol?: string }, objetivos?: any[], guardias?: any[] }) {
  const [tab, setTab] = useState<'analizar' | 'revision' | 'incorrectas' | 'metricas' | 'diario'>('revision')
  const [fechaDiario, setFechaDiario] = useState(() => {
    // Hoy en hora Argentina, no en la del navegador.
    const arg = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    return `${arg.getFullYear()}-${String(arg.getMonth() + 1).padStart(2, '0')}-${String(arg.getDate()).padStart(2, '0')}`
  })
  const esAdmin = user?.rol === 'admin'

  const [filas, setFilas] = useState<Analisis[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ampliada, setAmpliada] = useState<string | null>(null)
  const [guardandoId, setGuardandoId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'bandeja' | 'revisar' | 'insuficiente' | 'normales' | 'revisadas' | 'todas'>('bandeja')
  const [detalle, setDetalle] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')

  // Disparo manual
  const [ejecutando, setEjecutando] = useState(false)
  const [salida, setSalida] = useState<any>(null)
  // Por defecto 3: con 4 fotos de referencia cada análisis tarda ~20 s y el
  // plan Hobby corta la función a los 60. Mejor varias corridas cortas que un
  // lote entero perdido por timeout.
  const [f, setF] = useState({ desde: '', hasta: '', objetivo_id: '', tipo: '', limite: 3 })

  const nombreObjetivo = useMemo(
    () => new Map(objetivos.map((o: any) => [o.id, o.nombre])), [objetivos])
  const nombreGuardia = useMemo(
    () => new Map(guardias.map((g: any) => [g.id, `${g.apellido ?? ''}, ${g.nombre ?? ''}`.replace(/^, |, $/, '')])), [guardias])

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    const { data, error: e } = await supabase
      .from('evidencia_analisis')
      .select('*')
      .order('evidencia_created_at', { ascending: false })
      .limit(300)
    if (e) setError(e.message)
    const lista = (data ?? []) as Analisis[]
    setFilas(lista)
    setCargando(false)

    const conFoto = lista.filter(a => a.estado === 'completado').slice(0, 60)
    if (conFoto.length === 0) return
    try {
      const res = await fetch('/api/ia/evidencia/url', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ analisis_ids: conFoto.map(a => a.id) }),
      })
      const json = await res.json()
      if (res.ok) setUrls(json.urls ?? {})
    } catch { /* sin miniaturas; la bandeja igual funciona */ }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Revisión: un clic, se guarda y sigue ────────────────────────────────
  const revisar = async (id: string, decision: 'CORRECTO' | 'INCORRECTO') => {
    setGuardandoId(id); setError('')
    const { error: e } = await supabase.rpc('ia_registrar_revision', {
      p_analisis_id: id, p_decision: decision, p_comentario: null,
    })
    if (e) { setError(e.message); setGuardandoId(null); return }
    setFilas(prev => prev.map(a => a.id === id
      ? { ...a, revision_estado: decision, revisado_at: new Date().toISOString() } : a))

    // Una foto de ronda que una persona confirmó como correcta es la mejor
    // referencia posible para ese punto. Si el punto no tenía ninguna, se
    // promueve sola: el punto queda calibrado sin trabajo extra. El servidor
    // valida todo y nunca pisa una referencia cargada a mano.
    const fila = filas.find(a => a.id === id)
    if (decision === 'CORRECTO' && fila?.analisis_tipo === 'punto_control') {
      try {
        const res = await fetch('/api/ia/puntos/promover-referencia', {
          method: 'POST',
          headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ analisis_id: id }),
        })
        const json = await res.json()
        if (json?.promovida) setAviso('Esta foto quedó como referencia visual del punto.')
      } catch { /* la revisión ya quedó guardada; la promoción es un extra */ }
    }

    setGuardandoId(null)
  }

  const ejecutar = async () => {
    setEjecutando(true); setError(''); setSalida(null)
    try {
      const res = await fetch('/api/ia/analizar', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'prueba',
          limite: Number(f.limite) || 3,
          filtros: {
            desde: f.desde ? new Date(f.desde).toISOString() : undefined,
            hasta: f.hasta ? new Date(f.hasta + 'T23:59:59').toISOString() : undefined,
            objetivo_id: f.objetivo_id || undefined,
            tipos: f.tipo ? [f.tipo] : undefined,
          },
        }),
      })
      // Si la función se pasa de los 60 s, Vercel responde su propia página de
      // error en texto plano. Parsearla como JSON daba "Unexpected token 'A'",
      // que no le dice nada a nadie. Se detecta y se traduce.
      const texto = await res.text()
      let json: any
      try {
        json = JSON.parse(texto)
      } catch {
        setSalida({
          error: res.status === 504 || /timeout|FUNCTION_INVOCATION/i.test(texto)
            ? 'El análisis tardó más de 60 segundos y el servidor lo cortó. Probá con 2 o 3 fotos y volvé a ejecutar.'
            : `El servidor respondió algo inesperado (HTTP ${res.status}). Probá con menos fotos.`,
        })
        return
      }

      setSalida(res.ok ? json : { error: json.error })
      if (res.ok) await cargar()
    } catch (e: any) {
      setSalida({ error: e.message })
    } finally {
      setEjecutando(false)
    }
  }

  // ── Conjuntos por pestaña ───────────────────────────────────────────────
  const completados = filas.filter(a => a.estado === 'completado')

  // La bandeja muestra TODO lo analizado, no sólo lo que la IA marcó.
  // Ocultar las SIN_OBSERVACIONES haría imposible detectar un falso negativo
  // — que la IA diga "normal" sobre una foto que en realidad está mal — y ése
  // es el error más caro de los cuatro. El filtro está para acotar cuando el
  // volumen crezca, no para esconder.
  const bandeja = completados
    .filter(a => {
      // Vista por defecto: sólo lo que requiere una mirada humana y todavía no
      // la tuvo. Al marcar CORRECTO o INCORRECTO, la foto sale de acá.
      if (filtro === 'bandeja') {
        if (a.revision_estado !== 'PENDIENTE') return false
        return a.clasificacion_efectiva !== 'SIN_OBSERVACIONES' || a.en_muestra_control
      }
      if (filtro === 'revisar') return a.clasificacion_efectiva === 'REVISAR'
      if (filtro === 'insuficiente') return a.clasificacion_efectiva === 'EVIDENCIA_INSUFICIENTE'
      if (filtro === 'normales') return a.clasificacion_efectiva === 'SIN_OBSERVACIONES'
      if (filtro === 'revisadas') return a.revision_estado !== 'PENDIENTE'
      return true
    })
    .sort((a, b) => {
      const pa = a.revision_estado === 'PENDIENTE' ? 0 : 1
      const pb = b.revision_estado === 'PENDIENTE' ? 0 : 1
      if (pa !== pb) return pa - pb
      return b.evidencia_created_at.localeCompare(a.evidencia_created_at)
    })

  const incorrectas = completados.filter(a => a.revision_estado === 'INCORRECTO')

  const m = useMemo(() => {
    const porTipo = (tipo: string) => {
      const t = completados.filter(a => a.analisis_tipo === tipo)
      const rev = t.filter(a => a.revision_estado !== 'PENDIENTE')
      const vp = t.filter(a => a.clasificacion_efectiva !== 'SIN_OBSERVACIONES' && a.revision_estado === 'INCORRECTO').length
      const fp = t.filter(a => a.clasificacion_efectiva === 'REVISAR' && a.revision_estado === 'CORRECTO').length
      const vn = t.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES' && a.revision_estado === 'CORRECTO').length
      const fn = t.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES' && a.revision_estado === 'INCORRECTO').length
      return {
        tipo, total: t.length,
        sin: t.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES').length,
        rev_ia: t.filter(a => a.clasificacion_efectiva === 'REVISAR').length,
        insuf: t.filter(a => a.clasificacion_efectiva === 'EVIDENCIA_INSUFICIENTE').length,
        revisadas: rev.length,
        correctas: t.filter(a => a.revision_estado === 'CORRECTO').length,
        incorrectas: t.filter(a => a.revision_estado === 'INCORRECTO').length,
        vp, fp, vn, fn,
        precision: vp + fp > 0 ? Math.round((vp / (vp + fp)) * 100) : null,
      }
    }
    return ['uniforme', 'libro_guardia', 'punto_control'].map(porTipo)
  }, [completados])

  // ── Tarjeta ─────────────────────────────────────────────────────────────
  const Tarjeta = ({ a }: { a: Analisis }) => {
    const clasif = a.clasificacion_efectiva ?? '—'
    const motivo = a.motivos?.[0]
    return (
      <div style={card({ marginBottom: 12, borderColor: a.revision_estado === 'PENDIENTE' ? C.border : C.green + '44' })}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {urls[a.id]
            ? <img src={urls[a.id]} alt="" onClick={() => setAmpliada(urls[a.id])}
                style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', flexShrink: 0 }} />
            : <div style={{ width: 150, height: 150, borderRadius: 8, border: `1px dashed ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 11, flexShrink: 0 }}>
                sin vista previa</div>}

          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={badge(COLOR_CLASIF[clasif] ?? C.muted)}>{clasif.replace(/_/g, ' ')}</span>
              <span style={badge(C.muted)}>{ETIQUETA_TIPO_EV[a.analisis_tipo] ?? a.analisis_tipo}</span>
              {a.modo === 'prueba' && <span style={badge(C.blue)}>PRUEBA</span>}
              {/* Sin este cartel, una foto "sin observaciones" en la bandeja
                  parece un error del filtro. Con él se entiende por qué está. */}
              {a.en_muestra_control && a.clasificacion_efectiva === 'SIN_OBSERVACIONES' && (
                <span style={badge(C.blue)} title="Muestra al azar para verificar que la IA no deje pasar errores">
                  MUESTRA DE CONTROL
                </span>
              )}
              {a.revision_estado !== 'PENDIENTE' && (
                <span style={badge(a.revision_estado === 'CORRECTO' ? C.green : C.red)}>
                  HUMANO: {a.revision_estado}
                </span>
              )}
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
              {nombreObjetivo.get(a.objetivo_id) ?? 'Objetivo'}
            </div>
            <div style={{ fontSize: 12, color: C.sub }}>
              {a.guardia_id ? nombreGuardia.get(a.guardia_id) ?? '—' : '—'} · {fechaHora(a.evidencia_created_at)}
            </div>

            {motivo && (
              <div style={{ fontSize: 12, color: C.yellow, marginTop: 8 }}>
                <strong>Motivo:</strong> {ETIQUETA_MOTIVO[motivo] ?? motivo}
              </div>
            )}
            {a.resumen && (
              <div style={{ fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 1.5 }}>{a.resumen}</div>
            )}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
              {a.modelo ?? '—'} · {a.configuracion_version}
              {a.confianza != null ? ` · confianza ${Math.round(a.confianza * 100)}%` : ''}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button style={{ ...boton(C.green, guardandoId !== a.id), flex: 1, padding: '11px 14px', fontSize: 14 }}
                disabled={guardandoId === a.id}
                onClick={() => revisar(a.id, 'CORRECTO')}>✅ CORRECTO</button>
              <button style={{ ...boton(C.red, guardandoId !== a.id), flex: 1, padding: '11px 14px', fontSize: 14 }}
                disabled={guardandoId === a.id}
                onClick={() => revisar(a.id, 'INCORRECTO')}>❌ INCORRECTO</button>
            </div>

            <button
              onClick={() => setDetalle(detalle === a.id ? null : a.id)}
              style={{ background: 'none', border: 'none', color: C.sub, fontSize: 11, cursor: 'pointer', padding: '8px 0 0' }}
            >{detalle === a.id ? '▾ Ocultar detalle' : '▸ Ver qué evaluó la IA'}</button>
          </div>
        </div>

        {detalle === a.id && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 11, color: C.sub }}>
              <span>Nitidez: <strong style={{ color: C.text }}>{a.resultado_json?.calidad?.nitidez ?? '—'}</strong></span>
              <span>Iluminación: <strong style={{ color: C.text }}>{a.resultado_json?.calidad?.iluminacion ?? '—'}</strong></span>
              <span>Encuadre: <strong style={{ color: C.text }}>{a.resultado_json?.calidad?.encuadre ?? '—'}</strong></span>
              <span>Evaluable: <strong style={{ color: C.text }}>{a.resultado_json?.evaluable ? 'sí' : 'no'}</strong></span>
            </div>

            {(a.resultado_json?.elementos ?? []).length === 0
              ? <div style={{ fontSize: 12, color: C.muted }}>Sin desglose por elemento.</div>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {a.resultado_json.elementos.map((el: any) => {
                    const col = el.valor === 'PRESENTE' ? C.green : el.valor === 'AUSENTE' ? C.red : C.muted
                    return (
                      <div key={el.clave} style={{
                        border: `1px solid ${col}44`, borderRadius: 6, padding: '6px 10px',
                        background: col + '11', minWidth: 130,
                      }}>
                        <div style={{ fontSize: 11, color: C.text, fontWeight: 700 }}>{el.clave}</div>
                        <div style={{ fontSize: 10, color: col, fontWeight: 700 }}>{el.valor.replace(/_/g, ' ')}</div>
                        {el.comentario && (
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{el.comentario}</div>
                        )}
                      </div>
                    )
                  })}
                </div>}

            <div style={{ fontSize: 10, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
              <strong style={{ color: C.sub }}>NO DETERMINABLE</strong> significa que la IA no pudo verlo en la foto.
              No significa que falte.
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Resumen diario ──────────────────────────────────────────────────────
  // Agrupa por la fecha de la EVIDENCIA (cuándo se sacó la foto), no por la del
  // análisis: una foto de anoche analizada esta mañana pertenece a anoche.
  const diario = useMemo(() => {
    const delDia = completados.filter(a => {
      const d = new Date(a.evidencia_created_at)
        .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      return d === fechaDiario
    })

    const excepciones = delDia.filter(a =>
      (a.revision_estado === 'PENDIENTE' && (a.clasificacion_efectiva !== 'SIN_OBSERVACIONES' || a.en_muestra_control))
      || a.revision_estado === 'INCORRECTO')

    const agrupar = (clave: (a: Analisis) => string) => {
      const mapa = new Map<string, number>()
      for (const a of excepciones) {
        const k = clave(a) || '—'
        mapa.set(k, (mapa.get(k) ?? 0) + 1)
      }
      return [...mapa.entries()].sort((x, y) => y[1] - x[1])
    }

    return {
      total: delDia.length,
      sin: delDia.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES').length,
      revisar: delDia.filter(a => a.clasificacion_efectiva === 'REVISAR').length,
      insuf: delDia.filter(a => a.clasificacion_efectiva === 'EVIDENCIA_INSUFICIENTE').length,
      revisadas: delDia.filter(a => a.revision_estado !== 'PENDIENTE').length,
      correctas: delDia.filter(a => a.revision_estado === 'CORRECTO').length,
      incorrectas: delDia.filter(a => a.revision_estado === 'INCORRECTO').length,
      falsosPositivos: delDia.filter(a => a.clasificacion_efectiva === 'REVISAR' && a.revision_estado === 'CORRECTO').length,
      falsosNegativos: delDia.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES' && a.revision_estado === 'INCORRECTO').length,
      pendientes: delDia.filter(a => a.revision_estado === 'PENDIENTE'
        && (a.clasificacion_efectiva !== 'SIN_OBSERVACIONES' || a.en_muestra_control)),
      confirmadas: delDia.filter(a => a.revision_estado === 'INCORRECTO'),
      porObjetivo: agrupar(a => nombreObjetivo.get(a.objetivo_id) ?? '—'),
      porVigilador: agrupar(a => (a.guardia_id ? nombreGuardia.get(a.guardia_id) : '') ?? '—'),
      porTipo: agrupar(a => ETIQUETA_TIPO_EV[a.analisis_tipo] ?? a.analisis_tipo),
      porMotivo: agrupar(a => a.motivos?.[0] ? (ETIQUETA_MOTIVO[a.motivos[0]] ?? a.motivos[0]) : 'Sin motivo'),
    }
  }, [completados, fechaDiario, nombreObjetivo, nombreGuardia])

  const tabs: Array<{ id: typeof tab, label: string }> = [
    { id: 'revision', label: `Revisión (${bandeja.filter(a => a.revision_estado === 'PENDIENTE').length})` },
    { id: 'incorrectas', label: `Incorrectas (${incorrectas.length})` },
    { id: 'diario', label: 'Resumen diario' },
    { id: 'metricas', label: 'Métricas' },
    ...(esAdmin ? [{ id: 'analizar' as const, label: 'Analizar fotos' }] : []),
  ]

  return (
    <div style={{ padding: '4px 0 40px' }}>
      <h1 style={{ fontFamily: FONT, fontSize: 22, fontWeight: 900, color: C.text, margin: '0 0 4px' }}>
        Revisión de fotos IA
      </h1>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>
        La IA mira todo. Vos revisás lo raro. Ninguna decisión de acá modifica asistencia, horas ni liquidación.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} style={boton(tab === t.id ? C.yellow : C.muted)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div style={{ ...card({ borderColor: C.red + '66', marginBottom: 14 }), color: C.red, fontSize: 13 }}>{error}</div>}

      {aviso && (
        <div style={{ ...card({ borderColor: C.green + '66', marginBottom: 14 }), color: C.green, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>✓ {aviso}</span>
          <button style={{ ...boton(C.muted), padding: '4px 10px', fontSize: 11 }} onClick={() => setAviso('')}>Cerrar</button>
        </div>
      )}

      {tab === 'analizar' && esAdmin && (
        <div style={card({ marginBottom: 18 })}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 14, lineHeight: 1.6 }}>
            Analiza fotos reales de ingreso ya existentes. Modo <strong style={{ color: C.blue }}>prueba</strong>:
            no genera alertas, no notifica a nadie y no toca ningún registro operativo.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label style={{ fontSize: 11, color: C.sub, display: 'block' }}>Desde</label>
              <input type="date" style={input} value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: C.sub, display: 'block' }}>Hasta</label>
              <input type="date" style={input} value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: C.sub, display: 'block' }}>Objetivo</label>
              <select style={input} value={f.objetivo_id} onChange={e => setF({ ...f, objetivo_id: e.target.value })}>
                <option value="">Todos</option>
                {objetivos.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select></div>
            <div><label style={{ fontSize: 11, color: C.sub, display: 'block' }}>Tipo</label>
              <select style={input} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
                <option value="">Todos los tipos</option>
                <option value="uniforme">Sólo uniforme</option>
                <option value="libro_guardia">Sólo libro</option>
                <option value="punto_control">Sólo rondas</option>
              </select></div>
            <div><label style={{ fontSize: 11, color: C.sub, display: 'block' }}>Cantidad</label>
              <input type="number" min={1} max={6} style={{ ...input, width: 80 }}
                value={f.limite} onChange={e => setF({ ...f, limite: Number(e.target.value) })} /></div>
            <button style={boton(C.green, !ejecutando)} disabled={ejecutando} onClick={ejecutar}>
              {ejecutando ? 'Analizando…' : 'Analizar'}
            </button>
          </div>

          {salida && (
            <div style={{ marginTop: 16, padding: 14, background: '#0a0e1a', borderRadius: 8, border: `1px solid ${C.border}` }}>
              {salida.error
                ? <div style={{ color: C.red, fontSize: 13 }}>{salida.error}</div>
                : <>
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 8 }}>
                      <strong style={{ color: C.green }}>{salida.analizadas}</strong> analizadas ·{' '}
                      <strong style={{ color: C.red }}>{salida.errores}</strong> errores ·{' '}
                      <strong style={{ color: C.muted }}>{salida.omitidas}</strong> omitidas
                    </div>
                    {(salida.resultados ?? []).map((r: any, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: C.sub, padding: '3px 0' }}>
                        {r.estado === 'completado'
                          ? `✓ ${r.clasificacion_efectiva}${r.motivos?.length ? ` — ${r.motivos[0]}` : ''}`
                          : `· ${r.estado}: ${r.motivo ?? r.error ?? ''}`}
                      </div>
                    ))}
                  </>}
            </div>
          )}
        </div>
      )}

      {cargando && <div style={{ color: C.muted, padding: 24 }}>Cargando…</div>}

      {!cargando && tab === 'revision' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {([
              ['bandeja', `Para revisar (${completados.filter(a => a.revision_estado === 'PENDIENTE' && (a.clasificacion_efectiva !== 'SIN_OBSERVACIONES' || a.en_muestra_control)).length})`],
              ['revisar', `Revisar (${completados.filter(a => a.clasificacion_efectiva === 'REVISAR').length})`],
              ['insuficiente', `Ev. insuficiente (${completados.filter(a => a.clasificacion_efectiva === 'EVIDENCIA_INSUFICIENTE').length})`],
              ['normales', `Sin observaciones (${completados.filter(a => a.clasificacion_efectiva === 'SIN_OBSERVACIONES').length})`],
              ['revisadas', `Ya revisadas (${completados.filter(a => a.revision_estado !== 'PENDIENTE').length})`],
              ['todas', `Todas (${completados.length})`],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFiltro(id)}
                style={{ ...boton(filtro === id ? C.yellow : C.muted), padding: '5px 11px', fontSize: 11 }}>
                {label}
              </button>
            ))}
          </div>

          {filtro === 'bandeja' && bandeja.some(a => a.en_muestra_control && a.clasificacion_efectiva === 'SIN_OBSERVACIONES') && (
            <div style={{ ...card({ marginBottom: 12, padding: '10px 14px' }), fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
              Algunas fotos de esta lista dicen <strong style={{ color: C.green }}>SIN OBSERVACIONES</strong> y llevan
              el cartel <strong style={{ color: C.blue }}>MUESTRA DE CONTROL</strong>. Son fotos normales sorteadas al
              azar: sirven para descubrir si la IA está dejando pasar algo. Es el único error que no se detecta solo.
              Se ajusta la cantidad con <code>ia_muestra_normales_por_dia</code>.
            </div>
          )}

          {bandeja.length === 0
            ? <div style={{ ...card(), color: C.muted, fontSize: 13 }}>
                {completados.length === 0
                  ? 'Todavía no se analizó ninguna foto.'
                  : filtro === 'bandeja'
                    ? 'Nada pendiente: todas las fotos anómalas ya fueron revisadas.'
                    : 'No hay fotos con ese filtro.'}
              </div>
            : bandeja.map(a => <Tarjeta key={a.id} a={a} />)}
        </>
      )}

      {!cargando && tab === 'incorrectas' && (
        <>
          <div style={{ ...card({ marginBottom: 14 }), fontSize: 13, color: C.sub, lineHeight: 1.6 }}>
            Fotos que una persona marcó como incorrectas. Quedan acá como evidencia para que
            Administración o Supervisión decidan qué hacer. El sistema no aplica ninguna acción por sí solo.
          </div>
          {incorrectas.length === 0
            ? <div style={{ ...card(), color: C.muted, fontSize: 13 }}>Ninguna foto marcada como incorrecta.</div>
            : incorrectas.map(a => <Tarjeta key={a.id} a={a} />)}
        </>
      )}

      {!cargando && tab === 'diario' && (
        <>
          <div style={card({ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' })}>
            <label style={{ fontSize: 12, color: C.sub }}>Fecha</label>
            <input type="date" style={input} value={fechaDiario} onChange={e => setFechaDiario(e.target.value)} />
            <span style={{ fontSize: 11, color: C.muted }}>
              Agrupa por el día en que se sacó la foto, no por cuándo se analizó.
            </span>
          </div>

          <div style={card({ marginBottom: 14 })}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 14 }}>
              Resumen IA — {fechaDiario.split('-').reverse().join('/')}
            </div>
            {diario.total === 0
              ? <div style={{ color: C.muted, fontSize: 13 }}>No hay fotos analizadas de ese día.</div>
              : <>
                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
                    {([
                      ['Analizadas', diario.total, C.text],
                      ['Sin observaciones', diario.sin, C.green],
                      ['Revisar', diario.revisar, C.yellow],
                      ['Ev. insuficiente', diario.insuf, C.blue],
                    ] as const).map(([l, v, col]) => (
                      <div key={l}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: col }}>{v}</div>
                        <div style={{ color: C.muted }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12,
                    marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                    {([
                      ['Revisadas', diario.revisadas, C.text],
                      ['Correctas', diario.correctas, C.green],
                      ['Incorrectas confirmadas', diario.incorrectas, C.red],
                      ['Falsas alarmas', diario.falsosPositivos, C.yellow],
                      ['Se le escaparon', diario.falsosNegativos, C.red],
                    ] as const).map(([l, v, col]) => (
                      <div key={l}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: col }}>{v}</div>
                        <div style={{ color: C.muted }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </>}
          </div>

          {diario.total > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              {([
                ['Por objetivo', diario.porObjetivo],
                ['Por vigilador', diario.porVigilador],
                ['Por tipo', diario.porTipo],
                ['Por motivo', diario.porMotivo],
              ] as const).map(([titulo, filas]) => (
                <div key={titulo} style={card({ flex: '1 1 220px', minWidth: 200 })}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 8 }}>
                    {titulo.toUpperCase()}
                  </div>
                  {filas.length === 0
                    ? <div style={{ fontSize: 12, color: C.muted }}>Sin excepciones.</div>
                    : filas.map(([k, n]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
                          fontSize: 12, color: C.text, padding: '3px 0' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                          <strong style={{ color: C.yellow, marginLeft: 8 }}>{n}</strong>
                        </div>
                      ))}
                </div>
              ))}
            </div>
          )}

          {esAdmin && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: "4px 0 10px" }}>
                Ingresos del día
              </div>
              <IngresosDiaPanel fecha={fechaDiario} objetivos={objetivos} guardias={guardias} />
            </div>
          )}

          )}

          {diario.pendientes.length > 0 && (
            <>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.yellow, margin: '18px 0 10px' }}>
                Pendientes de revisión ({diario.pendientes.length})
              </div>
              {diario.pendientes.map(a => <Tarjeta key={a.id} a={a} />)}
            </>
          )}

          {diario.confirmadas.length > 0 && (
            <>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.red, margin: '18px 0 10px' }}>
                Incorrectas confirmadas ({diario.confirmadas.length})
              </div>
              {diario.confirmadas.map(a => <Tarjeta key={a.id} a={a} />)}
            </>
          )}
        </>
      )}

      {!cargando && tab === 'metricas' && (
        <>
          {m.filter(x => x.total > 0 || x.tipo !== 'punto_control').map(x => (
            <div key={x.tipo} style={card({ marginBottom: 14 })}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 12 }}>
                {ETIQUETA_TIPO_EV[x.tipo]}
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                {[
                  ['Analizadas', x.total, C.text], ['Sin observaciones', x.sin, C.green],
                  ['Revisar', x.rev_ia, C.yellow], ['Ev. insuficiente', x.insuf, C.blue],
                  ['Revisadas', x.revisadas, C.text], ['Correctas', x.correctas, C.green],
                  ['Incorrectas', x.incorrectas, C.red],
                ].map(([l, v, col]) => (
                  <div key={l as string}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: col as string }}>{v as number}</div>
                    <div style={{ color: C.muted }}>{l as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, marginTop: 14,
                paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                {[
                  ['Verdaderos positivos', x.vp, C.green], ['Falsos positivos', x.fp, C.red],
                  ['Verdaderos negativos', x.vn, C.green], ['Falsos negativos', x.fn, C.red],
                ].map(([l, v, col]) => (
                  <div key={l as string}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: col as string }}>{v as number}</div>
                    <div style={{ color: C.muted }}>{l as string}</div>
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: C.yellow }}>
                    {x.precision == null ? '—' : `${x.precision}%`}
                  </div>
                  <div style={{ color: C.muted }}>Precisión</div>
                </div>
              </div>
              {x.revisadas === 0 && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>
                  Sin revisiones humanas todavía: la precisión no se puede calcular.
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {ampliada && (
        <div onClick={() => setAmpliada(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          <img src={ampliada} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
