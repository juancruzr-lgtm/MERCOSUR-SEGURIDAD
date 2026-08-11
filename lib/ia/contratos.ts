// lib/ia/contratos.ts
//
// Contrato de salida del modelo + derivación de la clasificación efectiva.
// Lógica pura: sin red, sin Supabase, sin SDK. Testeable.
//
// Uniforme y libro comparten la MISMA forma de salida a propósito: en los dos
// casos la pregunta es "¿este elemento está, no está, o no puedo saberlo?".
// Lo único que cambia es el catálogo de elementos y el texto del prompt.

import type { ElementoCriterio } from './referencias'

export const CLASIFICACIONES = ['SIN_OBSERVACIONES', 'REVISAR', 'EVIDENCIA_INSUFICIENTE'] as const
export type Clasificacion = typeof CLASIFICACIONES[number]

export const VALORES = ['PRESENTE', 'AUSENTE', 'NO_DETERMINABLE'] as const
export type Valor = typeof VALORES[number]

export const NIVELES_CALIDAD = ['OK', 'BAJA', 'CRITICA'] as const
export type NivelCalidad = typeof NIVELES_CALIDAD[number]

export const MOTIVOS = [
  'FOTO_OSCURA', 'FOTO_BORROSA', 'FOTO_SOBREEXPUESTA', 'CAMARA_TAPADA',
  'ENCUADRE_INSUFICIENTE', 'SIN_PERSONA_EN_IMAGEN', 'MULTIPLES_PERSONAS',
  'ELEMENTO_REQUERIDO_AUSENTE', 'ELEMENTO_NO_DETERMINABLE',
  'ILEGIBLE', 'NO_CORRESPONDE_AL_TIPO', 'OTRO',
] as const
export type Motivo = typeof MOTIVOS[number]

export type ElementoEvaluado = { clave: string, valor: Valor, comentario: string }

export type ResultadoIA = {
  evaluable: boolean
  clasificacion: Clasificacion
  confianza: number
  motivos: string[]
  elementos: ElementoEvaluado[]
  calidad: { nitidez: NivelCalidad, iluminacion: NivelCalidad, encuadre: NivelCalidad }
  resumen: string
}

// ── JSON Schema para responseSchema de Gemini ───────────────────────────────
// Subconjunto OpenAPI 3.0 que acepta la API. Sin additionalProperties, sin $ref.

export function schemaRespuesta(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      evaluable: { type: 'boolean' },
      clasificacion: { type: 'string', enum: [...CLASIFICACIONES] },
      confianza: { type: 'number' },
      motivos: { type: 'array', items: { type: 'string', enum: [...MOTIVOS] } },
      elementos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clave: { type: 'string' },
            valor: { type: 'string', enum: [...VALORES] },
            comentario: { type: 'string' },
          },
          required: ['clave', 'valor'],
        },
      },
      calidad: {
        type: 'object',
        properties: {
          nitidez: { type: 'string', enum: [...NIVELES_CALIDAD] },
          iluminacion: { type: 'string', enum: [...NIVELES_CALIDAD] },
          encuadre: { type: 'string', enum: [...NIVELES_CALIDAD] },
        },
        required: ['nitidez', 'iluminacion', 'encuadre'],
      },
      resumen: { type: 'string' },
    },
    required: ['evaluable', 'clasificacion', 'confianza', 'motivos', 'elementos', 'calidad', 'resumen'],
  }
}

// ── Prompt ──────────────────────────────────────────────────────────────────
// Se genera desde los criterios que cargó Administración. Determinista: los
// mismos criterios producen el mismo prompt, y su sha256 queda guardado en la
// configuración para que un análisis viejo siga siendo reconstruible.

