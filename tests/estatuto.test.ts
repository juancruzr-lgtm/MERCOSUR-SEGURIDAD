import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import {
  TEXTO_CARTEL, TEXTO_DECLARACION, TITULO_CARTEL, contenidoDeVersion, declaracionHabilitada,
  estadoAceptacion, etiquetaVersion, mostrarCartel, puedeAceptar, resumenControl,
  textoCanonico, tramosConNegrita, versionVigente,
} from '@/lib/estatuto'
import type { AceptacionEstatuto, PersonaControl, VersionEstatuto } from '@/lib/estatuto'

const RAIZ = join(__dirname, '..')
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

const version = (id: string, over: Partial<VersionEstatuto> = {}): VersionEstatuto => ({
  id, identificador: id, titulo: 'Estatuto Interno',
  archivo_ruta: '/x.doc', archivo_nombre: 'x.doc', archivo_sha256: 'a'.repeat(64),
  archivo_bytes: 1, texto_sha256: null, estado: 'borrador', publicado_at: null,
  publicado_por: null, ...over,
})

const aceptacion = (versionId: string, empleadoId: string): AceptacionEstatuto => ({
  id: `${versionId}-${empleadoId}`, version_id: versionId, empleado_id: empleadoId,
  auth_user_id: 'auth-' + empleadoId, version_identificador: versionId,
  archivo_sha256: 'a'.repeat(64), texto_sha256: null,
  declaracion: 'x', abierto_at: '2026-10-08T12:00:00Z', aceptado_at: '2026-10-08T12:05:00Z',
})

// ── Versión vigente ──────────────────────────────────────────────────────────

describe('versión vigente', () => {
  it('sin versiones publicadas no hay vigente (el borrador no rige)', () => {
    expect(versionVigente([version('1')])).toBeNull()
  })

  it('es la publicada más reciente, aunque haya un borrador más nuevo', () => {
    const v1 = version('v1', { estado: 'publicado', publicado_at: '2026-05-01T10:00:00Z' })
    const v2 = version('v2', { estado: 'publicado', publicado_at: '2026-09-01T10:00:00Z' })
    const borrador = version('v3')
    expect(versionVigente([v1, borrador, v2])?.id).toBe('v2')
  })

  it('una publicada sin fecha de publicación no se toma como vigente', () => {
    expect(versionVigente([version('v1', { estado: 'publicado', publicado_at: null })])).toBeNull()
  })
})

// ── Estado por persona y versión ─────────────────────────────────────────────

describe('estado pendiente / aceptado por versión', () => {
  const v1 = version('v1', { estado: 'publicado', publicado_at: '2026-05-01T10:00:00Z' })
  const v2 = version('v2', { estado: 'publicado', publicado_at: '2026-09-01T10:00:00Z' })

  it('sin versión vigente no se pide nada', () => {
    expect(estadoAceptacion(null, [], 'e1')).toBe('sin_version')
  })

  it('pendiente si no aceptó la vigente', () => {
    expect(estadoAceptacion(v1, [], 'e1')).toBe('pendiente')
  })

  it('aceptado si aceptó la vigente', () => {
    expect(estadoAceptacion(v1, [aceptacion('v1', 'e1')], 'e1')).toBe('aceptado')
  })

  it('aceptar una versión anterior no cubre la nueva: publicar pide aceptar de nuevo', () => {
    expect(estadoAceptacion(v2, [aceptacion('v1', 'e1')], 'e1')).toBe('pendiente')
  })

  it('la aceptación de otra persona no cuenta', () => {
    expect(estadoAceptacion(v1, [aceptacion('v1', 'e2')], 'e1')).toBe('pendiente')
  })
})

// ── Habilitación de la declaración ───────────────────────────────────────────

