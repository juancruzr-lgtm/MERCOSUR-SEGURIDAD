/**
 * lib/gps-vehiculos/proveedor.ts — de dónde salen las posiciones de un Smart Tag.
 *
 * Google NO ofrece una API pública de Find Hub para consultar ubicaciones
 * (verificado nov-2026, ver docs/gps-vehiculos-smart-tags.md). Por eso:
 *   · `ProveedorFindHubNoHabilitado` falla SIEMPRE con un error explícito.
 *     No hay implementación de Google en este repositorio: la integración no
 *     oficial (GoogleFindMyTools / tag-tracker) quedó detenida por riesgo de
 *     seguridad sobre la cuenta de Google de la empresa.
 *   · `ProveedorSimulado` existe sólo para probar el módulo. Todo lo que genera
 *     se guarda con fuente = 'simulado' y la UI lo marca como SIMULADO.
 */
import type { FuenteSmartTag, ReporteProveedor, SmartTag } from './tipos'

export class ErrorProveedor extends Error {
  constructor(public codigo: string, mensaje: string, public transitorio: boolean) {
    super(mensaje)
    this.name = 'ErrorProveedor'
  }
}

export interface ProveedorUbicacionTag {
  readonly fuente: FuenteSmartTag
  /** Devuelve los reportes que el servicio tenga. Puede devolver [] (sin datos). */
  consultar(tag: SmartTag): Promise<ReporteProveedor[]>
}

export class ProveedorFindHubNoHabilitado implements ProveedorUbicacionTag {
  readonly fuente = 'google_find_hub' as const
  async consultar(): Promise<ReporteProveedor[]> {
    throw new ErrorProveedor(
      'integracion_no_habilitada',
      'No hay API oficial de Google Find Hub; la integración no oficial está detenida por seguridad.',
      false,
    )
  }
}

/**
 * Simulador determinista: imita una red de detección esporádica. Sólo en
 * algunas consultas aparece una detección nueva, y su hora de ubicación es
 * ANTERIOR a la consulta (como pasa con Find Hub). Datos 100 % ficticios.
 */
export class ProveedorSimulado implements ProveedorUbicacionTag {
  readonly fuente = 'simulado' as const
  private llamada = 0
  constructor(private opts: {
    ahora: () => Date
    base?: { lat: number; lng: number }
    /** Cada cuántas consultas aparece una detección nueva (por defecto 3). */
    cadaN?: number
    /** Errores transitorios forzados en estas llamadas (1-based), para probar reintentos. */
    fallarEn?: number[]
  }) {}

  async consultar(tag: SmartTag): Promise<ReporteProveedor[]> {
    if (tag.proveedor !== 'simulado') {
      throw new ErrorProveedor('proveedor_no_coincide', 'El simulador sólo atiende tags marcados como simulados.', false)
    }
    this.llamada++
    if (this.opts.fallarEn?.includes(this.llamada)) {
      throw new ErrorProveedor('red_simulada', 'Fallo de red simulado', true)
    }
    const ahora = this.opts.ahora()
    const cadaN = this.opts.cadaN ?? 3
    // Ventana de detección: se "detecta" una vez cada cadaN consultas; la hora
    // queda redondeada a esa ventana, así consultas siguientes devuelven la misma
    // detección (como Find Hub) y la deduplicación la descarta.
    const ventanaMs = cadaN * 10 * 60_000
    const t = Math.floor(ahora.getTime() / ventanaMs) * ventanaMs - 7 * 60_000
    const k = Math.floor(t / ventanaMs)
    const base = this.opts.base ?? { lat: -34.6037, lng: -58.3816 }
    return [{
      lat: Math.round((base.lat + ((k % 7) - 3) * 0.004) * 1e6) / 1e6,
      lng: Math.round((base.lng + ((k % 5) - 2) * 0.005) * 1e6) / 1e6,
      horaUbicacion: new Date(t).toISOString(),
      precisionM: 30,
    }]
  }
}

/** Quita de un mensaje de error todo lo que pueda ser credencial o dato personal. */
export function sanitizarError(texto: unknown): string {
  let s = String(texto instanceof Error ? texto.message : texto ?? '')
  s = s.replace(/bearer\s+\S+/gi, 'Bearer [oculto]')
  s = s.replace(/(token|secret|password|clave|oauth|aas_et)[^\s,;]*\s*[:=]\s*\S+/gi, '$1=[oculto]')
  s = s.replace(/[A-Za-z0-9_\-./+=]{24,}/g, '[oculto]')
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
  return s.slice(0, 300)
}

/**
 * Proveedor según GPS_SMART_TAGS_PROVEEDOR. Cada proveedor sólo atiende tags de
 * su misma fuente: un tag real nunca recibe datos simulados.
 */
export function proveedorConfigurado(nombre: string | undefined): ((tag: SmartTag) => ProveedorUbicacionTag | null) | null {
  if (nombre === 'simulado') {
    const sim = new ProveedorSimulado({ ahora: () => new Date() })
    return tag => (tag.proveedor === 'simulado' ? sim : null)
  }
  if (nombre === 'google_find_hub') {
    const p = new ProveedorFindHubNoHabilitado()
    return tag => (tag.proveedor === 'google_find_hub' ? p : null)
  }
  return null
}
