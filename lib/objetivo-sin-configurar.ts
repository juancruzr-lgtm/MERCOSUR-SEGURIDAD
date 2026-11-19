/**
 * lib/objetivo-sin-configurar.ts
 *
 * Aviso por WhatsApp (plantilla `objetivo_nuevo_sin_configurar`, aprobada en
 * Meta el 19/11/2026) cuando se crea un objetivo al que le falta el protocolo
 * vigente o la ronda activa (o las dos cosas).
 *
 * Reglas:
 *  - Sólo objetivos CREADOS DESPUÉS de la activación (corte): los que ya
 *    existían sin configurar no generan un envío masivo.
 *  - Se espera un margen desde la creación (30 min) para dar tiempo a cargar.
 *  - Un solo aviso por objetivo y destinatario (clave de envío única).
 *  - Objetivos de prueba o inactivos no cuentan.
 */

export interface ObjetivoNuevo {
  id: string
  nombre: string
  cliente: string | null
  direccion?: string | null
  estado: string | null
  es_prueba: boolean | null
  created_at: string
  zona_id?: string | null
}

export interface Candidato {
  objetivoId: string
  nombre: string
  cliente: string
  zonaId: string | null
  /** "protocolo y ronda" · "protocolo" · "ronda" */
  falta: string
  minutosDesdeCreacion: number
}

export const ESPERA_MINUTOS_POR_DEFECTO = 30

export function textoFalta(sinProtocolo: boolean, sinRonda: boolean): string | null {
  if (sinProtocolo && sinRonda) return 'protocolo y ronda'
  if (sinProtocolo) return 'protocolo'
  if (sinRonda) return 'ronda'
  return null
}

export function objetivosSinConfigurar(p: {
  objetivos: ObjetivoNuevo[]
  conProtocolo: ReadonlySet<string>
  conRondas: ReadonlySet<string>
  /** Desde cuándo está activo el aviso (ISO). Sin corte = no se avisa nada. */
  corteIso: string | null
  ahoraIso: string
  esperaMinutos?: number
}): { candidatos: Candidato[]; descartes: Record<string, number> } {
  const descartes: Record<string, number> = {}
  const d = (k: string) => { descartes[k] = (descartes[k] ?? 0) + 1 }
  const candidatos: Candidato[] = []
  if (!p.corteIso) return { candidatos, descartes: { sin_corte_de_activacion: p.objetivos.length } }
  const corte = Date.parse(p.corteIso)
  const ahora = Date.parse(p.ahoraIso)
  const espera = (p.esperaMinutos ?? ESPERA_MINUTOS_POR_DEFECTO) * 60_000
  for (const o of p.objetivos) {
    if (o.es_prueba) { d('prueba'); continue }
    if (o.estado !== 'activo') { d('inactivo'); continue }
    const creado = Date.parse(o.created_at)
    if (!(creado >= corte)) { d('creado_antes_de_activar'); continue }
    if (ahora - creado < espera) { d('dentro_del_margen'); continue }
    const falta = textoFalta(!p.conProtocolo.has(o.id), !p.conRondas.has(o.id))
    if (!falta) { d('ya_configurado'); continue }
    candidatos.push({
      objetivoId: o.id,
      nombre: o.nombre.trim() || 'Objetivo sin nombre',
      cliente: (o.cliente ?? '').trim() || 'sin cliente',
      zonaId: o.zona_id ?? null,
      falta,
      minutosDesdeCreacion: Math.round((ahora - creado) / 60_000),
    })
  }
  return { candidatos, descartes }
}

/** Una variable de plantilla de Meta no admite saltos de línea ni tabs ni 4+ espacios. */
export function limpiarVariable(s: string, max = 60): string {
  const t = s.replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Variables en el orden de la plantilla: {{1}} nombre, {{2}} objetivo, {{3}} cliente, {{4}} lo que falta. */
export function variablesAviso(destinatarioNombre: string, c: Candidato): string[] {
  return [limpiarVariable(destinatarioNombre || 'equipo', 40), limpiarVariable(c.nombre), limpiarVariable(c.cliente), c.falta]
}

/** Texto aprobado en Meta (no cambiar sin volver a aprobar la plantilla). */
export const PLANTILLA_OBJETIVO_SIN_CONFIGURAR = {
  nombre: 'objetivo_nuevo_sin_configurar',
  cuerpo: [
    'Hola {{1}}. Se dio de alta el objetivo {{2}} (cliente {{3}}) y todavía le falta: {{4}}.',
    '',
    'Qué hay que hacer:',
    '1) Protocolo: el supervisor de la zona completa el formulario en la app y lo envía a aprobación.',
    '2) Ronda: al vigilador de turno le va a aparecer el pedido para marcar los dos extremos del puesto. La ronda queda activa apenas termina.',
    '',
    'Hasta que esté completo, el vigilador no tiene instrucciones ni rondas que cumplir en ese lugar.',
  ].join('\n'),
  /** Sufijo del botón dinámico `…/dashboard?page={{1}}`. */
  boton: 'configuracion_guiada',
} as const

export function vistaPrevia(variables: string[]): string {
  return PLANTILLA_OBJETIVO_SIN_CONFIGURAR.cuerpo.replace(/\{\{(\d)\}\}/g, (_, n) => variables[Number(n) - 1] ?? '')
}
