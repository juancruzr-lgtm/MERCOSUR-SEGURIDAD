//
// ADAPTADOR de la Página GPS.
//
// Su único trabajo es traer lo que ya existe y darle la forma que el mapa
// espera. NO es una capa de reglas: acá no se decide si un fichaje es válido,
// si una ronda se cumplió, si un punto necesita ajuste ni si una supervisión
// está aprobada. Todo eso lo resuelve el servidor y acá sólo se lee.
//
// Lo único que se "traduce" son los estados del diagnóstico a texto humano, que
// es presentación, no criterio: los estados de base no se tocan ni se renombran.
//
// Las capas de evidencia (fichajes, supervisiones) se arman en la propia página
// a partir de los datos que el dashboard YA tiene cargados, usando los helpers
// de lib/gps-asistencia.ts. Este archivo se ocupa sólo de lo que nadie más trae:
// los puntos de ronda y lo que cuelga de ellos.
//

import { supabase } from '@/lib/supabase'
import type { RecomendacionGps } from '@/lib/rondas'

/** Tope de puntos que la página trae de una. Si se supera, se avisa. */
export const LIMITE_PUNTOS_RONDA = 400

/** Marcaciones históricas que se muestran de un punto al pedir "Ver marcaciones". */
export const LIMITE_MARCACIONES = 60

// ── Traducción de estados del diagnóstico ────────────────────────────────────
// Los estados de base son sin_datos | sin_cambios | ajustar_radio | recentrar |
// recentrar_y_radio. Acá sólo se les pone nombre en castellano.

export function etiquetaDiagnostico(estado: RecomendacionGps | null): string | null {
  switch (estado) {
    case 'sin_cambios':       return 'Bien configurado'
    case 'ajustar_radio':     return 'Conviene ajustar el radio'
    case 'recentrar':         return 'Conviene revisar la ubicación'
    case 'recentrar_y_radio': return 'Conviene revisar ubicación y radio'
    case 'sin_datos':         return 'No hay datos suficientes para recomendar un ajuste'
    default:                  return null
  }
}

