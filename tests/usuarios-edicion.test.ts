// Regresión del borrado accidental de CBU / CUIL / legajo de Visual (05/11/2026).
// Simula el circuito completo de Guardias con una "base" en memoria:
//   base → pantalla (fila completa) → sincronización parcial (/api/sync-auth-emails)
//   → abrir ficha → editar → PATCH /api/usuarios (armarPayload + protección) → base
// y compara la base antes y después en cada escenario.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fusionarFila, fusionarLista, cambiosDeFormulario, protegerVaciadoReservado, CAMPOS_RESERVADOS } from '@/lib/usuarios-edicion'

type U = Record<string, any> & { id: string }

const BASE: U[] = [
  { id: 'a', nombre: 'Ana', apellido: 'Uno', dni: '30111222', telefono: '341111', legajo: '20301112223', email: 'ana@x.com', estado: 'activo', rol: 'guardia', puesto_organizacional: 'vigilador', foto_url: null, es_prueba: false, auth_user_id: 'au', created_at: 't', cuil: '20301112223', legajo_visual: 'UNO', cuenta_bancaria: '0123456789012' },
  { id: 'b', nombre: 'Beto', apellido: 'Dos', dni: '30222333', telefono: null, legajo: '20302223334', email: 'beto@x.com', estado: 'activo', rol: 'guardia', puesto_organizacional: 'vigilador', foto_url: null, es_prueba: false, auth_user_id: 'bu', created_at: 't', cuil: '20302223334', legajo_visual: null, cuenta_bancaria: '2850590940090418135201' },
  { id: 'c', nombre: 'Caro', apellido: 'Tres', dni: '30333444', telefono: '341333', legajo: '27303334445', email: null, estado: 'activo', rol: 'guardia', puesto_organizacional: 'vigilador', foto_url: null, es_prueba: false, auth_user_id: null, created_at: 't', cuil: null, legajo_visual: null, cuenta_bancaria: null },
]

// /api/sync-auth-emails devuelve SÓLO estas columnas (sólo empleados con Auth).
const COLS_SYNC = ['id', 'nombre', 'apellido', 'dni', 'email', 'telefono', 'legajo', 'rol', 'estado', 'foto_url', 'auth_user_id', 'created_at']
const parcial = (u: U) => Object.fromEntries(COLS_SYNC.map(k => [k, u[k]])) as U

// Formulario de Guardias (AppClient.formDesdeFila).
const formDesde = (g: U) => ({
  nombre: g.nombre || '', apellido: g.apellido || '', dni: g.dni || '', cuil: g.cuil || '',
  legajo_visual: g.legajo_visual || '', cuenta_bancaria: g.cuenta_bancaria || '', telefono: g.telefono || '',
  legajo: g.legajo || '', email: g.email || '', estado: g.estado || 'activo', rol: g.rol || 'guardia',
  puesto_organizacional: g.puesto_organizacional || '', foto_url: g.foto_url || '', es_prueba: Boolean(g.es_prueba),
})

// Servidor: mismos campos de texto opcionales que /api/usuarios + la protección.
const TEXTO_OPC = ['dni', 'telefono', 'email', 'foto_url', 'cuil', 'legajo_visual', 'cuenta_bancaria']
function patch(base: U[], body: Record<string, any>, puedeEconomico: boolean) {
  const payload: Record<string, unknown> = {}
  for (const k of ['nombre', 'apellido', 'legajo']) if (body[k] !== undefined) payload[k] = String(body[k] ?? '').trim()
  for (const k of TEXTO_OPC) {
    if (k === 'cuenta_bancaria' && !puedeEconomico) continue
    if (body[k] !== undefined) payload[k] = String(body[k] ?? '').trim() || null
  }
  for (const k of ['estado', 'rol', 'es_prueba']) if (body[k] !== undefined) payload[k] = body[k]
  const actual = base.find(u => u.id === body.usuario_id)!
  const r = protegerVaciadoReservado(payload, actual, body.confirmar_vaciar)
  return { base: base.map(u => (u.id === body.usuario_id ? { ...u, ...r.payload } : u)), protegidos: r.protegidos }
}

