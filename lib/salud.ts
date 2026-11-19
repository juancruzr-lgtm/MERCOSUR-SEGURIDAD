/**
 * lib/salud.ts — reglas del chequeo de salud (/api/salud) para el vigía externo.
 *
 * Funciones puras (sin red ni base) para poder probarlas. Los umbrales salen
 * de la caída del 18/11/2026 y de la línea de base medida después:
 *   - MICRO: 60 conexiones máx., cache hit 99,4 %, base 504 MB, RAM ~70 %.
 *   - Turnos sin fichaje 30 min después de empezar: 0 por hora (11–18/11).
 *   - El cron más frecuente corre cada 5 min.
 * CPU y caudal de disco son contadores: el vigía calcula la tasa entre dos
 * muestras; acá sólo se devuelven los valores crudos.
 */

export type Nivel = 'amarillo' | 'rojo'
export type Estado = 'ok' | 'atencion' | 'degradado' | 'caido'

export interface Medicion {
  ok: boolean
  status: number
  ms: number
  error?: string
}

export interface Alerta {
  clave: string
  nivel: Nivel
  texto: string
  valor?: number | string | null
}

export interface Recursos {
  ram_total_mb: number | null
  ram_usada_pct: number | null
  cpu_total_seg: number | null
  cpu_ocioso_seg: number | null
  disco_leido_bytes: number | null
  disco_escrito_bytes: number | null
  disco_io_seg: number | null
  disco_usado_pct: number | null
  /** Series que parecen saldo de IO/créditos (la Metrics API está en beta). */
  io_saldo: Record<string, number>
  series: number
}

export const UMBRALES = {
  latenciaMs: 2000,
  conexionesPct: { amarillo: 67, rojo: 87 },
  trabadas: { amarillo: 1, rojo: 3 },
  esperaLock: { amarillo: 5 },
  cacheHit: { amarillo: 98, rojo: 95 },
  cronFallas30m: { amarillo: 1, rojo: 3 },
  cronDetenidoMin: 12,
  sinFichaje: { amarillo: 2, rojo: 3 },
  ingresosMinimos: 4,
  ramPct: { amarillo: 85, rojo: 95 },
  discoPct: { amarillo: 70, rojo: 85 },
  ioSaldoPct: { amarillo: 40, rojo: 15 },
} as const

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** Lee el formato de texto de Prometheus y se queda con lo que importa. */
export function extraerMetricas(texto: string): Recursos {
  const suma: Record<string, number> = {}
  let ramTotal: number | null = null
  let ramDisp: number | null = null
  let cpuTotal = 0, cpuOcioso = 0, hayCpu = false
  const fs: Record<string, { size?: number; avail?: number }> = {}
  const ioSaldo: Record<string, number> = {}
  const nombres = new Set<string>()

  for (const linea of texto.split('\n')) {
    if (!linea || linea.startsWith('#')) continue
    const m = linea.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/)
    if (!m) continue
    const [, nombre, etiquetas = '', crudo] = m
    const valor = Number(crudo)
    if (!Number.isFinite(valor)) continue
    nombres.add(nombre)

    if (nombre === 'node_memory_MemTotal_bytes') ramTotal = valor
    else if (nombre === 'node_memory_MemAvailable_bytes') ramDisp = valor
    else if (nombre === 'node_cpu_seconds_total') {
      hayCpu = true
      cpuTotal += valor
      if (/mode="(idle|iowait)"/.test(etiquetas)) cpuOcioso += valor
    } else if (nombre === 'node_disk_read_bytes_total' || nombre === 'node_disk_written_bytes_total'
      || nombre === 'node_disk_io_time_seconds_total') {
      suma[nombre] = (suma[nombre] ?? 0) + valor
    } else if (nombre === 'node_filesystem_size_bytes' || nombre === 'node_filesystem_avail_bytes') {
      const mp = etiquetas.match(/mountpoint="([^"]*)"/)?.[1] ?? '?'
      if (/tmpfs|overlay|devtmpfs/.test(etiquetas)) continue
      fs[mp] = fs[mp] ?? {}
      if (nombre === 'node_filesystem_size_bytes') fs[mp].size = valor
      else fs[mp].avail = valor
    }
    if (/balance|budget|burst|credit/i.test(nombre)) {
      ioSaldo[`${nombre}${etiquetas}`.slice(0, 120)] = valor
    }
  }

  // Disco: el sistema de archivos más grande con datos completos (el de la base).
  let discoPct: number | null = null
  let mayor = 0
  for (const v of Object.values(fs)) {
    if (v.size && v.avail != null && v.size > mayor) {
      mayor = v.size
      discoPct = Math.round((1 - v.avail / v.size) * 1000) / 10
    }
  }

  return {
    ram_total_mb: ramTotal != null ? Math.round(ramTotal / 1048576) : null,
    ram_usada_pct: ramTotal && ramDisp != null ? Math.round((1 - ramDisp / ramTotal) * 1000) / 10 : null,
    cpu_total_seg: hayCpu ? cpuTotal : null,
    cpu_ocioso_seg: hayCpu ? cpuOcioso : null,
    disco_leido_bytes: suma.node_disk_read_bytes_total ?? null,
    disco_escrito_bytes: suma.node_disk_written_bytes_total ?? null,
    disco_io_seg: suma.node_disk_io_time_seconds_total ?? null,
    disco_usado_pct: discoPct,
    io_saldo: ioSaldo,
    series: nombres.size,
  }
}