describe('la declaración se habilita sólo después de abrir el documento', () => {
  const base = { estado: 'pendiente' as const, abiertoEnPantalla: false, aperturaRegistrada: false }

  it('sin abrir: deshabilitada', () => {
    expect(declaracionHabilitada(base)).toBe(false)
    expect(puedeAceptar({ ...base, casillaMarcada: true })).toBe(false)
  })

  it('abierto en pantalla: habilita la casilla', () => {
    expect(declaracionHabilitada({ ...base, abiertoEnPantalla: true })).toBe(true)
  })

  it('apertura ya registrada (volvió otro día): habilita la casilla', () => {
    expect(declaracionHabilitada({ ...base, aperturaRegistrada: true })).toBe(true)
  })

  it('aceptar exige casilla marcada', () => {
    expect(puedeAceptar({ ...base, abiertoEnPantalla: true, aperturaRegistrada: true, casillaMarcada: false })).toBe(false)
    expect(puedeAceptar({ ...base, abiertoEnPantalla: true, aperturaRegistrada: true, casillaMarcada: true })).toBe(true)
  })

  it('aceptar exige que la base tenga la apertura (la RPC la pide)', () => {
    expect(puedeAceptar({ ...base, abiertoEnPantalla: true, aperturaRegistrada: false, casillaMarcada: true })).toBe(false)
  })

  it('no se manda dos veces mientras está enviando', () => {
    expect(puedeAceptar({ ...base, aperturaRegistrada: true, casillaMarcada: true, enviando: true })).toBe(false)
  })

  it('ya aceptado o sin versión: nunca se habilita', () => {
    expect(declaracionHabilitada({ ...base, estado: 'aceptado', abiertoEnPantalla: true })).toBe(false)
    expect(declaracionHabilitada({ ...base, estado: 'sin_version', abiertoEnPantalla: true })).toBe(false)
  })
})

// ── Textos ───────────────────────────────────────────────────────────────────

describe('texto de la declaración y versión, sin fecha (Gerencia 08/10)', () => {
  it('la declaración es exactamente la pedida', () => {
    expect(TEXTO_DECLARACION).toBe(
      'Declaro haber leído y tomado conocimiento del Estatuto Interno de Mercosur Seguridad SRL.',
    )
  })

  it('no lleva ninguna fecha', () => {
    expect(TEXTO_DECLARACION).not.toMatch(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|2026|versión/)
  })

  it('es el mismo texto que arma la base (estatuto_texto_declaracion)', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261008150000_estatuto_interno.sql'), 'utf8').replace(/\r\n/g, '\n')
    expect(sql).toContain("'Declaro haber leído y tomado conocimiento del Estatuto Interno de '\n      || 'Mercosur Seguridad SRL.'")
    expect(sql).not.toContain('to_char(p_fecha')
  })

  it('la versión se muestra como número', () => {
    expect(etiquetaVersion('1')).toBe('Versión 1')
  })

  it('el cartel dice lo que pidió la Gerencia', () => {
    expect(TITULO_CARTEL).toBe('ESTATUTO INTERNO — MERCOSUR SEGURIDAD SRL')
    expect(TEXTO_CARTEL).toBe(
      'El Estatuto Interno establece las obligaciones, normas de conducta y procedimientos que deben ' +
      'cumplir los integrantes de la empresa. Te solicitamos que leas el documento completo y confirmes ' +
      'que tomaste conocimiento de su contenido.',
    )
  })
})

// ── Cartel ───────────────────────────────────────────────────────────────────

describe('cartel', () => {
  it('aparece mientras esté pendiente', () => {
    expect(mostrarCartel('pendiente', 'v1', null)).toBe(true)
  })
  it('"Después" lo esconde sólo para esa versión', () => {
    expect(mostrarCartel('pendiente', 'v1', 'v1')).toBe(false)
    expect(mostrarCartel('pendiente', 'v2', 'v1')).toBe(true)
  })
  it('no aparece aceptado ni sin versión', () => {
    expect(mostrarCartel('aceptado', 'v1', null)).toBe(false)
    expect(mostrarCartel('sin_version', null, null)).toBe(false)
  })
})

// ── Control ──────────────────────────────────────────────────────────────────

