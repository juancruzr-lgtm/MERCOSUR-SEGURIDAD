import { describe, it, expect } from 'vitest'
import { evaluarSalud, extraerMetricas, UMBRALES } from '@/lib/salud'
import { problemasDe, calcularTasas } from '../scripts/vigia/vigia.mjs'

const ok = { ok: true, status: 200, ms: 50 }
const baseSana = {
  conexiones: { total: 20, activas: 1, en_espera_lock: 0, trabadas_30s: 0, max: 60 },
  cache: { hit_pct: 99.48, bloques_disco: 34570, tam_base_mb: 504 },
  cron: { fallas_30m: 0, min_desde_ultima: 2.2, corriendo_mas_10m: 0, tareas: [] },
  fichajes: { turnos_ventana: 2, sin_fichaje: 0 },
  ingresos_app: { iniciados_30m: 0, confirmados_30m: 0 },
}
const evaluar = (datosBase: any, extra: any = {}) =>
  evaluarSalud({ base: ok, auth: ok, metricas: ok, datosBase, recursos: null, ...extra })

describe('evaluarSalud (/api/salud)', () => {
  it('base sana (valores reales del 19/11 02:24) → ok sin alertas', () => {
    const r = evaluar(baseSana)
    expect(r.estado).toBe('ok')
    expect(r.alertas).toEqual([])
  })

  it('base que no responde → caido (el vigía y UptimeRobot lo ven como 503)', () => {
    const r = evaluarSalud({ base: { ok: false, status: 0, ms: 4000, error: 'timeout' }, auth: ok, metricas: ok, datosBase: null, recursos: null })
    expect(r.estado).toBe('caido')
    expect(r.alertas[0]).toMatchObject({ clave: 'base', nivel: 'rojo' })
  })

  it('login caído → caido aunque la base ande', () => {
    expect(evaluarSalud({ base: ok, auth: { ok: false, status: 504, ms: 3000 }, metricas: ok, datosBase: baseSana, recursos: null }).estado).toBe('caido')
  })

  it('conexiones: 40/60 amarillo, 53/60 rojo', () => {
    expect(evaluar({ ...baseSana, conexiones: { ...baseSana.conexiones, total: 40 } }).alertas[0]).toMatchObject({ clave: 'conexiones', nivel: 'amarillo' })
    const r = evaluar({ ...baseSana, conexiones: { ...baseSana.conexiones, total: 53 } })
    expect(r.alertas[0]).toMatchObject({ clave: 'conexiones', nivel: 'rojo' })
    expect(r.estado).toBe('degradado')
  })

  it('cache hit bajo (lo que agotó el Disk IO en NANO) → rojo', () => {
    expect(evaluar({ ...baseSana, cache: { hit_pct: 93 } }).alertas[0]).toMatchObject({ clave: 'cache', nivel: 'rojo' })
    expect(evaluar({ ...baseSana, cache: { hit_pct: 97 } }).alertas[0]).toMatchObject({ clave: 'cache', nivel: 'amarillo' })
  })

  it('cron detenido más de 12 min → rojo; una falla → amarillo', () => {
    expect(evaluar({ ...baseSana, cron: { ...baseSana.cron, min_desde_ultima: 20 } }).alertas[0]).toMatchObject({ clave: 'cron_detenido', nivel: 'rojo' })
    expect(evaluar({ ...baseSana, cron: { ...baseSana.cron, fallas_30m: 1 } }).alertas[0]).toMatchObject({ clave: 'cron_fallas', nivel: 'amarillo' })
  })

  it('fichajes: rojo sólo si es masivo (≥3 y ≥ la mitad); un faltante aislado no alarma', () => {
    expect(evaluar({ ...baseSana, fichajes: { turnos_ventana: 15, sin_fichaje: 1 } }).alertas).toEqual([])
    expect(evaluar({ ...baseSana, fichajes: { turnos_ventana: 15, sin_fichaje: 2 } }).alertas[0]).toMatchObject({ clave: 'fichajes', nivel: 'amarillo' })
    expect(evaluar({ ...baseSana, fichajes: { turnos_ventana: 15, sin_fichaje: 4 } }).alertas[0]).toMatchObject({ clave: 'fichajes', nivel: 'amarillo' })
    expect(evaluar({ ...baseSana, fichajes: { turnos_ventana: 6, sin_fichaje: 3 } }).alertas[0]).toMatchObject({ clave: 'fichajes', nivel: 'rojo' })
  })

  it('ingresos en la app: ≥4 iniciados y 0 confirmados → rojo; pocos datos no alarman', () => {
    expect(evaluar({ ...baseSana, ingresos_app: { iniciados_30m: 3, confirmados_30m: 0 } }).alertas).toEqual([])
    expect(evaluar({ ...baseSana, ingresos_app: { iniciados_30m: 5, confirmados_30m: 0 } }).alertas[0]).toMatchObject({ clave: 'ingresos', nivel: 'rojo' })
  })

  it('base lenta (>2 s) → amarillo, sigue sin estar caída', () => {
    const r = evaluarSalud({ base: { ...ok, ms: 2500 }, auth: ok, metricas: ok, datosBase: baseSana, recursos: null })
    expect(r.estado).toBe('atencion')
    expect(r.alertas[0].clave).toBe('base_lenta')
  })
})

