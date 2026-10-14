import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  TIPOS_HABILITACION, antiguedadTexto, contarGrupos, enGrupo, enlaceMega, ordenar, responsableTexto, seisMesesTexto, tieneCredencial,
} from '@/lib/habilitacion'
import type { FilaTablero, ResumenHabilitacion } from '@/lib/habilitacion'

const mig = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261015120000_habilitaciones.sql'), 'utf8')

const cred = (estado: 'vigente' | 'por_vencer' | 'vencida', verificada = true, dias = 100) =>
  ({ id: 'c', numero: '1', fecha_emision: null, vence_el: '2027-01-01', estado, dias, verificada, documento_id: null, registrada_at: '' })
const r = (x: Partial<ResumenHabilitacion>): ResumenHabilitacion => ({
  empleado_id: 'e', codigo: 'desconocida', titulo: '', detalle: '', responsable_rol: null, responsable_nombre: null, urgencia: 0,
  credencial: null, tramite: null, ingreso: '2026-01-01', seis_meses: null, dias_para_6_meses: null, antiguedad_dias: null,
  verificacion: null, planilla_vencimiento: null, ...x,
})
const tramite = (demorado = false) => ({ id: 't', tipo: 'primera' as const, estado: 'en_curso' as const, abierto_at: '', presentado_at: null,
  ultimo_movimiento_at: '', dias_sin_movimiento: 3, demorado, pendientes: 2, pasos: [] })

describe('Las situaciones que no se confunden', () => {
  const casos: [string, ResumenHabilitacion][] = [
    ['credencial inexistente', r({ codigo: 'sin_tramite' })],
    ['vencida', r({ codigo: 'vencida', credencial: cred('vencida') })],
    ['vigente', r({ codigo: 'vigente', credencial: cred('vigente') })],
    ['trámite incompleto', r({ codigo: 'tramite_incompleto', tramite: tramite() })],
    ['completo sin presentar', r({ codigo: 'pendiente_firma', tramite: tramite() })],
    ['presentado sin emisión', r({ codigo: 'presentado', tramite: { ...tramite(), estado: 'presentado' } })],
    ['sin verificar', r({ codigo: 'desconocida' })],
    ['credencial informada sin verificar', r({ codigo: 'sin_verificar', credencial: cred('vigente', false) })],
  ]
  it('sólo una credencial verificada cuenta como «tiene credencial»', () => {
    expect(casos.filter(([, x]) => tieneCredencial(x)).map(([n]) => n)).toEqual(['vencida', 'vigente'])
  })
  it('documentación completa o presentada NO es vigente', () => {
    for (const [n, x] of casos) if (['completo sin presentar', 'presentado sin emisión'].includes(n)) {
      expect(enGrupo(x, 'vigentes')).toBe(false)
      expect(enGrupo(x, 'sin_credencial')).toBe(true)
      expect(enGrupo(x, 'en_tramite')).toBe(true)
    }
  })
  it('sin verificar no figura como «sin credencial» (no se sabe)', () => {
    expect(enGrupo(casos[6][1], 'sin_credencial')).toBe(false)
    expect(enGrupo(casos[6][1], 'sin_verificar')).toBe(true)
    expect(enGrupo(casos[7][1], 'vigentes')).toBe(false)
    expect(enGrupo(casos[7][1], 'sin_verificar')).toBe(true)
  })
  it('conteos del tablero', () => {
    const c = contarGrupos(casos.map(([, x]) => x))
    expect([c.vigentes, c.vencidas, c.sin_credencial, c.en_tramite, c.sin_verificar, c.todos]).toEqual([1, 1, 4, 3, 2, 8])
  })
  it('demorados y sin fecha de ingreso', () => {
    expect(enGrupo(r({ tramite: tramite(true) }), 'demorados')).toBe(true)
    expect(enGrupo(r({ ingreso: null }), 'sin_ingreso')).toBe(true)
  })
})

describe('Seis meses: sólo seguimiento, mientras no tenga credencial', () => {
  it('textos y colores por cercanía', () => {
    expect(seisMesesTexto(r({ dias_para_6_meses: -5 }))?.texto).toBe('6 meses cumplidos hace 5 días')
    expect(seisMesesTexto(r({ dias_para_6_meses: 20 }))?.color).toBe('#f87171')
    expect(seisMesesTexto(r({ dias_para_6_meses: 45 }))?.color).toBe('#fbbf24')
  })
  it('con más de un año de antigüedad no se muestra (no es un ingreso reciente)', () => {
    expect(seisMesesTexto(r({ dias_para_6_meses: -3432 }))).toBeNull()
    expect(seisMesesTexto(r({ dias_para_6_meses: -100 }))?.texto).toBe('6 meses cumplidos hace 100 días')
  })
  it('con credencial verificada no se muestra', () => {
    expect(seisMesesTexto(r({ dias_para_6_meses: 10, credencial: cred('vigente') }))).toBeNull()
    expect(seisMesesTexto(r({ dias_para_6_meses: 10, credencial: cred('vigente', false) }))).not.toBeNull()
  })
  it('antigüedad legible', () => {
    expect(antiguedadTexto(null)).toBe('sin fecha de ingreso')
    expect(antiguedadTexto(12)).toBe('12 días')
    expect(antiguedadTexto(150)).toBe('4 meses')
    expect(antiguedadTexto(460)).toBe('1 año y 3 meses')
  })
  it('la base no decide nada sobre desvinculaciones ni indemnizaciones', () => {
    expect(mig).not.toMatch(/desvincul[a-z]*\s*(:=|=)|indemniz[a-z]*\s*(:=|=)|estado\s*=\s*'inactivo'|update public\.usuarios/i)
  })
})

