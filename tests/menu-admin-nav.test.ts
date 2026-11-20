import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  ITEMS_MENU_ADMIN, ORDEN_GRUPOS_MENU_ADMIN, construirNavAdmin, type PermisosMenuAdmin,
} from '@/lib/menu-admin-nav'

// Reagrupación del menú lateral del shell admin (Operaciones, Personal,
// Supervisión, Administración, Finanzas, Gerencia, Configuración). Lo único
// que cambia es el grupo y dos nombres; ids y permisos quedan iguales.

const CLAVES: Array<keyof PermisosMenuAdmin> = [
  'supervisarZona', 'supervisarTodasZonas', 'verDashboardGerencial', 'gestionarPersonal',
  'prepararLiquidacion', 'gestionarFacturacion', 'gestionaDatosSensibles', 'esAdminPleno',
  'veLegajoSupervisores', 'tableroGerenciaVisible', 'configuracionGuiadaVisible', 'gestionAdministracionVisible',
]

/** Todas las combinaciones de permisos (2^12 = 4096). */
function combinaciones(): PermisosMenuAdmin[] {
  const todas: PermisosMenuAdmin[] = []
  for (let m = 0; m < 1 << CLAVES.length; m++) {
    todas.push(Object.fromEntries(CLAVES.map((k, i) => [k, Boolean(m & (1 << i))])) as PermisosMenuAdmin)
  }
  return todas
}

/**
 * El menú ANTERIOR (main al 20/11/2026, AppClient.tsx), copiado tal cual en
 * su lógica: id → condición de visibilidad, en su orden. Es la referencia
 * contra la que se compara: si alguien cambia un permiso al tocar el menú,
 * esta prueba lo marca.
 */
function menuAnterior(p: PermisosMenuAdmin): Array<{ id: string, label: string }> {
  const sz = p.supervisarZona, stz = p.supervisarTodasZonas, gp = p.gestionarPersonal
  const it = (id: string, label: string) => ({ id, label })
  return [
    // GENERAL
    it('dashboard', 'Panel Principal'),
    ...(p.tableroGerenciaVisible && (sz || stz || p.verDashboardGerencial) ? [it('tablero_gerencia', 'Tablero de Gerencia')] : []),
    // OPERACIONES
    it('guardias', 'Guardias'), it('objetivos', 'Objetivos'), it('turnos', 'Turnos'),
    it('asistencia', 'Asistencia'), it('rondas', 'Rondas'), it('pagina_gps', 'Página GPS'),
    // ADMINISTRACIÓN
    it('cierre_operativo', 'Cierre Operativo'), it('revision_operativa', 'Revisión Operativa'),
    it('revision_fotos_ia', 'Revisión de fotos IA'), it('revision_planillas', 'Revisión de planillas'),
    it('supervisiones', 'Supervisiones'),
    ...(p.veLegajoSupervisores ? [it('evaluacion_supervisores', 'Evaluación de supervisores')] : []),
    ...(sz || stz ? [it('salidas_anticipadas', 'Salidas anticipadas')] : []),
    ...(gp ? [it('novedades_personal', 'Novedades del Personal')] : []),
    ...(gp ? [it('estatuto_interno', 'Estatuto Interno')] : []),
    ...(gp || stz ? [it('protocolos', 'Protocolos')] : []),
    ...(p.configuracionGuiadaVisible && (gp || stz || sz) ? [it('configuracion_guiada', 'Configurar objetivos')] : []),
    ...(p.gestionaDatosSensibles ? [it('legajo_digital', 'Legajo Digital')] : []),
    ...(p.gestionAdministracionVisible && p.gestionaDatosSensibles ? [it('gestion_administracion', 'Administración')] : []),
    it('reportes', 'Reportes'), it('supervisores_guardia', 'Supervisores de Guardia'), it('solicitudes_admin', 'Solicitudes Admin'),
    // GESTIÓN ECONÓMICA
    ...(p.prepararLiquidacion ? [it('liquidacion', 'Liquidación')] : []),
    ...(p.gestionarFacturacion ? [it('facturacion', 'Facturación')] : []),
    // CONFIGURACIÓN + SISTEMA
    ...(p.esAdminPleno ? [
      it('servicios_objetivo', 'Programación'), it('checklists', 'Checklists'), it('turnos_base', 'Turnos Base'),
      it('zonas_operativas', 'Zonas operativas'), it('referencias_ia', 'Referencias IA'),
      it('observacion', 'Observación del Sistema'),
    ] : []),
  ]
}

