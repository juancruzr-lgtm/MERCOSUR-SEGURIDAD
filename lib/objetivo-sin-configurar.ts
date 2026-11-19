/**
 * lib/objetivo-sin-configurar.ts
 *
 * Aviso por WhatsApp a los jefes operativos cuando se crea un objetivo que
 * NO tiene protocolo vigente NI rondas activas.
 *
 * Reglas:
 *  - Sólo objetivos CREADOS DESPUÉS de la activación (corte): los que ya
 *    existían sin configurar no generan un envío masivo; se ven en el tablero.
 *  - Se espera un margen desde la creación (por defecto 30 min) para dar
 *    tiempo a cargarlos antes de avisar.
 *  - Un solo aviso por objetivo y destinatario (clave de envío única).
 *  - Si el objetivo ya tiene protocolo O rondas al momento de evaluar, no se
 *    avisa (la orden pide avisar cuando falta todo).
 *  - Objetivos de prueba o inactivos no cuentan.
 *
 * WhatsApp exige una plantilla aprobada por Meta para mensajes que inicia la
 * empresa: el texto fijo va en la plantilla y sólo cambian las variables.
 */

export interface ObjetivoNuevo {
  id: string
  nombre: string
  cliente: string | null
  direccion: string | null
  estado: string | null
  es_prueba: boolean | null
  created_at: string
}

export interface Candidato {
  objetivoId: string
  nombre: string
  cliente: string
  direccion: string
  minutosDesdeCreacion: number
}

export const ESPERA_MINUTOS_POR_DEFECTO = 30

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
    if (p.conProtocolo.has(o.id) || p.conRondas.has(o.id)) { d('ya_configurado'); continue }
    candidatos.push({
      objetivoId: o.id,
      nombre: o.nombre.trim() || 'Objetivo sin nombre',
      cliente: (o.cliente ?? '').trim() || 'sin cliente',
      direccion: (o.direccion ?? '').trim() || 'sin dirección cargada',
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

/** Variables en el orden de la plantilla: {{1}} nombre, {{2}} objetivo, {{3}} cliente, {{4}} dirección. */
export function variablesAviso(destinatarioNombre: string, c: Candidato): string[] {
  return [limpiarVariable(destinatarioNombre || 'equipo', 40), limpiarVariable(c.nombre), limpiarVariable(c.cliente), limpiarVariable(c.direccion, 80)]
}

/**
 * Texto de la plantilla para presentar a Meta (categoría UTILIDAD, idioma
 * es_AR). Lo fijo no se puede cambiar sin volver a aprobarla.
 */
export const PLANTILLA_OBJETIVO_SIN_CONFIGURAR = {
  nombre: 'objetivo_nuevo_sin_configurar',
  categoria: 'UTILITY',
  idioma: 'es_AR',
  cuerpo: [
    'Hola {{1}}. Se dio de alta el objetivo *{{2}}* (cliente {{3}}, {{4}}) y todavía no tiene protocolo ni rondas cargados.',
    '',
    'Para dejarlo listo, entrá a la app Mercosur Seguridad:',
    '1) Protocolos: elegí el objetivo, cargá las instrucciones del puesto y guardalas.',
    '2) Rondas: creá la ronda del objetivo, con su horario y cada cuántos minutos se hace.',
    '3) Puntos de control: agregá los puntos de la ronda (GPS o QR) recorriendo el lugar.',
    '4) Revisá que la frecuencia de supervisión del objetivo sea la correcta.',
    '',
    'Hasta que esté cargado, los vigiladores no tienen instrucciones ni rondas que cumplir en ese lugar.',
  ].join('\n'),
  pie: 'Aviso automático de Mercosur Seguridad',
  boton: { tipo: 'URL', texto: 'Abrir el objetivo', url: 'https://mercosur-seguridad.vercel.app/dashboard?page={{1}}' },
} as const

/** Vista previa del mensaje tal como lo recibiría una persona. */
export function vistaPrevia(variables: string[]): string {
  return PLANTILLA_OBJETIVO_SIN_CONFIGURAR.cuerpo.replace(/\{\{(\d)\}\}/g, (_, n) => variables[Number(n) - 1] ?? '')
}
