import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  analizarLocal,
  analizarRemoto,
  leerHistorialDesdeDb,
  main,
  parsearArchivo,
  parsearHistorialRemoto,
} from '@/scripts/migraciones-guard.mjs'

// Mapa mínimo: dos archivos legados (uno sin hora) y el piso.
const mapa = {
  piso_version: '20261204120000',
  archivos: [
    { archivo: '20260725_rondas_nativas_base.sql', version: '20260725', estado: 'APLICADA_A_MANO_SIN_REGISTRO' },
    { archivo: '20260725230000_rondas_correctivo.sql', version: '20260725230000', estado: 'REGISTRADA_OTRA_VERSION' },
    { archivo: '20260802100000_ronda_control_gps.sql', version: '20260802100000', estado: 'FALTA_REALMENTE' },
    { archivo: '20261204120000_facturacion_seguro_periodo.sql', version: '20261204120000', estado: 'APLICADA_A_MANO_SIN_REGISTRO' },
  ],
}
const legados = mapa.archivos.map(a => a.archivo)
const reglas = (xs: { regla: string }[]) => xs.map(x => x.regla)

describe('parsearArchivo', () => {
  it('acepta el formato canónico AAAAMMDDHHMMSS_nombre.sql', () => {
    expect(parsearArchivo('20261205130000_ronda_control_gps.sql')).toMatchObject({ version: '20261205130000', formato: 'OK', esRollback: false })
  })
  it('detecta versión sin hora, hora fuera de rango, fecha imposible y mayúsculas', () => {
    expect(parsearArchivo('20260725_x.sql').formato).toBe('SIN_HORA')
    expect(parsearArchivo('20260810240000_x.sql').formato).toBe('FECHA_HORA_INVALIDA')
    expect(parsearArchivo('20260231120000_x.sql').formato).toBe('FECHA_HORA_INVALIDA')
    expect(parsearArchivo('2026120512_x.sql').formato).toBe('LARGO_INVALIDO')
    expect(parsearArchivo('20261205120000_Mal-Nombre.sql').formato).toBe('NOMBRE_INVALIDO')
    expect(parsearArchivo('sin_version.sql').formato).toBe('SIN_VERSION')
    expect(parsearArchivo('20261205120000_x_rollback.sql').esRollback).toBe(true)
  })
})

describe('analizarLocal', () => {
  it('la historia legada sólo avisa; una migración nueva posterior al piso pasa', () => {
    const r = analizarLocal([...legados, '20261205130000_ronda_control_gps.sql'], mapa)
    expect(r.errores).toEqual([])
    expect(reglas(r.avisos)).toContain('formato') // 20260725_ legado
    expect(r.nuevos).toEqual(['20261205130000_ronda_control_gps.sql'])
    expect(r.piso).toBe('20261204120000')
  })
  it('rechaza una migración nueva sin hora', () => {
    const r = analizarLocal([...legados, '20261206_nueva.sql'], mapa)
    expect(reglas(r.errores)).toContain('formato')
  })
  it('rechaza una migración nueva con número menor o igual al último del mapa', () => {
    const r = analizarLocal([...legados, '20261101120000_tardia.sql'], mapa)
    expect(r.errores).toHaveLength(1)
    expect(r.errores[0]).toMatchObject({ regla: 'version_vieja', archivo: '20261101120000_tardia.sql' })
    expect(reglas(analizarLocal([...legados, '20261204120000_igual.sql'], mapa).errores)).toEqual(expect.arrayContaining(['version_vieja', 'duplicada']))
  })
  it('rechaza versiones duplicadas cuando interviene un archivo nuevo', () => {
    const r = analizarLocal([...legados, '20261205120000_a.sql', '20261205120000_b.sql'], mapa)
    expect(reglas(r.errores)).toEqual(['duplicada'])
  })
  it('las duplicadas legadas sólo avisan', () => {
    const m = { ...mapa, archivos: [...mapa.archivos, { archivo: '20260725_otra.sql', version: '20260725', estado: 'APLICADA_A_MANO_SIN_REGISTRO' }] }
    const r = analizarLocal([...legados, '20260725_otra.sql'], m)
    expect(r.errores).toEqual([])
    expect(reglas(r.avisos)).toContain('duplicada')
  })
  it('rechaza un rollback nuevo dentro de supabase/migrations', () => {
    const r = analizarLocal([...legados, '20261205120000_x_rollback.sql'], mapa)
    expect(reglas(r.errores)).toContain('rollback')
  })
  it('avisa si un archivo del mapa desapareció', () => {
    const r = analizarLocal(legados.slice(1), mapa)
    expect(r.errores).toEqual([])
    expect(r.avisos.find(a => a.regla === 'mapa_sin_archivo')?.archivo).toBe(legados[0])
  })
  it('con --base el piso sube a la última versión de la rama base', () => {
    const base = [...legados, '20261205140000_mergeada.sql']
    const r = analizarLocal([...base, '20261205130000_tardia.sql'], mapa, { archivosBase: base })
    expect(r.errores.map(e => e.archivo)).toEqual(['20261205130000_tardia.sql'])
    expect(r.piso).toBe('20261205140000')
  })
})