// Circuito completo como en la pantalla: carga, sincronización parcial, ficha, edición.
function editarEnGuardias(
  base: U[], id: string, editar: (f: ReturnType<typeof formDesde>) => void,
  { conRelectura = true, puedeEconomico = true }: { conRelectura?: boolean; puedeEconomico?: boolean } = {},
) {
  let pantalla: U[] = base.map(u => ({ ...u }))
  // La sincronización automática llega con filas incompletas.
  const sync = base.filter(u => u.auth_user_id).map(parcial)
  pantalla = pantalla.map(g => { const p = sync.find(s => s.id === g.id); return p ? fusionarFila(g, p) : g })
  let fila = pantalla.find(u => u.id === id)!
  if (conRelectura) fila = fusionarFila(fila, base.find(u => u.id === id)!) // abrirEdicion relee la fila completa
  const inicial = formDesde(fila)
  const form = { ...inicial }
  editar(form)
  const { cambios, vaciados } = cambiosDeFormulario(inicial, form, { minusculas: ['email'] })
  if (!puedeEconomico) delete cambios.cuenta_bancaria
  if (Object.keys(cambios).length === 0) return { base, cambios, protegidos: [] as string[] }
  const r = patch(base, { usuario_id: id, ...cambios, ...(vaciados.length ? { confirmar_vaciar: vaciados } : {}) }, puedeEconomico)
  return { ...r, cambios }
}

const sinCambiosSalvo = (antes: U[], despues: U[], id: string, campos: Record<string, unknown>) => {
  for (const u of despues) {
    const a = antes.find(x => x.id === u.id)!
    expect(u).toEqual(u.id === id ? { ...a, ...campos } : a)
  }
}

describe('Guardias: una edición no borra datos que no se tocaron', () => {
  it('ANTES de la corrección (reproducción): la fila parcial reemplazaba a la completa y el guardado vaciaba CBU/CUIL/legajo', () => {
    const pantalla = BASE.map(u => (u.auth_user_id ? parcial(u) : u)) // reemplazo viejo
    const form = formDesde(pantalla[0])
    expect(form.cuenta_bancaria).toBe('')
    expect(form.cuil).toBe('')
    // El guardado viejo mandaba todos los campos: cuil y cuenta como null.
    const viejo = { usuario_id: 'a', ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v])) }
    const payloadViejo: Record<string, unknown> = {}
    for (const k of TEXTO_OPC) payloadViejo[k] = (viejo as any)[k]
    expect(payloadViejo.cuenta_bancaria).toBeNull()
    expect(payloadViejo.cuil).toBeNull()
  })

  it('abrir Guardias y editar SÓLO el teléfono: viaja sólo el teléfono', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.telefono = '341999' })
    expect(r.cambios).toEqual({ telefono: '341999' })
    sinCambiosSalvo(BASE, r.base, 'a', { telefono: '341999' })
  })

  it('aun SIN releer la ficha (fila parcial en pantalla), editar el teléfono no vacía CBU, CUIL ni legajo', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.telefono = '341999' }, { conRelectura: false })
    expect(Object.keys(r.cambios)).toEqual(['telefono'])
    sinCambiosSalvo(BASE, r.base, 'a', { telefono: '341999' })
  })

  it('modificar un dato operativo (estado) no toca los demás', () => {
    const r = editarEnGuardias(BASE, 'b', f => { f.estado = 'inactivo' })
    expect(r.cambios).toEqual({ estado: 'inactivo' })
    sinCambiosSalvo(BASE, r.base, 'b', { estado: 'inactivo' })
  })

  it('cambiar el email (no existe columna domicilio en usuarios; el email es el dato de contacto equivalente)', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.email = '  ANA2@X.com ' })
    expect(r.cambios).toEqual({ email: 'ana2@x.com' })
    sinCambiosSalvo(BASE, r.base, 'a', { email: 'ana2@x.com' })
  })

  it('abrir una ficha con CBU y guardar sin tocarlo: no viaja nada y la base queda igual', () => {
    const r = editarEnGuardias(BASE, 'a', () => {})
    expect(r.cambios).toEqual({})
    expect(r.base).toEqual(BASE)
  })

  it('abrir una ficha con CUIL, cambiar otro campo y guardar: el CUIL se conserva', () => {
    const r = editarEnGuardias(BASE, 'b', f => { f.telefono = '341222' })
    expect(r.base.find(u => u.id === 'b')!.cuil).toBe('20302223334')
  })

  it('editar un empleado SIN legajo de Visual y cargárselo', () => {
    const r = editarEnGuardias(BASE, 'b', f => { f.legajo_visual = 'DOS' })
    expect(r.cambios).toEqual({ legajo_visual: 'DOS' })
    sinCambiosSalvo(BASE, r.base, 'b', { legajo_visual: 'DOS' })
  })

  it('editar un empleado CON legajo de Visual y cambiarlo', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.legajo_visual = 'UNO BIS' })
    sinCambiosSalvo(BASE, r.base, 'a', { legajo_visual: 'UNO BIS' })
  })

  it('vaciar A PROPÓSITO un CUIL en la ficha: viaja con confirmar_vaciar y se vacía', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.cuil = '' })
    expect(r.cambios).toEqual({ cuil: null })
    sinCambiosSalvo(BASE, r.base, 'a', { cuil: null })
  })

  it('pantalla después de una sincronización parcial: las filas conservan CBU/CUIL/legajo', () => {
    const pantalla = fusionarLista(BASE, BASE.filter(u => u.auth_user_id).map(parcial))
    expect(pantalla).toEqual(BASE)
  })

  it('una sincronización que devuelve MENOS empleados no hace desaparecer a los demás; los nuevos se agregan', () => {
    const nuevo = { id: 'd', nombre: 'Dani', apellido: 'Cuatro' } as U
    const pantalla = fusionarLista(BASE, [parcial(BASE[0]), nuevo])
    expect(pantalla.map(u => u.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(pantalla[1]).toEqual(BASE[1])
  })

  it('guardar con una respuesta incompleta del servidor: la fila en pantalla no pierde columnas', () => {
    const respuesta = { id: 'a', telefono: '341999' }
    expect(fusionarFila(BASE[0], respuesta)).toEqual({ ...BASE[0], telefono: '341999' })
    const sinCbu = { ...BASE[0] }; delete (sinCbu as any).cuenta_bancaria
    expect(fusionarFila(BASE[0], sinCbu).cuenta_bancaria).toBe('0123456789012')
  })

  it('SERVIDOR: un vacío sin confirmar sobre CBU/CUIL/legajo con valor se ignora (cliente viejo o fila parcial)', () => {
    const r = patch(BASE, { usuario_id: 'a', telefono: '341999', cuil: null, cuenta_bancaria: null, legajo_visual: '' }, true)
    expect(r.protegidos.sort()).toEqual(['cuenta_bancaria', 'cuil', 'legajo_visual'])
    sinCambiosSalvo(BASE, r.base, 'a', { telefono: '341999' })
  })

  it('SERVIDOR: el vacío sobre un campo que ya estaba vacío no se reporta ni molesta', () => {
    const r = patch(BASE, { usuario_id: 'c', cuil: null, telefono: '341000' }, true)
    expect(r.protegidos).toEqual([])
    sinCambiosSalvo(BASE, r.base, 'c', { telefono: '341000', cuil: null })
  })

  it('intentar modificar el CBU SIN capacidad económica (Administración): no viaja ni se escribe', () => {
    const r = editarEnGuardias(BASE, 'a', f => { f.cuenta_bancaria = '9999999999999'; f.telefono = '341777' }, { puedeEconomico: false })
    expect(r.cambios).toEqual({ telefono: '341777' })
    sinCambiosSalvo(BASE, r.base, 'a', { telefono: '341777' })
    // Y aunque un cliente manipulado lo mande, el servidor lo descarta sin ver_finanzas.
    const forzado = patch(BASE, { usuario_id: 'a', cuenta_bancaria: '9999999999999' }, false)
    expect(forzado.base).toEqual(BASE)
  })

  it('cambiosDeFormulario: booleanos, recortes y vaciados reservados', () => {
    const { cambios, vaciados } = cambiosDeFormulario(
      { a: ' x ', es_prueba: false, cuenta_bancaria: '123', telefono: '1' },
      { a: 'x', es_prueba: true, cuenta_bancaria: '  ', telefono: '' })
    expect(cambios).toEqual({ es_prueba: true, cuenta_bancaria: null, telefono: null })
    expect(vaciados).toEqual(['cuenta_bancaria'])
    expect(CAMPOS_RESERVADOS).toEqual(['cuenta_bancaria', 'cuil', 'legajo_visual'])
  })
})