describe('Responsables y orden', () => {
  it('nombre propio cuando hay persona fija (salvo el empleado)', () => {
    expect(responsableTexto(r({ responsable_rol: 'administracion', responsable_nombre: 'Joel Juárez' }))).toBe('Joel Juárez (Administración)')
    expect(responsableTexto(r({ responsable_rol: 'presentacion' }))).toBe('Facundo, un supervisor o el empleado')
  })
  it('ordena por urgencia y por cercanía a los 6 meses', () => {
    const f = (n: string, urgencia: number, d: number | null) => ({ ...r({ urgencia, dias_para_6_meses: d }), nombre: n, apellido: n, legajo: null, cuil: null, objetivo: null, primer_turno: null }) as FilaTablero
    const filas = [f('B', 40, 90), f('A', 90, 20), f('C', 90, null)]
    expect(ordenar(filas, 'urgencia').map(x => x.apellido)).toEqual(['A', 'C', 'B'])
    expect(ordenar(filas, 'seis_meses').map(x => x.apellido)).toEqual(['A', 'B', 'C'])
  })
})

describe('Integración con el legajo y MEGA', () => {
  it('los tipos de la credencial coinciden con los marcados en la base', () => {
    const m = /codigo in \(([^)]+)\);/.exec(mig.slice(mig.indexOf('set para_habilitacion = true')))
    expect(m?.[1].split(',').map(x => x.trim().replace(/'/g, '')).sort()).toEqual([...TIPOS_HABILITACION].sort())
  })
  it('el enlace a MEGA filtra por persona y tipo', () => {
    expect(enlaceMega('abc', 'dni')).toBe('/dashboard?page=legajo_historico&empleado=abc&ver=pendientes&tipo=dni')
  })
  it('la revisión de MEGA arranca por los requisitos de la credencial', () => {
    const s = readFileSync(join(__dirname, '..', 'components', 'legajo', 'BandejaHistorico.tsx'), 'utf8')
    expect(s).toMatch(/useState\(categoriaInicial \?\? CREDENCIAL\)/)
  })
  it('el sector va arriba del legajo y sólo para Administración y Gerencia', () => {
    const s = readFileSync(join(__dirname, '..', 'app', 'guardias', '[id]', 'LegajoPage.tsx'), 'utf8')
    expect(s.indexOf('<PanelHabilitacion')).toBeLessThan(s.indexOf('<nav style={S.nav}>'))
    expect(s).toMatch(/empleado\.rol === 'guardia' && usuarioId !== null && usuarioId !== empleadoId && gestionaDatosSensibles/)
  })
  it('Legajo Digital abre en Credenciales', () => {
    const s = readFileSync(join(__dirname, '..', 'components', 'legajo', 'LegajoDigital.tsx'), 'utf8')
    expect(s).toMatch(/inicial = 'credenciales'/)
  })
})

describe('Procedimiento de Mercosur Seguridad en el catálogo', () => {
  it('las 15 gestiones con su responsable habitual', () => {
    const filas = mig.slice(mig.indexOf('insert into public.habilitacion_pasos_catalogo'), mig.indexOf('on conflict (codigo) do nothing'))
    const pasos = Array.from(filas.matchAll(/\('([a-z_0-9]+)', '[^']+', '([a-z_]+)', (\d+), '([a-z_]+)'/g)).map(m => [m[1], m[4]])
    expect(pasos).toEqual([
      ['dni', 'empleado'], ['alta_arca', 'administracion'], ['fotos', 'empleado'], ['antecedentes_rnr', 'empleado'],
      ['antecedentes_provincia', 'empleado'], ['art51', 'empleado'], ['turno_estudios', 'administracion'], ['estudios_resultados', 'administracion'],
      ['anexos_firma_laboral', 'medicina_laboral'], ['anexos_retiro', 'administracion'], ['turno_medicina_legal', 'administracion'],
      ['medicina_legal_asistencia', 'empleado'], ['anexos_devolucion', 'empleado'], ['firma_gerencia', 'gerencia'], ['presentacion', 'presentacion'],
    ])
  })
})