const REGLAS_COMUNES = `
REGLAS QUE NO PODÉS VIOLAR:
1. Si un elemento no se ve en la imagen, su valor es NO_DETERMINABLE. NUNCA AUSENTE.
   Que algo quede fuera de cuadro no prueba que falte.
2. AUSENTE se usa SOLAMENTE cuando la zona donde debería estar el elemento SÍ es
   visible y el elemento claramente no está.
3. Si la imagen no permite evaluar (oscura, borrosa, tapada, encuadre inservible),
   devolvés clasificacion = EVIDENCIA_INSUFICIENTE y evaluable = false.
   EVIDENCIA_INSUFICIENTE NO es un incumplimiento: es "no puedo saberlo".
4. No identifiques a la persona. No describas rasgos físicos, cara, edad, género,
   tatuajes ni ninguna característica biométrica. No es tu tarea y está prohibido.
5. No transcribas texto manuscrito. Sólo indicás si hay escritura y si es legible.
6. El resumen es una sola oración, máximo 200 caracteres, sin nombres propios.
7. confianza es un número entre 0 y 1 sobre tu propia evaluación.
8. En elementos devolvés EXACTAMENTE una entrada por cada clave del listado, ni
   más ni menos, usando la clave literal.
`.trim()

const CONTEXTO_TIPO: Record<string, string> = {
  uniforme: `Estás mirando la foto de uniforme que un vigilador de seguridad privada se saca al fichar su ingreso.
Tu tarea es determinar qué elementos del uniforme reglamentario son visibles y correctos.`,
  libro_guardia: `Estás mirando la foto del libro de guardia que un vigilador saca al fichar su ingreso.
Tu tarea es determinar si la página es legible y qué campos aparecen completados.
NO transcribas el contenido: sólo presencia y legibilidad.`,
  punto_control: `Estás mirando la foto que un vigilador sacó al registrar un punto de control durante una ronda.

Esta foto se analiza porque el GPS del dispositivo quedó FUERA del radio permitido del punto.
Tu tarea es aportar evidencia visual complementaria: ¿la imagen se parece a la referencia de
ese punto o no?

El GPS sigue siendo la evidencia geográfica principal. Vos NO decidís si el vigilador estuvo
donde debía. Aportás una señal más para que una persona decida.

Si NO recibiste una foto de referencia, el elemento "coincide_con_referencia" es
NO_DETERMINABLE de forma obligatoria: sin patrón no hay comparación posible.`,
}

export function construirPrompt(analisisTipo: string, elementos: ElementoCriterio[]): string {
  const listado = elementos
    .map(e => `- ${e.clave}: ${e.etiqueta}${e.requerido ? ' [REQUERIDO]' : ' [opcional]'}${e.nota ? ` — ${e.nota}` : ''}`)
    .join('\n')

  return [
    CONTEXTO_TIPO[analisisTipo] ?? CONTEXTO_TIPO.uniforme,
    '',
    'ELEMENTOS A EVALUAR (usá estas claves literales):',
    listado,
    '',
    REGLAS_COMUNES,
    '',
    'Respondé únicamente con el JSON del schema. Sin texto adicional.',
  ].join('\n')
}

// ── Normalización de la respuesta ───────────────────────────────────────────
// El schema de Gemini reduce mucho la deriva, pero no la elimina: puede faltar
// una clave, sobrar otra, o venir un número fuera de rango. Se normaliza acá,
// del lado nuestro, antes de tocar la base.

export function normalizarResultado(bruto: unknown, elementos: ElementoCriterio[]): ResultadoIA | null {
  if (!bruto || typeof bruto !== 'object') return null
  const r = bruto as Record<string, any>

  const clasificacion = (CLASIFICACIONES as readonly string[]).includes(r.clasificacion)
    ? r.clasificacion as Clasificacion
    : 'EVIDENCIA_INSUFICIENTE'

  const nivel = (v: unknown): NivelCalidad =>
    (NIVELES_CALIDAD as readonly string[]).includes(v as string) ? v as NivelCalidad : 'OK'

  // Una entrada por criterio, en el orden del criterio. Lo que el modelo no
  // devolvió queda NO_DETERMINABLE — el default seguro.
  const porClave = new Map<string, any>()
  if (Array.isArray(r.elementos)) {
    for (const e of r.elementos) {
      if (e && typeof e.clave === 'string') porClave.set(e.clave, e)
    }
  }

  const evaluados: ElementoEvaluado[] = elementos.map(c => {
    const e = porClave.get(c.clave)
    const valor = e && (VALORES as readonly string[]).includes(e.valor) ? e.valor as Valor : 'NO_DETERMINABLE'
    return {
      clave: c.clave,
      valor,
      comentario: typeof e?.comentario === 'string' ? e.comentario.slice(0, 200) : '',
    }
  })

  const confianza = typeof r.confianza === 'number' && Number.isFinite(r.confianza)
    ? Math.min(1, Math.max(0, r.confianza))
    : 0

  return {
    evaluable: r.evaluable === true,
    clasificacion,
    confianza: Number(confianza.toFixed(3)),
    motivos: Array.isArray(r.motivos)
      ? r.motivos.filter((m: unknown): m is string => typeof m === 'string').slice(0, 12)
      : [],
    elementos: evaluados,
    calidad: {
      nitidez: nivel(r.calidad?.nitidez),
      iluminacion: nivel(r.calidad?.iluminacion),
      encuadre: nivel(r.calidad?.encuadre),
    },
    resumen: typeof r.resumen === 'string' ? r.resumen.trim().slice(0, 240) : '',
  }
}