describe('extraerMetricas (Metrics API de Supabase)', () => {
  const texto = `# HELP node_memory_MemTotal_bytes x
node_memory_MemTotal_bytes{service_type="db"} 1073741824
node_memory_MemAvailable_bytes{service_type="db"} 214748364.8
node_cpu_seconds_total{cpu="0",mode="idle"} 900
node_cpu_seconds_total{cpu="0",mode="iowait"} 10
node_cpu_seconds_total{cpu="0",mode="user"} 90
node_disk_read_bytes_total{device="nvme1n1"} 5000000
node_disk_io_time_seconds_total{device="nvme1n1"} 100
node_filesystem_size_bytes{mountpoint="/data",fstype="ext4"} 2000000000
node_filesystem_avail_bytes{mountpoint="/data",fstype="ext4"} 1100000000
node_filesystem_size_bytes{mountpoint="/run",fstype="tmpfs"} 99999999999
node_filesystem_size_bytes{mountpoint="/",fstype="ext4"} 9000000000
node_filesystem_avail_bytes{mountpoint="/",fstype="ext4"} 2000000000
ebs_io_balance_percent{volume="data"} 12
`
  it('lee RAM, CPU, disco, ignora tmpfs y detecta series de saldo de IO', () => {
    const r = extraerMetricas(texto)
    expect(r.ram_total_mb).toBe(1024)
    expect(r.ram_usada_pct).toBe(80)
    expect(r.cpu_total_seg).toBe(1000)
    expect(r.cpu_ocioso_seg).toBe(910)
    // Usa /data (la base), no el disco del sistema "/" aunque sea más grande.
    expect(r.disco_usado_pct).toBe(45)
    expect(r.discos.map(d => d.mp).sort()).toEqual(['/', '/data'])
    expect(r.series_io).toContain('node_disk_read_bytes_total')
    expect(Object.values(r.io_saldo)).toEqual([12])
  })
  it('saldo de IO < 15 % → rojo en /api/salud', () => {
    const r = evaluarSalud({ base: ok, auth: ok, metricas: ok, datosBase: baseSana, recursos: extraerMetricas(texto) })
    expect(r.alertas.find(a => a.clave === 'disk_io')?.nivel).toBe('rojo')
    expect(r.estado).toBe('degradado')
  })
  it('texto vacío o raro no rompe', () => {
    const r = extraerMetricas('basura\n{}\n')
    expect(r.ram_usada_pct).toBeNull()
    expect(r.disco_usado_pct).toBeNull()
    expect(r.series).toBe(0)
  })
  it('umbrales documentados', () => {
    expect(UMBRALES.conexionesPct.rojo).toBe(87)
  })
})

describe('vigía (GitHub Actions)', () => {
  const app = { ok: true, status: 200, ms: 300 }
  const base = { app, auth: ok, ping: ok, salud: ok, saludJson: { estado: 'ok', alertas: [] }, tasas: null }

  it('todo bien → sin problemas', () => {
    expect(problemasDe(base)).toEqual([])
  })
  it('caída como la del 18/11 (login 504, base timeout, /api/salud 503) → login + base, sin duplicar api', () => {
    const p = problemasDe({ ...base, auth: { ok: false, status: 504, ms: 10000 }, ping: { ok: false, status: 0, ms: 10000, error: 'timeout' }, salud: { ok: false, status: 503, ms: 9000 } })
    expect(p.map((x: any) => x.clave).sort()).toEqual(['base', 'login'])
  })
  it('Supabase sano desde GitHub pero la app no llega a la base (503) → api', () => {
    expect(problemasDe({ ...base, salud: { ok: false, status: 503, ms: 4000 } }).map((x: any) => x.clave)).toEqual(['api'])
  })
  it('/api/salud 404 (todavía sin desplegar) no abre incidente', () => {
    expect(problemasDe({ ...base, salud: { ok: false, status: 404, ms: 100 } })).toEqual([])
  })
  it('/api/salud 500/504 con la app arriba → api', () => {
    expect(problemasDe({ ...base, salud: { ok: false, status: 504, ms: 15000 } }).map((x: any) => x.clave)).toEqual(['api'])
  })
  it('errores 500/502/504 de la app → app caída', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(problemasDe({ ...base, app: { ok: false, status, ms: 100 } })[0]).toMatchObject({ clave: 'app', nivel: 'rojo' })
    }
  })
  it('alertas de recursos de /api/salud pasan con su nivel', () => {
    const p = problemasDe({ ...base, saludJson: { estado: 'degradado', alertas: [{ clave: 'cache', nivel: 'rojo', texto: 'x', valor: 93 }] } })
    expect(p[0]).toMatchObject({ clave: 'rec_cache', nivel: 'rojo' })
  })
  it('tasas: CPU y disco ocupado entre dos muestras', () => {
    const prev = { ts: 0, cpu_total_seg: 1000, cpu_ocioso_seg: 900, disco_io_seg: 100, disco_leido_bytes: 0 }
    const rec = { cpu_total_seg: 1060, cpu_ocioso_seg: 906, disco_io_seg: 157, disco_leido_bytes: 60 * 1048576 * 10 }
    const t = calcularTasas(prev, rec, 60000)
    expect(t).toEqual({ cpuPct: 90, discoOcupadoPct: 95, lecturaMBs: 10 })
    const p = problemasDe({ ...base, tasas: t })
    expect(p.map((x: any) => `${x.clave}:${x.nivel}`).sort()).toEqual(['cpu:rojo', 'disco_io:rojo'])
  })
  it('tasas: sin muestra previa o muestras muy separadas → null', () => {
    expect(calcularTasas(null, {}, 1)).toBeNull()
    expect(calcularTasas({ ts: 0 }, {}, 2000 * 1000)).toBeNull()
  })
})