/** ¿El diagnóstico propone un cambio concreto? Misma regla que el servidor. */
export function proponeCambio(estado: RecomendacionGps | null): boolean {
  return estado === 'ajustar_radio' || estado === 'recentrar' || estado === 'recentrar_y_radio'
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface PuntoRondaGps {
  id: string
  nombre: string
  latitud: number
  longitud: number
  radioMetros: number | null
  gpsRequerido: boolean
  rondaBaseId: string
  rondaNombre: string
  objetivoId: string | null
  objetivoNombre: string
  puestoNombre: string | null

  // Diagnóstico ya persistido (el más reciente). null si nunca se analizó.
  diagnosticoEstado: RecomendacionGps | null
  diagnosticoFecha: string | null
  radioSugerido: number | null
  latitudSugerida: number | null
  longitudSugerida: number | null
  muestras: number | null

  // Racha de incumplimientos GPS, calculada por el servidor.
  incumplimientosConsecutivos: number
  fotoControlProximaVisita: boolean

  // Existencia de foto de referencia. Barato: no resuelve ninguna URL.
  referenciaId: string | null
}

export interface MarcacionPunto {
  id: string
  latitud: number
  longitud: number
  registradoAt: string | null
  distanciaMetros: number | null
  precisionMetros: number | null
  dentroRadio: boolean | null
  estado: string
}

export interface ResultadoPuntos {
  puntos: PuntoRondaGps[]
  truncado: boolean
  error: string | null
}

function numero(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN
  return Number.isFinite(n) ? n : null
}

// ── Carga de puntos de ronda ─────────────────────────────────────────────────

/**
 * Trae los puntos de ronda activos con posición, más lo que ya está calculado
 * sobre ellos: último diagnóstico persistido, racha de incumplimientos y si
 * tienen foto de referencia.
 *
 * NO llama a la función de diagnóstico: sólo lee lo que ya está guardado. Correr
 * el diagnóstico es una acción explícita del usuario (`analizarPuntos`).
 *
 * Los nombres de objetivo se resuelven contra la lista que el dashboard ya tiene
 * cargada, para no repetir una consulta que ya se hizo.
 */
export async function cargarPuntosRondaGps(
  nombresObjetivo: Map<string, string>,
  objetivoId?: string | null,
): Promise<ResultadoPuntos> {
  // `ronda_puntos` no tiene objetivo_id: lo hereda de su ronda base. Cuando se
  // filtra por objetivo hay que resolver primero qué rondas le pertenecen y
  // recién después pedir los puntos. Filtrar en el navegador DESPUÉS de aplicar
  // el tope daría resultados incompletos sin avisar.
  let rondasDelObjetivo: string[] | null = null
  if (objetivoId) {
    const { data: rondasObjetivo, error: errorRondas } = await supabase
      .from('rondas_base')
      .select('id')
      .eq('objetivo_id', objetivoId)
    if (errorRondas) return { puntos: [], truncado: false, error: errorRondas.message }
    rondasDelObjetivo = ((rondasObjetivo ?? []) as any[]).map(r => r.id)
    if (rondasDelObjetivo.length === 0) return { puntos: [], truncado: false, error: null }
  }

  let consulta = supabase
    .from('ronda_puntos')
    .select('id, nombre, latitud, longitud, radio_metros, gps_requerido, ronda_base_id')
    .eq('activo', true)
    .not('latitud', 'is', null)
    .order('nombre', { ascending: true })
    .limit(LIMITE_PUNTOS_RONDA + 1)

  if (rondasDelObjetivo) consulta = consulta.in('ronda_base_id', rondasDelObjetivo)

  const { data: filas, error } = await consulta
  if (error) return { puntos: [], truncado: false, error: error.message }

  let puntosCrudos = (filas ?? []) as any[]
  if (puntosCrudos.length === 0) return { puntos: [], truncado: false, error: null }

  // Rondas base: nombre, objetivo y puesto.
  // Array.from y no spread: el proyecto compila a es5 sin downlevelIteration.
  const rondaIds = Array.from(new Set(puntosCrudos.map(p => p.ronda_base_id)))
  const { data: rondas } = await supabase
    .from('rondas_base')
    .select('id, nombre, objetivo_id, puesto_id')
    .in('id', rondaIds)

  const porRonda = new Map<string, any>((rondas ?? []).map((r: any) => [r.id, r]))

  const truncado = puntosCrudos.length > LIMITE_PUNTOS_RONDA
  if (truncado) puntosCrudos = puntosCrudos.slice(0, LIMITE_PUNTOS_RONDA)
  if (puntosCrudos.length === 0) return { puntos: [], truncado, error: null }

  const puntoIds = puntosCrudos.map(p => p.id)

  const puestoIds = Array.from(new Set(
    puntosCrudos
      .map(p => porRonda.get(p.ronda_base_id)?.puesto_id)
      .filter((v: unknown): v is string => typeof v === 'string'),
  ))

  const [puestosRes, diagnosticosRes, controlRes, referenciasRes] = await Promise.all([
    puestoIds.length
      ? supabase.from('puestos').select('id, nombre').in('id', puestoIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from('ronda_punto_diagnosticos_gps')
      .select('ronda_punto_id, recomendacion, radio_sugerido, latitud_sugerida, longitud_sugerida, visitas_consideradas, created_at')
      .in('ronda_punto_id', puntoIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('ronda_punto_control_gps')
      .select('ronda_punto_id, incumplimientos_consecutivos, foto_requerida_proxima_visita')
      .in('ronda_punto_id', puntoIds),
    // Sólo el ID: saber que existe foto es una consulta, no una descarga.
    supabase
      .from('ronda_punto_referencias')
      .select('id, ronda_punto_id')
      .eq('activo', true)
      .in('ronda_punto_id', puntoIds),
  ])

  const porPuesto = new Map<string, string>(((puestosRes as any).data ?? []).map((p: any) => [p.id, p.nombre]))

  // La consulta viene ordenada por fecha descendente: el primero de cada punto
  // es el más reciente.
  const ultimoDiagnostico = new Map<string, any>()
  for (const d of ((diagnosticosRes as any).data ?? []) as any[]) {
    if (!ultimoDiagnostico.has(d.ronda_punto_id)) ultimoDiagnostico.set(d.ronda_punto_id, d)
  }

  const porControl = new Map<string, any>(
    (((controlRes as any).data ?? []) as any[]).map(c => [c.ronda_punto_id, c]),
  )
  const porReferencia = new Map<string, string>(
    (((referenciasRes as any).data ?? []) as any[]).map(r => [r.ronda_punto_id, r.id]),
  )

  const puntos: PuntoRondaGps[] = puntosCrudos.flatMap(p => {
    const lat = numero(p.latitud)
    const lng = numero(p.longitud)
    if (lat === null || lng === null) return []

    const ronda = porRonda.get(p.ronda_base_id)
    const diagnostico = ultimoDiagnostico.get(p.id)
    const control = porControl.get(p.id)
    const objetivoIdPunto = ronda?.objetivo_id ?? null

    return [{
      id: p.id,
      nombre: p.nombre,
      latitud: lat,
      longitud: lng,
      radioMetros: numero(p.radio_metros),
      gpsRequerido: Boolean(p.gps_requerido),
      rondaBaseId: p.ronda_base_id,
      rondaNombre: ronda?.nombre ?? '—',
      objetivoId: objetivoIdPunto,
      objetivoNombre: (objetivoIdPunto && nombresObjetivo.get(objetivoIdPunto)) || '—',
      puestoNombre: ronda?.puesto_id ? porPuesto.get(ronda.puesto_id) ?? null : null,

      diagnosticoEstado: (diagnostico?.recomendacion ?? null) as RecomendacionGps | null,
      diagnosticoFecha: diagnostico?.created_at ?? null,
      radioSugerido: numero(diagnostico?.radio_sugerido),
      latitudSugerida: numero(diagnostico?.latitud_sugerida),
      longitudSugerida: numero(diagnostico?.longitud_sugerida),
      muestras: numero(diagnostico?.visitas_consideradas),

      incumplimientosConsecutivos: numero(control?.incumplimientos_consecutivos) ?? 0,
      fotoControlProximaVisita: Boolean(control?.foto_requerida_proxima_visita),

      referenciaId: porReferencia.get(p.id) ?? null,
    }]
  })

  return { puntos, truncado, error: null }
}

// ── Evidencia histórica de un punto ──────────────────────────────────────────

/**
 * Dónde marcó realmente el vigilador este punto, en sus últimas visitas.
 *
 * EVIDENCIA: se lee para comparar contra la configuración. No se edita, no se
 * mueve y no se usa para recalcular nada en el navegador — el diagnóstico lo
 * sigue haciendo el servidor sobre estas mismas filas.
 */
export async function cargarMarcacionesPunto(
  puntoId: string,
): Promise<{ marcaciones: MarcacionPunto[]; error: string | null }> {
  const { data, error } = await supabase
    .from('ronda_ejecucion_puntos')
    .select('id, latitud, longitud, registrado_at, distancia_metros, precision_metros, dentro_radio, estado')
    .eq('ronda_punto_id', puntoId)
    .not('registrado_at', 'is', null)
    .not('latitud', 'is', null)
    .order('registrado_at', { ascending: false })
    .limit(LIMITE_MARCACIONES)

  if (error) return { marcaciones: [], error: error.message }

  const marcaciones = ((data ?? []) as any[]).flatMap(m => {
    const lat = numero(m.latitud)
    const lng = numero(m.longitud)
    if (lat === null || lng === null) return []
    return [{
      id: m.id,
      latitud: lat,
      longitud: lng,
      registradoAt: m.registrado_at ?? null,
      distanciaMetros: numero(m.distancia_metros),
      precisionMetros: numero(m.precision_metros),
      dentroRadio: typeof m.dentro_radio === 'boolean' ? m.dentro_radio : null,
      estado: m.estado ?? '—',
    }]
  })

  return { marcaciones, error: null }
}

// ── Foto de referencia, bajo demanda ─────────────────────────────────────────

/**
 * URL firmada de la foto de referencia de UN punto.
 *
 * Reutiliza el mismo endpoint que el editor de puntos (`/api/ia/referencias/url`):
 * el bucket es privado, el cliente manda el id de la referencia y nunca un path.
 * Se llama sólo al abrir el panel de un punto: nunca durante la carga del mapa.
 */
export async function urlFotoReferencia(referenciaId: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return null

    const res = await fetch('/api/ia/referencias/url', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'punto', ids: [referenciaId] }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.urls?.[referenciaId] ?? null
  } catch {
    // Sin miniatura no se rompe el panel: el resto de la información sigue.
    return null
  }
}
