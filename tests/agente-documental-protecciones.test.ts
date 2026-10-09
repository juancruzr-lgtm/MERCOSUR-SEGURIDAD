import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FileFilter } from '@/agente-documental/src/scanner/FileFilter'
import { Scanner } from '@/agente-documental/src/scanner/Scanner'
import { Logger } from '@/agente-documental/src/logger/Logger'
import { planReconciliacion } from '@/agente-documental/src/indexer/Reconciliacion'

// Decisión H-13: el agente indexaba la papelera de sincronización de MEGA
// (64% del índice) y una lectura fallida marcaba archivos como eliminados.

const filtro = new FileFilter([], 50)
const opc = (extra: Partial<Parameters<typeof planReconciliacion>[2]> = {}) => ({
  dirsIlegibles: [], archivosIlegibles: new Set<string>(), excluida: (r: string) => filtro.isInIgnoredPath(r),
  umbralFaltantes: 0.2, ...extra,
})

describe('Papeleras excluidas', () => {
  it('SyncDebris, .debris y la papelera de Windows no se recorren', () => {
    for (const d of ['SyncDebris', '.debris', 'Rubbish', '$RECYCLE.BIN']) expect(filtro.shouldIgnoreDirectory(d)).toBe(true)
    expect(filtro.shouldIgnoreDirectory('EMPLEADOS')).toBe(false)
  })
  it('reconoce rutas ya indexadas dentro de la papelera', () => {
    expect(filtro.isInIgnoredPath('SyncDebris/2024-11-11/EMPLEADOS/x.xlsx')).toBe(true)
    expect(filtro.isInIgnoredPath('EMPLEADOS/SyncDebris.pdf')).toBe(false)
  })

  const raiz = mkdtempSync(join(tmpdir(), 'agente-'))
  afterAll(() => rmSync(raiz, { recursive: true, force: true }))
  it('el escaneo real no devuelve archivos de la papelera', async () => {
    mkdirSync(join(raiz, 'SyncDebris', '2024-11-11'), { recursive: true })
    mkdirSync(join(raiz, 'EMPLEADOS'), { recursive: true })
    writeFileSync(join(raiz, 'SyncDebris', '2024-11-11', 'viejo.pdf'), '%PDF-1.4 viejo')
    writeFileSync(join(raiz, 'EMPLEADOS', 'vivo.pdf'), '%PDF-1.4 vivo')
    const s = new Scanner(filtro, new Logger('error'))
    const r = await s.scanDirectory(raiz)
    expect(r.map(a => a.rutaRelativa)).toEqual(['EMPLEADOS/vivo.pdf'])
    expect(s.dirsIlegibles).toEqual([])
  })
})

describe('Sin eliminaciones falsas', () => {
  const conocidas = Array.from({ length: 10 }, (_, i) => `EMPLEADOS/a${i}.pdf`)
  it('marca sólo lo que de verdad falta', () => {
    const encontradas = new Set(conocidas.slice(1))
    expect(planReconciliacion(conocidas, encontradas, opc())).toMatchObject({ marcar: ['EMPLEADOS/a0.pdf'], abortada: null })
  })
  it('si no se encontró nada, no marca nada (carpeta desmontada)', () => {
    const p = planReconciliacion(conocidas, new Set(), opc())
    expect(p.marcar).toEqual([])
    expect(p.abortada).toMatch(/ningún archivo/)
  })
  it('si faltan más del umbral, no marca nada salvo que se fuerce', () => {
    const encontradas = new Set(conocidas.slice(5))
    expect(planReconciliacion(conocidas, encontradas, opc()).abortada).toMatch(/umbral/)
    expect(planReconciliacion(conocidas, encontradas, opc({ forzar: true })).marcar).toHaveLength(5)
  })
  it('lo que está bajo una carpeta ilegible queda protegido', () => {
    const c = ['EMPLEADOS/A/x.pdf', 'EMPLEADOS/B/y.pdf', ...conocidas]
    const encontradas = new Set(conocidas)
    const p = planReconciliacion(c, encontradas, opc({ dirsIlegibles: ['EMPLEADOS/A'] }))
    expect(p.marcar).toEqual(['EMPLEADOS/B/y.pdf'])
    expect(p.protegidas).toBe(1)
  })
  it('un archivo que no se pudo leer queda protegido', () => {
    const p = planReconciliacion(conocidas, new Set(conocidas.slice(1)), opc({ archivosIlegibles: new Set(['EMPLEADOS/a0.pdf']) }))
    expect(p.marcar).toEqual([])
    expect(p.protegidas).toBe(1)
  })
  it('lo indexado de la papelera no se marca eliminado ni cuenta para el umbral', () => {
    const papelera = Array.from({ length: 30 }, (_, i) => `SyncDebris/2024/x${i}.pdf`)
    const p = planReconciliacion([...papelera, ...conocidas], new Set(conocidas), opc())
    expect(p).toMatchObject({ marcar: [], excluidas: 30, abortada: null })
  })
  it('una carpeta raíz ilegible protege todo', () => {
    const p = planReconciliacion(conocidas, new Set(['otra.pdf']), opc({ dirsIlegibles: [''] }))
    expect(p.marcar).toEqual([])
  })
})