export interface EntradaSalud {
  base: Medicion
  auth: Medicion
  metricas: Medicion
  datosBase: any
  recursos: Recursos | null
}

export function evaluarSalud(e: EntradaSalud) {
  const U = UMBRALES
  const alertas: Alerta[] = []
  const add = (clave: string, nivel: Nivel, texto: string, valor?: number | string | null) =>
    alertas.push({ clave, nivel, texto, valor })

  if (!e.base.ok) add('base', 'rojo', 'La base de datos no responde', e.base.error ?? e.base.status)
  else if (e.base.ms > U.latenciaMs) add('base_lenta', 'amarillo', 'La base responde lento', e.base.ms)
  if (!e.auth.ok) add('auth', 'rojo', 'El servicio de login no responde', e.auth.error ?? e.auth.status)
  else if (e.auth.ms > U.latenciaMs) add('auth_lento', 'amarillo', 'El login responde lento', e.auth.ms)

  const d = e.datosBase ?? {}
  const con = d.conexiones ?? {}
  const total = num(con.total), max = num(con.max)
  if (total != null && max) {
    const pct = Math.round((total / max) * 100)
    if (pct >= U.conexionesPct.rojo) add('conexiones', 'rojo', 'Conexiones casi agotadas', `${total}/${max}`)
    else if (pct >= U.conexionesPct.amarillo) add('conexiones', 'amarillo', 'Muchas conexiones abiertas', `${total}/${max}`)
  }
  const trab = num(con.trabadas_30s)
  if (trab != null && trab >= U.trabadas.rojo) add('consultas_trabadas', 'rojo', 'Varias consultas trabadas más de 30 s', trab)
  else if (trab != null && trab >= U.trabadas.amarillo) add('consultas_trabadas', 'amarillo', 'Consulta trabada más de 30 s', trab)
  const lock = num(con.en_espera_lock)
  if (lock != null && lock >= U.esperaLock.amarillo) add('bloqueos', 'amarillo', 'Consultas esperando bloqueos', lock)

  const hit = num(d.cache?.hit_pct)
  if (hit != null && hit < U.cacheHit.rojo) add('cache', 'rojo', 'La base lee mucho del disco (riesgo de agotar Disk IO)', hit)
  else if (hit != null && hit < U.cacheHit.amarillo) add('cache', 'amarillo', 'Baja la lectura desde memoria', hit)

  const cron = d.cron ?? {}
  const fallas = num(cron.fallas_30m)
  if (fallas != null && fallas >= U.cronFallas30m.rojo) add('cron_fallas', 'rojo', 'Tareas automáticas fallando', fallas)
  else if (fallas != null && fallas >= U.cronFallas30m.amarillo) add('cron_fallas', 'amarillo', 'Falló una tarea automática', fallas)
  const sinCorrer = num(cron.min_desde_ultima)
  if (sinCorrer != null && sinCorrer > U.cronDetenidoMin) add('cron_detenido', 'rojo', 'Las tareas automáticas no están corriendo', `${sinCorrer} min`)
  const colgadas = num(cron.corriendo_mas_10m)
  if (colgadas != null && colgadas > 0) add('cron_colgado', 'amarillo', 'Tarea automática corriendo hace más de 10 min', colgadas)

  const fich = d.fichajes ?? {}
  const sin = num(fich.sin_fichaje), ventana = num(fich.turnos_ventana)
  if (sin != null && ventana != null && sin >= U.sinFichaje.rojo && sin * 2 >= ventana) {
    add('fichajes', 'rojo', 'Muchos turnos empezados sin fichaje (posible falla de fichaje)', `${sin}/${ventana}`)
  } else if (sin != null && sin >= U.sinFichaje.amarillo) {
    add('fichajes', 'amarillo', 'Turnos empezados sin fichaje', `${sin}/${ventana}`)
  }

  const ing = d.ingresos_app ?? {}
  const ini = num(ing.iniciados_30m), conf = num(ing.confirmados_30m)
  if (ini != null && conf != null && ini >= U.ingresosMinimos) {
    if (conf === 0) add('ingresos', 'rojo', 'Ningún ingreso confirmado en la app (30 min)', `${conf}/${ini}`)
    else if (conf / ini < 0.5) add('ingresos', 'amarillo', 'Muchos ingresos sin confirmar en la app', `${conf}/${ini}`)
  }

  const r = e.recursos
  if (r) {
    if (r.ram_usada_pct != null && r.ram_usada_pct >= U.ramPct.rojo) add('ram', 'rojo', 'Memoria casi agotada', r.ram_usada_pct)
    else if (r.ram_usada_pct != null && r.ram_usada_pct >= U.ramPct.amarillo) add('ram', 'amarillo', 'Memoria alta', r.ram_usada_pct)
    if (r.disco_usado_pct != null && r.disco_usado_pct >= U.discoPct.rojo) add('disco', 'rojo', 'Disco casi lleno', r.disco_usado_pct)
    else if (r.disco_usado_pct != null && r.disco_usado_pct >= U.discoPct.amarillo) add('disco', 'amarillo', 'Disco con poco espacio', r.disco_usado_pct)
    for (const [serie, valor] of Object.entries(r.io_saldo)) {
      // Sólo si la serie parece un porcentaje (0–100).
      if (valor < 0 || valor > 100) continue
      if (valor < U.ioSaldoPct.rojo) add('disk_io', 'rojo', 'Presupuesto de disco (Disk IO) casi agotado', `${valor} (${serie})`)
      else if (valor < U.ioSaldoPct.amarillo) add('disk_io', 'amarillo', 'Presupuesto de disco (Disk IO) bajando', `${valor} (${serie})`)
    }
  }

  const caido = !e.base.ok || !e.auth.ok
  const estado: Estado = caido ? 'caido'
    : alertas.some(a => a.nivel === 'rojo') ? 'degradado'
    : alertas.length > 0 ? 'atencion'
    : 'ok'

  return {
    estado,
    chequeos: { base: e.base, auth: e.auth, metricas: e.metricas },
    alertas,
    base: e.datosBase ? {
      conexiones: d.conexiones, cache: d.cache, fichajes: d.fichajes, ingresos_app: d.ingresos_app,
      cron: { fallas_30m: cron.fallas_30m, min_desde_ultima: cron.min_desde_ultima, corriendo_mas_10m: cron.corriendo_mas_10m, tareas: cron.tareas },
    } : null,
    recursos: r,
  }
}
