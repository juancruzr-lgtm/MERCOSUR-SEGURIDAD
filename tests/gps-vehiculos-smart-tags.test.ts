/**
 * Vehículos de supervisión con Smart Tag. TODOS los datos de estas pruebas son
 * SIMULADOS (proveedor 'simulado' o reportes armados a mano). Ninguna prueba
 * contacta a Google ni a un dispositivo real.
 */
import { readFileSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { ejecutarCiclo } from '@/lib/gps-vehiculos/ciclo'
import { armarFilasVehiculos } from '@/lib/gps-vehiculos/datos'
import { puedeGestionarVehiculosSupervision, puedeVerVehiculosSupervision } from '@/lib/gps-vehiculos/permisos'
import {
  claveDedup, clasificarAntiguedad, estadoActualizacion, filtrarReportes, motivoDescarte, resumirPrueba,
  supervisorDeVehiculoEn, tramosAproximados, vehiculoDeTagEn,
} from '@/lib/gps-vehiculos/posiciones'
import {
  ErrorProveedor, ProveedorFindHubNoHabilitado, ProveedorSimulado, proveedorConfigurado, sanitizarError,
  type ProveedorUbicacionTag,
} from '@/lib/gps-vehiculos/proveedor'
import { RepositorioMemoria } from '@/lib/gps-vehiculos/repositorio'
import type { AsignacionSupervisor, AsignacionTag, SmartTag, Vehiculo } from '@/lib/gps-vehiculos/tipos'

const T0 = new Date('2026-11-17T12:00:00.000Z')
const min = (n: number) => new Date(T0.getTime() + n * 60_000)
const iso = (n: number) => min(n).toISOString()

const tagSim: SmartTag = { id: 'tag-sim', nombre: 'HTAG prueba', modelo: 'HTAG (TagX)', proveedor: 'simulado', identificador_externo: null, estado: 'activo', es_prueba: true }
const tagReal: SmartTag = { ...tagSim, id: 'tag-real', proveedor: 'google_find_hub' }
const veh: Vehiculo = { id: 'veh-1', identificador: 'MOV-01', patente: 'AB123CD', descripcion: null, estado: 'activo' }

describe('registro de dispositivos y proveedores', () => {
  it('el proveedor Find Hub está deshabilitado y falla con error explícito no transitorio', async () => {
    const p = new ProveedorFindHubNoHabilitado()
    await expect(p.consultar()).rejects.toMatchObject({ codigo: 'integracion_no_habilitada', transitorio: false })
  })
  it('el simulador se niega a atender un tag real (no se mezclan datos ficticios con reales)', async () => {
    const sim = new ProveedorSimulado({ ahora: () => T0 })
    await expect(sim.consultar(tagReal)).rejects.toMatchObject({ codigo: 'proveedor_no_coincide' })
  })
  it('proveedorConfigurado sólo asigna proveedor a tags de su misma fuente', () => {
    const sim = proveedorConfigurado('simulado')!
    expect(sim(tagSim)?.fuente).toBe('simulado')
    expect(sim(tagReal)).toBeNull()
    const gfh = proveedorConfigurado('google_find_hub')!
    expect(gfh(tagReal)?.fuente).toBe('google_find_hub')
    expect(gfh(tagSim)).toBeNull()
    expect(proveedorConfigurado(undefined)).toBeNull()
    expect(proveedorConfigurado('otro')).toBeNull()
  })
})

describe('asignación de vehículos con historia', () => {
  const at: AsignacionTag[] = [{ id: 'a1', vehiculo_id: 'veh-1', tag_id: 'tag-sim', desde: iso(0), hasta: null }]
  const as: AsignacionSupervisor[] = [
    { id: 's1', vehiculo_id: 'veh-1', supervisor_id: 'sup-A', desde: iso(0), hasta: iso(60) },
    { id: 's2', vehiculo_id: 'veh-1', supervisor_id: 'sup-B', desde: iso(60), hasta: null },
  ]
  it('atribuye por HORA DE UBICACIÓN: el recorrido viejo queda con el supervisor anterior', () => {
    expect(supervisorDeVehiculoEn(as, 'veh-1', min(30))).toBe('sup-A')
    expect(supervisorDeVehiculoEn(as, 'veh-1', min(60))).toBe('sup-B')
    expect(supervisorDeVehiculoEn(as, 'veh-1', min(-5))).toBeNull()
    expect(vehiculoDeTagEn(at, 'tag-sim', min(-1))).toBeNull()
    expect(vehiculoDeTagEn(at, 'tag-sim', min(1))).toBe('veh-1')
  })
  it('una posición detectada antes del cambio y recibida después sigue atribuida al supervisor anterior', async () => {
    const repo = new RepositorioMemoria([tagSim], at, as)
    await repo.registrar({ tagId: 'tag-sim', horaConsulta: min(70), resultado: 'ok', intentos: 1, duracionMs: 5,
      posiciones: [{ lat: -34.6, lng: -58.4, horaUbicacion: iso(50) }] })
    expect(repo.posiciones[0].supervisor_id).toBe('sup-A')
    expect(repo.posiciones[0].vehiculo_id).toBe('veh-1')
  })
  it('un tag sin vehículo asignado guarda la posición sin atribuirla', async () => {
    const repo = new RepositorioMemoria([tagSim])
    await repo.registrar({ tagId: 'tag-sim', horaConsulta: min(5), resultado: 'ok', intentos: 1, duracionMs: 1,
      posiciones: [{ lat: -34.6, lng: -58.4, horaUbicacion: iso(1) }] })
    expect(repo.posiciones[0]).toMatchObject({ vehiculo_id: null, supervisor_id: null })
  })
  it('filas: estado de asignación y última posición del VEHÍCULO (no del tag reasignado)', () => {
    const filas = armarFilasVehiculos({
      vehiculos: [veh, { ...veh, id: 'veh-2', identificador: 'MOV-02', patente: 'AA000AA' }],
      tags: [tagSim], asignacionesTag: at, asignacionesSupervisor: [],
      ultimasPosiciones: [
        { id: 1, tag_id: 'tag-sim', fuente: 'simulado', lat: 1, lng: 1, precision_m: null, hora_ubicacion: iso(10), hora_consulta: iso(12), vehiculo_id: 'veh-1', supervisor_id: null },
        { id: 2, tag_id: 'tag-sim', fuente: 'simulado', lat: 2, lng: 2, precision_m: null, hora_ubicacion: iso(20), hora_consulta: iso(22), vehiculo_id: 'veh-9', supervisor_id: null },
      ],
      ultimasConsultas: [], ahora: min(25),
    })
    expect(filas[0]).toMatchObject({ estadoAsignacion: 'sin_supervisor', estado: 'sin_consultas' })
    expect(filas[0].ultimaPosicion?.id).toBe(1)
    expect(filas[1]).toMatchObject({ estadoAsignacion: 'sin_asignar', estado: 'sin_tag', ultimaPosicion: null })
  })
})

describe('permisos', () => {
  it('Gerencia y delegación gerencial ven y gestionan', () => {
    expect(puedeVerVehiculosSupervision({ puesto_organizacional: 'gerencia' })).toBe(true)
    expect(puedeGestionarVehiculosSupervision({ puesto_organizacional: 'gerencia' })).toBe(true)
    expect(puedeVerVehiculosSupervision({ puesto_organizacional: 'administracion', acceso_gerencia_delegado: true })).toBe(true)
  })
  it('supervisores, jefe, Administración, Dirección y overrides NO ven vehículos', () => {
    for (const puesto of ['vigilador', 'supervisor', 'jefe_supervisores', 'direccion_operativa', 'administracion']) {
      expect(puedeVerVehiculosSupervision({ puesto_organizacional: puesto })).toBe(false)
    }
    expect(puedeVerVehiculosSupervision({ puesto_organizacional: 'supervisor', acceso_admin_pleno: true, acceso_interfaz_admin: true })).toBe(false)
    expect(puedeVerVehiculosSupervision({ rol: 'admin' })).toBe(false)
    expect(puedeVerVehiculosSupervision(null)).toBe(false)
  })
  it('la migración no da escritura directa al navegador y la ingesta es sólo del servicio', () => {
    const sql = readFileSync('supabase/migrations/20261215100000_gps_vehiculos_smart_tags.sql', 'utf8')
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)/i)
    expect(sql).toMatch(/revoke all on function public\.gps_tag_registrar_consulta\([^)]*\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.gps_tag_registrar_consulta\([^)]*\) to service_role/)
    expect(sql).not.toMatch(/^\s*[a-z_]*(token|password|secret)[a-z_]*\s+(text|jsonb)/im)
  })
})