describe('el código de la app usa la corrección', () => {
  const RAIZ = join(__dirname, '..')
  const app = readFileSync(join(RAIZ, 'app/dashboard/AppClient.tsx'), 'utf8')
  const sup = readFileSync(join(RAIZ, 'components/supervisor/SupervisorMobile.tsx'), 'utf8')
  const api = readFileSync(join(RAIZ, 'app/api/usuarios/route.ts'), 'utf8')

  it('ninguna respuesta de usuarios reemplaza la lista o la fila completa en Guardias', () => {
    expect(app).not.toMatch(/setGuardias\(data\.users\)/)
    expect(app).not.toMatch(/\? data\.user : x/)
    expect(app).not.toMatch(/actualizados\.get\(g\.id\) \|\| g/)
    expect(sup).not.toMatch(/\? data as Usuario : g/)
  })

  it('la edición en Guardias manda sólo cambios (y no el payload completo)', () => {
    expect(app).toMatch(/cambiosDeFormulario\(formOriginal/)
    expect(app).not.toMatch(/JSON\.stringify\(\{ usuario_id: editId, \.\.\.payload \}\)/)
    expect(sup).toMatch(/cambiosDeFormulario\(/)
  })

  it('el PATCH del servidor protege los campos reservados', () => {
    expect(api).toMatch(/protegerVaciadoReservado\(/)
  })
})