const GRUPO_ESPERADO: Record<string, string> = {
  dashboard: 'Operaciones', objetivos: 'Operaciones', turnos: 'Operaciones', asistencia: 'Operaciones',
  rondas: 'Operaciones', pagina_gps: 'Operaciones', cierre_operativo: 'Operaciones',
  guardias: 'Personal', novedades_personal: 'Personal', legajo_digital: 'Personal',
  estatuto_interno: 'Personal', solicitudes_admin: 'Personal',
  revision_operativa: 'Supervisión', revision_planillas: 'Supervisión', revision_fotos_ia: 'Supervisión',
  supervisiones: 'Supervisión', salidas_anticipadas: 'Supervisión', supervisores_guardia: 'Supervisión',
  evaluacion_supervisores: 'Supervisión', protocolos: 'Supervisión',
  gestion_administracion: 'Administración', reportes: 'Administración',
  liquidacion: 'Finanzas', facturacion: 'Finanzas',
  tablero_gerencia: 'Gerencia',
  servicios_objetivo: 'Configuración', turnos_base: 'Configuración', configuracion_guiada: 'Configuración',
  checklists: 'Configuración', zonas_operativas: 'Configuración', referencias_ia: 'Configuración',
  observacion: 'Configuración',
}

const RENOMBRADOS: Record<string, string> = {
  servicios_objetivo: 'Servicios por objetivo',
  turnos_base: 'Horarios tipo (turnos base)',
}

const TODO = Object.fromEntries(CLAVES.map(k => [k, true])) as PermisosMenuAdmin
const NADA = Object.fromEntries(CLAVES.map(k => [k, false])) as PermisosMenuAdmin

describe('menú admin por grupos', () => {
  it('cada ítem tiene un grupo válido, el de la tabla acordada', () => {
    for (const i of ITEMS_MENU_ADMIN) {
      expect(ORDEN_GRUPOS_MENU_ADMIN, i.id).toContain(i.grupo)
      expect(i.grupo, i.id).toBe(GRUPO_ESPERADO[i.id])
    }
    expect(ITEMS_MENU_ADMIN.map(i => i.id).sort()).toEqual(Object.keys(GRUPO_ESPERADO).sort())
  })

  it('los ids son únicos y son exactamente los del menú anterior', () => {
    const ids = ITEMS_MENU_ADMIN.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(menuAnterior(TODO).map(i => i.id).sort())
  })

  it('permisos: para las 4096 combinaciones se ven exactamente los mismos ids que antes', () => {
    let distintas = 0
    for (const p of combinaciones()) {
      const antes = menuAnterior(p).map(i => i.id).sort()
      const ahora = construirNavAdmin(p).flatMap(s => s.items.map(i => i.id)).sort()
      if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
        distintas++
        if (distintas === 1) expect({ p, ahora }).toEqual({ p, ahora: antes })
      }
    }
    expect(distintas).toBe(0)
  })

  it('nombres: sólo cambian Programación y Turnos Base', () => {
    const antes = new Map(menuAnterior(TODO).map(i => [i.id, i.label]))
    for (const i of ITEMS_MENU_ADMIN) {
      expect(i.label, i.id).toBe(RENOMBRADOS[i.id] ?? antes.get(i.id))
    }
  })

  it('los grupos salen en orden y nunca vacíos', () => {
    expect(construirNavAdmin(TODO).map(s => s.section)).toEqual([...ORDEN_GRUPOS_MENU_ADMIN])
    for (const p of combinaciones()) {
      const nav = construirNavAdmin(p)
      for (const s of nav) expect(s.items.length).toBeGreaterThan(0)
      const orden = nav.map(s => ORDEN_GRUPOS_MENU_ADMIN.indexOf(s.section as any))
      expect(orden).toEqual([...orden].sort((a, b) => a - b))
    }
  })

  it('perfil mínimo (sin permisos especiales): sin Finanzas, Gerencia ni Configuración', () => {
    expect(construirNavAdmin(NADA).map(s => s.section)).toEqual(['Operaciones', 'Personal', 'Supervisión', 'Administración'])
  })
})

describe('el título de la pantalla coincide con el menú', () => {
  const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
  it('Servicios por objetivo', () => {
    expect(app).toContain('<div style={S.title}>Servicios por objetivo</div>')
    expect(app).not.toContain("label:'Programación'")
  })
  it('Horarios tipo (turnos base)', () => {
    expect(app).toMatch(/🧱 Horarios tipo \(turnos base\)/)
    expect(app).not.toMatch(/^\s*🧱 Turnos Base\s*$/m)
  })
  it('AppClient arma el menú admin con construirNavAdmin', () => {
    expect(app).toContain('] : construirNavAdmin({')
  })
})