describe('persistencia y duplicados', () => {
  it('guarda sólo posiciones reales recibidas y descarta duplicados (misma hora y coordenadas)', async () => {
    const repo = new RepositorioMemoria([tagSim])
    const pos = [{ lat: -34.6, lng: -58.4, horaUbicacion: iso(0) }]
    const r1 = await repo.registrar({ tagId: 'tag-sim', horaConsulta: min(5), resultado: 'ok', posiciones: pos, intentos: 1, duracionMs: 1 })
    const r2 = await repo.registrar({ tagId: 'tag-sim', horaConsulta: min(15), resultado: 'ok', posiciones: pos, intentos: 1, duracionMs: 1 })
    expect(r1).toMatchObject({ resultado: 'nueva_posicion', nuevas: 1 })
    expect(r2).toMatchObject({ resultado: 'sin_novedad', nuevas: 0, recibidas: 1 })
    expect(repo.posiciones).toHaveLength(1)
    expect(repo.posiciones[0].hora_consulta).toBe(iso(5)) // primera vez que se recibió
    expect(repo.consultas.map(c => c.resultado)).toEqual(['nueva_posicion', 'sin_novedad'])
  })
  it('duplicados dentro del mismo lote cuentan una sola vez; misma hora con otras coordenadas sí es nueva', () => {
    const f = filtrarReportes('t', [
      { lat: 1, lng: 1, horaUbicacion: iso(0) }, { lat: 1, lng: 1, horaUbicacion: iso(0) }, { lat: 1, lng: 2, horaUbicacion: iso(0) },
    ], min(5), new Set())
    expect(f.nuevas).toHaveLength(2)
    expect(f.duplicadas).toBe(1)
    expect(claveDedup('t', '2026-11-17T12:00:00Z', 1, 1)).toBe(claveDedup('t', '2026-11-17T12:00:00.000Z', 1, 1))
  })
  it('no inventa: descarta coordenadas inválidas, (0,0), horas inválidas o futuras', () => {
    expect(motivoDescarte({ lat: 91, lng: 0, horaUbicacion: iso(0) }, T0)).toBe('coordenadas_invalidas')
    expect(motivoDescarte({ lat: NaN, lng: 0, horaUbicacion: iso(0) }, T0)).toBe('coordenadas_invalidas')
    expect(motivoDescarte({ lat: 0, lng: 0, horaUbicacion: iso(0) }, T0)).toBe('coordenadas_cero')
    expect(motivoDescarte({ lat: 1, lng: 1, horaUbicacion: 'ayer' }, T0)).toBe('hora_invalida')
    expect(motivoDescarte({ lat: 1, lng: 1, horaUbicacion: iso(6) }, T0)).toBe('hora_futura')
    expect(motivoDescarte({ lat: 1, lng: 1, horaUbicacion: iso(4) }, T0)).toBeNull()
  })
  it('respuesta vacía del servicio = sin_datos, sin posiciones', async () => {
    const repo = new RepositorioMemoria([tagSim])
    const r = await repo.registrar({ tagId: 'tag-sim', horaConsulta: T0, resultado: 'ok', posiciones: [], intentos: 1, duracionMs: 1 })
    expect(r.resultado).toBe('sin_datos')
    expect(repo.posiciones).toHaveLength(0)
  })
})