// ── Clasificación efectiva ──────────────────────────────────────────────────
// La opinión del modelo se guarda tal cual en clasificacion_ia. Esta función
// deriva la clasificación que usa el sistema, aplicando reglas nuestras.
// Cambiar un umbral acá NO exige volver a llamar al modelo.

export type Umbrales = {
  confianzaMinima?: number
  motivosQueObliganRevisar?: string[]
}

export function derivarClasificacion(
  resultado: ResultadoIA,
  elementos: ElementoCriterio[],
  umbrales: Umbrales = {},
): Clasificacion {
  const confianzaMinima = umbrales.confianzaMinima ?? 0.35

  // REGLA DURA: si la calidad no da, es evidencia insuficiente, sin importar qué
  // haya dicho el modelo. Es la traducción mecánica de "no puedo leerlo" ≠
  // "lo hizo mal", y no se delega al prompt.
  const calidadCritica =
    resultado.calidad.nitidez === 'CRITICA' ||
    resultado.calidad.iluminacion === 'CRITICA' ||
    resultado.calidad.encuadre === 'CRITICA'

  if (!resultado.evaluable || calidadCritica) return 'EVIDENCIA_INSUFICIENTE'
  if (resultado.clasificacion === 'EVIDENCIA_INSUFICIENTE') return 'EVIDENCIA_INSUFICIENTE'
  if (resultado.confianza < confianzaMinima) return 'EVIDENCIA_INSUFICIENTE'

  const requeridas = new Set(elementos.filter(e => e.requerido).map(e => e.clave))
  const faltaRequerido = resultado.elementos.some(e => requeridas.has(e.clave) && e.valor === 'AUSENTE')
  if (faltaRequerido) return 'REVISAR'

  const obligan = new Set(umbrales.motivosQueObliganRevisar ?? [])
  if (resultado.motivos.some(m => obligan.has(m))) return 'REVISAR'

  if (resultado.clasificacion === 'REVISAR') return 'REVISAR'
  return 'SIN_OBSERVACIONES'
}

/** Motivo principal a mostrar en la tarjeta de la bandeja. */
export function motivoPrincipal(resultado: ResultadoIA | null): string {
  if (!resultado) return ''
  if (resultado.motivos.length > 0) return resultado.motivos[0]
  const ausente = resultado.elementos.find(e => e.valor === 'AUSENTE')
  return ausente ? `AUSENTE: ${ausente.clave}` : ''
}

export const ETIQUETA_MOTIVO: Record<string, string> = {
  FOTO_OSCURA: 'Foto oscura',
  FOTO_BORROSA: 'Foto borrosa',
  FOTO_SOBREEXPUESTA: 'Foto sobreexpuesta',
  CAMARA_TAPADA: 'Cámara tapada',
  ENCUADRE_INSUFICIENTE: 'Encuadre insuficiente',
  SIN_PERSONA_EN_IMAGEN: 'Sin persona en la imagen',
  MULTIPLES_PERSONAS: 'Varias personas',
  ELEMENTO_REQUERIDO_AUSENTE: 'Falta un elemento requerido',
  ELEMENTO_NO_DETERMINABLE: 'Elemento no determinable',
  ILEGIBLE: 'Ilegible',
  NO_CORRESPONDE_AL_TIPO: 'No corresponde al tipo de evidencia',
  OTRO: 'Otro',
}