describe('analizarRemoto', () => {
  const remotas = ['20260725230000', '20261203130000', '20261103232827']
  it('aborta si un push re-ejecutaría algo que el mapa marca como aplicado', () => {
    const r = analizarRemoto(legados, remotas, mapa)
    const ya = r.errores.filter(e => e.regla === 'pendiente_ya_aplicada').map(e => e.archivo)
    expect(ya).toEqual(['20260725_rondas_nativas_base.sql', '20261204120000_facturacion_seguro_periodo.sql'])
  })
  it('aborta si queda una pendiente más vieja que la última registrada', () => {
    const r = analizarRemoto(legados, remotas, mapa)
    expect(r.errores.find(e => e.regla === 'pendiente_antigua')?.archivo).toBe('20260802100000_ronda_control_gps.sql')
  })
  it('una pendiente nueva posterior al historial no bloquea; avisa filas sólo remotas', () => {
    const todas = ['20260725', '20260725230000', '20260802100000', '20261204120000', '20261103232827']
    const r = analizarRemoto([...legados, '20261205130000_nueva.sql'], todas, mapa)
    expect(r.errores).toEqual([])
    expect(r.pendientes).toEqual(['20261205130000'])
    expect(r.soloRemotas).toEqual(['20261103232827'])
    expect(reglas(r.avisos)).toEqual(['solo_remota'])
  })
})

describe('parsearHistorialRemoto', () => {
  it('lee JSON, texto version|name y la tabla de migration list', () => {
    expect(parsearHistorialRemoto('[{"version":"20261202120000"},{"version":"20261203130000"}]')).toEqual(['20261202120000', '20261203130000'])
    expect(parsearHistorialRemoto('20260901200636|rondas\n20261202120000|x\n')).toEqual(['20260901200636', '20261202120000'])
    const tabla = '  Local          | Remote         | Time\n  ---------------|----------------|-----\n  20261202120000 | 20261202120000 | 2026-12-02\n                 | 20261103232827 | 2026-11-03\n  20261204120000 |                | 2026-12-04'
    expect(parsearHistorialRemoto(tabla)).toEqual(['20261202120000', '20261103232827'])
  })
})

describe('leerHistorialDesdeDb', () => {
  it('fuerza sólo lectura, hace un único SELECT y no filtra la URL en el error', () => {
    const llamadas: any[] = []
    const ok = (cmd: string, args: string[], opts: any) => { llamadas.push({ cmd, args, opts }); return { status: 0, stdout: '20261202120000\n20261203130000\n' } }
    expect(leerHistorialDesdeDb("postgresql://u:secreto@host/db", ok as any)).toEqual(['20261202120000', '20261203130000'])
    expect(llamadas[0].cmd).toBe('psql')
    expect(llamadas[0].opts.env.PGOPTIONS).toContain('default_transaction_read_only=on')
    expect(llamadas[0].args.at(-1)).toMatch(/^select version from supabase_migrations\.schema_migrations/)
    const falla = () => ({ status: 2, stderr: 'FATAL: password failed for postgresql://u:secreto@host/db' })
    expect(() => leerHistorialDesdeDb('postgresql://u:secreto@host/db', falla as any)).toThrow(/<url>/)
    try { leerHistorialDesdeDb('postgresql://u:secreto@host/db', falla as any) } catch (e: any) { expect(e.message).not.toContain('secreto') }
  })
})

describe('main', () => {
  function proyecto(archivos: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'))
    mkdirSync(join(dir, 'supabase/migrations'), { recursive: true })
    mkdirSync(join(dir, 'docs/migraciones'), { recursive: true })
    for (const f of archivos) writeFileSync(join(dir, 'supabase/migrations', f), '-- x\n')
    writeFileSync(join(dir, 'docs/migraciones/mapa-historial.json'), JSON.stringify(mapa))
    return dir
  }
  const silencio = () => {}
  it('sale 0 sin errores y 1 con una migración vieja nueva', () => {
    expect(main([], proyecto(legados), silencio)).toBe(0)
    expect(main([], proyecto([...legados, '20261001120000_vieja.sql']), silencio)).toBe(1)
  })
  it('modo remoto con historial exportado: aborta si hay pendientes antiguas', () => {
    const dir = proyecto(legados)
    writeFileSync(join(dir, 'historial.txt'), '20260725230000|x\n20261203130000|y\n')
    const salida: string[] = []
    expect(main(['--remoto', '--historial-remoto', 'historial.txt'], dir, (s: string) => salida.push(s))).toBe(1)
    expect(salida.join('\n')).toContain('NO ejecutes `supabase db push`')
  })
  it('--remoto sin fuente es un error explícito', () => {
    const anterior = process.env.MIGRACIONES_GUARD_DB_URL
    delete process.env.MIGRACIONES_GUARD_DB_URL
    try { expect(() => main(['--remoto'], proyecto(legados), silencio)).toThrow(/--db-url/) } finally { if (anterior !== undefined) process.env.MIGRACIONES_GUARD_DB_URL = anterior }
  })
})

describe('repositorio real', () => {
  it('supabase/migrations de este repo pasa el guard contra el mapa versionado', () => {
    const raiz = join(__dirname, '..')
    const archivos = readdirSync(join(raiz, 'supabase/migrations'))
    const mapaReal = JSON.parse(readFileSync(join(raiz, 'docs/migraciones/mapa-historial.json'), 'utf8'))
    const r = analizarLocal(archivos, mapaReal)
    expect(r.errores).toEqual([])
    // El mapa cubre cada archivo de main con una de las 5 categorías.
    const categorias = new Set(['REGISTRADA_MISMA_VERSION', 'REGISTRADA_OTRA_VERSION', 'APLICADA_A_MANO_SIN_REGISTRO', 'FALTA_REALMENTE', 'OBSOLETA_BORRADOR'])
    for (const fila of mapaReal.archivos) expect(categorias.has(fila.estado)).toBe(true)
    expect(mapaReal.archivos.find((a: any) => a.archivo === '20261204120000_facturacion_seguro_periodo.sql').estado).toBe('APLICADA_A_MANO_SIN_REGISTRO')
  })
})