describe('posiciones antiguas', () => {
  it('clasifica por hora de UBICACIÓN, no por hora de consulta', () => {
    expect(clasificarAntiguedad(iso(-10), T0)).toBe('reciente')
    expect(clasificarAntiguedad(iso(-120), T0)).toBe('horas')
    expect(clasificarAntiguedad(iso(-7 * 60), T0)).toBe('antigua')
    expect(clasificarAntiguedad(iso(-25 * 60), T0)).toBe('muy_antigua')
    expect(clasificarAntiguedad(null, T0)).toBe('sin_posicion')
  })
  it('una consulta reciente que devuelve una ubicación vieja se muestra como sin ubicación reciente', () => {
    expect(estadoActualizacion({ tieneTag: true, ultimaConsulta: { hora_consulta: iso(-2), resultado: 'sin_novedad' }, ultimaHoraUbicacion: iso(-8 * 60), ahora: T0 }))
      .toBe('sin_ubicacion_reciente')
    expect(estadoActualizacion({ tieneTag: true, ultimaConsulta: { hora_consulta: iso(-2), resultado: 'nueva_posicion' }, ultimaHoraUbicacion: iso(-15), ahora: T0 }))
      .toBe('al_dia')
    expect(estadoActualizacion({ tieneTag: true, ultimaConsulta: { hora_consulta: iso(-40), resultado: 'nueva_posicion' }, ultimaHoraUbicacion: iso(-41), ahora: T0 }))
      .toBe('consulta_atrasada')
    expect(estadoActualizacion({ tieneTag: true, ultimaConsulta: { hora_consulta: iso(-1), resultado: 'error' }, ultimaHoraUbicacion: iso(-5), ahora: T0 }))
      .toBe('ultima_con_error')
  })
})

