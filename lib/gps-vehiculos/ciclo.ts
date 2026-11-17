/**
 * lib/gps-vehiculos/ciclo.ts — un ciclo de consulta (pensado para correr cada 10 min).
 *
 * Por cada tag activo:
 *   1. Límite de frecuencia: si ya hubo una consulta efectiva hace menos de
 *      (intervalo − 1) min, no se consulta (evita martillar el servicio si el
 *      disparador se duplica).
 *   2. Consulta al proveedor con reintentos acotados sólo ante errores transitorios.
 *   3. Registra SIEMPRE la consulta (éxito, sin novedad, sin datos o error) y
 *      sólo las posiciones reales recibidas; la base deduplica.
 * Los mensajes de error se sanitizan antes de guardarse.
 */
import { ErrorProveedor, sanitizarError, type ProveedorUbicacionTag } from './proveedor'
import { INTERVALO_CONSULTA_MIN } from './posiciones'
import type { ReporteProveedor, ResultadoConsulta, SmartTag } from './tipos'

export interface RegistroConsulta {
  tagId: string
  horaConsulta: Date
  resultado: 'ok' | 'error'
  posiciones: ReporteProveedor[]
  intentos: number
  duracionMs: number
  errorCodigo?: string | null
  errorDetalle?: string | null
}

export interface RepositorioConsultas {
  /** Hora de la última consulta efectiva (no omitida) del tag, o null. */
  ultimaConsulta(tagId: string): Promise<Date | null>
  registrar(r: RegistroConsulta): Promise<{ resultado: ResultadoConsulta; nuevas: number; recibidas: number }>
}

export interface ResultadoTag {
  tagId: string
  resultado: ResultadoConsulta | 'omitida_limite'
  nuevas: number
  intentos: number
  error?: string
}

export async function ejecutarCiclo(params: {
  tags: SmartTag[]
  proveedor: (tag: SmartTag) => ProveedorUbicacionTag | null
  repo: RepositorioConsultas
  ahora?: () => Date
  esperar?: (ms: number) => Promise<void>
  intervaloMin?: number
  maxIntentos?: number
  esperasMs?: number[]
}): Promise<ResultadoTag[]> {
  const ahora = params.ahora ?? (() => new Date())
  const esperar = params.esperar ?? (ms => new Promise(r => setTimeout(r, ms)))
  const intervaloMs = (params.intervaloMin ?? INTERVALO_CONSULTA_MIN) * 60_000
  const maxIntentos = Math.min(Math.max(params.maxIntentos ?? 3, 1), 5)
  const esperas = params.esperasMs ?? [2_000, 8_000, 20_000, 30_000]
  const out: ResultadoTag[] = []

  for (const tag of params.tags) {
    if (tag.estado !== 'activo') continue
    const ultima = await params.repo.ultimaConsulta(tag.id)
    const inicio = ahora()
    if (ultima && inicio.getTime() - ultima.getTime() < intervaloMs - 60_000) {
      out.push({ tagId: tag.id, resultado: 'omitida_limite', nuevas: 0, intentos: 0 })
      continue
    }

    const prov = params.proveedor(tag)
    let intentos = 0
    let reportes: ReporteProveedor[] | null = null
    let error: { codigo: string; detalle: string } | null = null
    if (!prov || prov.fuente !== tag.proveedor) {
      error = { codigo: 'proveedor_no_disponible', detalle: `Sin proveedor habilitado para ${tag.proveedor}` }
    } else {
      while (intentos < maxIntentos) {
        intentos++
        try {
          reportes = await prov.consultar(tag)
          error = null
          break
        } catch (e) {
          const transitorio = e instanceof ErrorProveedor ? e.transitorio : true
          error = { codigo: e instanceof ErrorProveedor ? e.codigo : 'error_desconocido', detalle: sanitizarError(e) }
          if (!transitorio || intentos >= maxIntentos) break
          await esperar(esperas[Math.min(intentos - 1, esperas.length - 1)])
        }
      }
    }

    const reg = await params.repo.registrar({
      tagId: tag.id,
      horaConsulta: inicio,
      resultado: error ? 'error' : 'ok',
      posiciones: reportes ?? [],
      intentos: Math.max(intentos, 1),
      duracionMs: Math.max(0, ahora().getTime() - inicio.getTime()),
      errorCodigo: error?.codigo ?? null,
      errorDetalle: error?.detalle ?? null,
    })
    out.push({ tagId: tag.id, resultado: reg.resultado, nuevas: reg.nuevas, intentos: Math.max(intentos, 1), error: error?.codigo })
  }
  return out
}