describe('control de Administración / Gerencia', () => {
  const p = (id: string, apellido: string, aceptado: boolean, abierto = aceptado): PersonaControl => ({
    empleado_id: id, nombre: 'N', apellido, legajo: null, cuil: null, rol: 'guardia', puesto: 'vigilador',
    abierto_at: abierto ? '2026-10-08T12:00:00Z' : null, aceptado_at: aceptado ? '2026-10-08T12:05:00Z' : null,
    ultima_version_aceptada: aceptado ? '1' : null, ultima_aceptacion_at: null,
  })

  it('pendientes por diferencia sobre el universo', () => {
    const r = resumenControl([p('1', 'Zeta', true), p('2', 'Alfa', false, true), p('3', 'Beta', false)])
    expect(r.alcanzados).toBe(3)
    expect(r.aceptaron).toBe(1)
    expect(r.pendientes).toBe(2)
    expect(r.abrieronSinAceptar).toBe(1)
    expect(r.listaPendientes.map(x => x.apellido)).toEqual(['Alfa', 'Beta'])
  })

  it('universo vacío: cero, no error', () => {
    expect(resumenControl([]).pendientes).toBe(0)
  })
})

// ── Integridad del documento ─────────────────────────────────────────────────

describe('documento (versión 1): el original y su conversión', () => {
  const c = contenidoDeVersion('1')!

  it('el original guardado es el recibido, byte a byte (SHA-256), y fuera de /public', () => {
    const original = readFileSync(join(RAIZ, 'privado/estatuto/v1/estatuto-interno.doc'))
    expect(original.length).toBe(90624)
    expect(sha256(original)).toBe('5feb70d22a7b5fffe100eb56304654678c73328117ecc4de25b8c5db4c46228c')
    expect(c.fuente.sha256_original).toBe(sha256(original))
  })

  it('la copia PDF guardada es la registrada (no se sirve)', () => {
    const pdf = readFileSync(join(RAIZ, 'privado/estatuto/v1/estatuto-interno.pdf'))
    expect(sha256(pdf)).toBe(c.fuente.sha256_pdf)
  })

  it('el texto mostrado no cambió desde la verificación (texto_sha256)', () => {
    expect(sha256(textoCanonico(c))).toBe(c.texto_sha256)
  })

  it('la migración registra los mismos hashes y la carga como BORRADOR', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261008150000_estatuto_interno.sql'), 'utf8').replace(/\r\n/g, '\n')
    expect(sql).toContain(`'${c.fuente.sha256_original}'`)
    expect(sql).toContain(`'${c.texto_sha256}'`)
    expect(sql).toMatch(/'b84a4047[0-9a-f]+',\s*'borrador',/)
    expect(sql).toContain("'1',\n  '/documentos/estatuto/v1/estatuto-interno.doc',\n  'estatuto-interno.doc',")
  })

  it('sin la fecha del documento en lo que se muestra o se descarga (Gerencia 08/10)', () => {
    const fecha = /21[-/]04[-/](20)?26|2026-04-21|MODIFICADO el/i
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261008150000_estatuto_interno.sql'), 'utf8').replace(/\r\n/g, '\n')
    expect(sql).not.toMatch(fecha)
    expect(sql).not.toContain('fecha_documento')
    expect(JSON.stringify(c)).not.toMatch(fecha)
    // Ni el Word ni el PDF están en /public (Gerencia 08/10): se lee en la app.
    expect(readdirSync(join(RAIZ, 'privado/estatuto/v1')).sort())
      .toEqual(['estatuto-interno.doc', 'estatuto-interno.pdf'])
    for (const archivo of ['lib/estatuto.ts', 'components/estatuto/EstatutoInterno.tsx',
      'components/estatuto/ControlEstatuto.tsx', 'components/estatuto/AvisoEstatuto.tsx',
      'components/estatuto/DocumentoEstatuto.tsx']) {
      expect(readFileSync(join(RAIZ, archivo), 'utf8')).not.toMatch(fecha)
    }
    expect(sql).not.toMatch(/insert into public\.estatuto_versiones[\s\S]*'publicado'[\s\S]*on conflict \(identificador\)/)
  })

  it('conteos: 63 párrafos, 4 secciones, 42 con numeración automática', () => {
    expect(c.parrafos.length).toBe(63)
    expect(c.conteos).toEqual({ parrafos: 63, numerados: 42, secciones: 4 })
    expect(c.parrafos.filter(x => x.tipo === 'seccion').map(x => x.texto)).toEqual([
      'CONSIDERACIONES GENERALES:',
      'OBLIGACIONES EN EL PUESTO DE TRABAJO',
      'RELACION CON LOS SUPERIORES Y DIRECTIVOS DE LOS OBJETIVOS',
      'OBLIGACIONES DEL PERSONAL PARA CON  LA AGENCIA',
    ])
  })

  // Los puntos numerados por sección, con la numeración tal como la muestra
  // Word (automática) o como está escrita a mano dentro del texto.
  const seccion = (titulo: string) => {
    const i = c.parrafos.findIndex(x => x.tipo === 'seccion' && x.texto.startsWith(titulo))
    const resto = c.parrafos.slice(i + 1)
    const fin = resto.findIndex(x => x.tipo === 'seccion' || x.tipo === 'cierre')
    return fin < 0 ? resto : resto.slice(0, fin)
  }
  const numeroDe = (x: { numero: string | null; texto: string }) =>
    x.numero ?? (/^(\d+|[a-z])\s*\)/.exec(x.texto)?.[0].replace(/\s+/g, '') ?? null)

  it('Obligaciones en el puesto: 22 puntos, del 1 al 23 SIN el 10 (así está en el original)', () => {
    const nums = seccion('OBLIGACIONES EN EL PUESTO').map(numeroDe).filter(Boolean)
    expect(nums).toEqual([
      '1)', '2)', '3)', '4)', '5)', '6)', '7)', '8)', '9)',
      '11)', '12)', '13)', '14)', '15)', '16)', '17)', '18)', '19)', '20)', '21)', '22)', '23)',
    ])
  })

  it('Consideraciones generales: 1 a 10 y los incisos a) a f)', () => {
    const nums = seccion('CONSIDERACIONES GENERALES').map(numeroDe).filter(Boolean)
    expect(nums).toEqual(['1)', '2)', '3)', '4)', '5)', '6)', '7)', '8)', '9)', '10)', 'a)', 'b)', 'c)', 'd)', 'e)', 'f)'])
  })

  it('Relación con superiores: 2 puntos; Obligaciones para con la agencia: 12 puntos', () => {
    expect(seccion('RELACION CON LOS SUPERIORES').map(numeroDe).filter(Boolean)).toEqual(['1)', '2)'])
    expect(seccion('OBLIGACIONES DEL PERSONAL').map(numeroDe).filter(Boolean))
      .toEqual(['1)', '2)', '3)', '4)', '5)', '6)', '7)', '8)', '9)', '10)', '11)', '12)'])
  })

  it('las disposiciones citadas para salidas anticipadas están en el texto real', () => {
    const puesto = seccion('OBLIGACIONES EN EL PUESTO')
    expect(puesto[0].texto).toMatch(/^1 \)\s+Es obligación ineludible observar puntualidad/)
    expect(puesto[0].texto).toContain('con una antelación de no menos quince minutos')
    const p11 = puesto.find(x => x.numero === '11)')!
    expect(p11.texto).toContain('Reviste carácter grave que el agente abandone su puesto de vigilancia')
    expect(p11.texto).toContain('permaneciendo en su puesto de trabajo hasta nueva orden')
    const agencia = seccion('OBLIGACIONES DEL PERSONAL')
    expect(agencia[0].numero).toBe('1)')
    expect(agencia[0].texto).toContain('en el lugar, hora y forma determinada')
  })

  it('negritas: se separan sin alterar el texto', () => {
    const p = c.parrafos.find(x => x.negritas?.includes('PROHIBIDO'))!
    expect(tramosConNegrita(p.texto, p.negritas).map(t => t.texto).join('')).toBe(p.texto)
    for (const x of c.parrafos) {
      expect(tramosConNegrita(x.texto, x.negritas).map(t => t.texto).join('')).toBe(x.texto)
    }
  })
})