describe('fallos de consulta, reintentos y límite de frecuencia', () => {
  it('reintenta errores transitorios y registra la consulta exitosa con los intentos usados', async () => {
    const repo = new RepositorioMemoria([tagSim])
    const sim = new ProveedorSimulado({ ahora: () => T0, fallarEn: [1] })
    const esperar = vi.fn(async () => {})
    const r = await ejecutarCiclo({ tags: [tagSim], proveedor: () => sim, repo, ahora: () => T0, esperar })
    expect(r[0]).toMatchObject({ resultado: 'nueva_posicion', intentos: 2 })
    expect(esperar).toHaveBeenCalledTimes(1)
    expect(repo.consultas[0]).toMatchObject({ resultado: 'nueva_posicion', intentos: 2 })
  })
  it('no reintenta errores definitivos y registra el error sanitizado', async () => {
    const repo = new RepositorioMemoria([tagReal])
    const esperar = vi.fn(async () => {})
    const r = await ejecutarCiclo({ tags: [tagReal], proveedor: () => new ProveedorFindHubNoHabilitado(), repo, ahora: () => T0, esperar })
    expect(r[0]).toMatchObject({ resultado: 'error', intentos: 1, error: 'integracion_no_habilitada' })
    expect(esperar).not.toHaveBeenCalled()
    expect(repo.posiciones).toHaveLength(0)
    expect(repo.consultas[0]).toMatchObject({ resultado: 'error', error_codigo: 'integracion_no_habilitada' })
  })
  it('tope de reintentos ante fallas transitorias persistentes', async () => {
    const repo = new RepositorioMemoria([tagSim])
    const siempreFalla: ProveedorUbicacionTag = { fuente: 'simulado', consultar: async () => { throw new ErrorProveedor('timeout', 'tiempo agotado', true) } }
    const r = await ejecutarCiclo({ tags: [tagSim], proveedor: () => siempreFalla, repo, ahora: () => T0, esperar: async () => {}, maxIntentos: 3 })
    expect(r[0]).toMatchObject({ resultado: 'error', intentos: 3 })
  })
  it('límite de frecuencia: no consulta de nuevo antes de ~10 min', async () => {
    const repo = new RepositorioMemoria([tagSim])
    let ahora = T0
    const sim = new ProveedorSimulado({ ahora: () => ahora })
    await ejecutarCiclo({ tags: [tagSim], proveedor: () => sim, repo, ahora: () => ahora, esperar: async () => {} })
    ahora = min(5)
    const r = await ejecutarCiclo({ tags: [tagSim], proveedor: () => sim, repo, ahora: () => ahora, esperar: async () => {} })
    expect(r[0].resultado).toBe('omitida_limite')
    ahora = min(10)
    const r2 = await ejecutarCiclo({ tags: [tagSim], proveedor: () => sim, repo, ahora: () => ahora, esperar: async () => {} })
    expect(r2[0].resultado).not.toBe('omitida_limite')
    expect(repo.consultas).toHaveLength(2)
  })
  it('tags inactivos no se consultan; sin proveedor se registra error', async () => {
    const repo = new RepositorioMemoria([tagSim, { ...tagSim, id: 'x', estado: 'inactivo' }])
    const r = await ejecutarCiclo({ tags: repo.tags, proveedor: () => null, repo, ahora: () => T0, esperar: async () => {} })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ resultado: 'error', error: 'proveedor_no_disponible' })
  })
  it('sanitiza tokens, bearer y emails en los errores', () => {
    const s = sanitizarError('fallo Bearer abc.def aas_et/AKppINaBCDEFGHIJKLMNOPQRSTUVWX token=xyz123 de ana@empresa.com')
    expect(s).not.toMatch(/abc\.def|AKppINa|xyz123|ana@empresa/)
  })
})

describe('historial', () => {
  it('une detecciones con tramos APROXIMADOS y corta los huecos largos', () => {
    const t = tramosAproximados([
      { lat: 1, lng: 1, hora_ubicacion: iso(0) }, { lat: 2, lng: 2, hora_ubicacion: iso(30) },
      { lat: 3, lng: 3, hora_ubicacion: iso(300) }, { lat: 4, lng: 4, hora_ubicacion: iso(320) },
      { lat: 5, lng: 5, hora_ubicacion: iso(900) },
    ])
    expect(t).toHaveLength(2)
    expect(t.every(x => x.aproximado === true)).toBe(true)
    expect(t.map(x => x.puntos.length)).toEqual([2, 2])
  })
  it('el módulo no expone cálculo de kilómetros', async () => {
    const mod = await import('@/lib/gps-vehiculos/posiciones')
    expect(Object.keys(mod).some(k => /km|kilometr|distancia/i.test(k))).toBe(false)
  })
})

describe('separación de fuentes GPS', () => {
  it('las lecturas del módulo nunca tocan supervisor_route_points ni el GPS de teléfonos', () => {
    for (const f of ['lib/gps-vehiculos/datos.ts', 'lib/gps-vehiculos/repositorio.ts', 'components/gps/VehiculosSupervision.tsx', 'components/gps/MapaSmartTags.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/from\(['"]supervisor_route_points['"]\)/)
      expect(src).not.toMatch(/useSupervisorGps/)
    }
  })
  it('cada posición guarda su fuente: simulado nunca queda como google_find_hub', async () => {
    const repo = new RepositorioMemoria([tagSim])
    const sim = new ProveedorSimulado({ ahora: () => T0 })
    await ejecutarCiclo({ tags: [tagSim], proveedor: () => sim, repo, ahora: () => T0, esperar: async () => {} })
    expect(repo.posiciones.length).toBeGreaterThan(0)
    expect(repo.posiciones.every(p => p.fuente === 'simulado')).toBe(true)
  })
})

describe('prueba controlada de 24 h', () => {
  const desde = T0, hasta = new Date(T0.getTime() + 24 * 3600_000)

  async function correr(horas: number, fuente: 'simulado' = 'simulado') {
    const tag = { ...tagSim, proveedor: fuente }
    const repo = new RepositorioMemoria([tag])
    let ahora = T0
    const sim = new ProveedorSimulado({ ahora: () => ahora, cadaN: 3 })
    for (let i = 0; i < horas * 6; i++) {
      ahora = min(i * 10)
      await ejecutarCiclo({ tags: [tag], proveedor: () => sim, repo, ahora: () => ahora, esperar: async () => {} })
    }
    return resumirPrueba({ consultas: repo.consultas, posiciones: repo.posiciones, desde, hasta })
  }

  it('sin consultas: la prueba NO se realizó', () => {
    expect(resumirPrueba({ consultas: [], posiciones: [], desde, hasta }).estado).toBe('sin_consultas')
  })
  it('12 h de consultas: incompleta', async () => {
    expect((await correr(12)).estado).toBe('incompleta')
  })
  it('24 h simuladas: completa pero marcada como SIMULADA, con métricas', async () => {
    const r = await correr(24)
    expect(r.estado).toBe('completa_simulada')
    expect(r.incluyeSimuladas).toBe(true)
    expect(r.consultas).toBe(144)
    expect(r.consultasEsperadas).toBe(144)
    expect(r.conNuevaPosicion + r.sinNuevaPosicion + r.errores).toBe(144)
    expect(r.posicionesNuevas).toBe(r.conNuevaPosicion)
    expect(r.pctSinNuevaPosicion).toBeGreaterThan(50)
    expect(r.minutosEntreDetecciones.mediana).toBe(30)
    expect(r.antiguedadAlRecibirMin.maximo).toBeLessThanOrEqual(30)
    expect(r.horasConDeteccion).toBe(24)
    expect(r.historialUtil).toBe(true)
  })
  it('sólo podría figurar como completa_real si NO hay datos simulados', () => {
    const consultas = Array.from({ length: 144 }, (_, i) => ({ hora_consulta: iso(i * 10), resultado: 'sin_novedad' as const, posiciones_nuevas: 0, proveedor: 'google_find_hub' as const }))
    expect(resumirPrueba({ consultas, posiciones: [], desde, hasta }).estado).toBe('completa_real')
    consultas[5] = { ...consultas[5], proveedor: 'simulado' as any }
    expect(resumirPrueba({ consultas, posiciones: [], desde, hasta }).estado).toBe('completa_simulada')
  })
})
