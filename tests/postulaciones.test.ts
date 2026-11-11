/**
 * Alta de vigiladores — circuito de postulaciones (PR 2).
 * Las reglas de la base se prueban con PGlite en scripts/sql-pruebas/pr2-postulaciones.mjs;
 * acá: validaciones del cliente (espejo de la base), archivos y contratos de las rutas.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAMPOS, CAMPOS_SELECCION, cuilCoincideConDni, cuilValido, dniEnmascarado, dniValido, edadEn,
  emailValido, errorCampo, faltantes, normalizarParaGuardar,
} from '@/lib/postulantes'
import { tipoPorFirma, validarArchivoSolicitud, MAX_BYTES_SOLICITUD } from '@/app/api/_lib/archivo-solicitud'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
// CUIL ficticio válido: calcula el dígito con la regla de ARCA
const conDv = (c: string) => { const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }

describe('validaciones (espejo de la base)', () => {
  it('DNI de 7 u 8 dígitos, con o sin puntos', () => {
    expect(dniValido('40.999.888')).toBe(true)
    expect(dniValido('4099988')).toBe(true)
    expect(dniValido('409998')).toBe(false)
    expect(dniValido('409998881')).toBe(false)
  })
  it('CUIL: dígito verificador con la regla de ARCA y coherencia con el DNI', () => {
    const cuil = conDv('2040999888')
    expect(cuilValido(cuil)).toBe(true)
    expect(cuilValido(`20-40999888-${cuil[10]}`)).toBe(true)
    expect(cuilValido('20409998880'.slice(0, 10) + ((+cuil[10] + 1) % 10))).toBe(false)
    expect(cuilCoincideConDni(cuil, '40999888')).toBe(true)
    expect(cuilCoincideConDni(cuil, '40999887')).toBe(false)
    expect(cuilCoincideConDni(conDv('2004999888'), '4999888')).toBe(true) // DNI de 7 dígitos
  })
  it('email y fecha de nacimiento', () => {
    expect(emailValido('postulante@example.test')).toBe(true)
    expect(emailValido('sin arroba')).toBe(false)
    expect(edadEn('2000-06-15', new Date(2026, 5, 14))).toBe(25)
    expect(edadEn('2000-06-15', new Date(2026, 5, 15))).toBe(26)
  })
  it('errores por campo: lo que la persona ve en la ficha', () => {
    expect(errorCampo('dni', '123')).toMatch(/7 u 8/)
    expect(errorCampo('cuil', conDv('2040999888'), { dni: '30111222' })).toMatch(/no corresponde/)
    expect(errorCampo('telefono', '15 3769 412')).toMatch(/característica/) // el "15" sin área del papel
    expect(errorCampo('telefono', '0341 15-555-1234')).toBeNull()
    expect(errorCampo('fecha_nacimiento', '2015-01-01')).toMatch(/menor/)
    expect(errorCampo('domicilio_cp', '2000')).toBeNull()
    expect(errorCampo('domicilio_cp', 'S2000ABC')).toBeNull()
    expect(errorCampo('nombre', '')).toBeNull() // vacío no es error de formato
  })
  it('normaliza antes de guardar: dígitos, E.164 y minúsculas', () => {
    expect(normalizarParaGuardar({ dni: '40.999.888', cuil: '20-40999888-1', telefono: '0341 15-555-1234', email: ' Ana@Example.TEST ', apellido: '  ' }))
      .toEqual({ dni: '40999888', cuil: '20409998881', telefono: '5493415551234', email: 'ana@example.test', apellido: null })
  })
  it('faltantes: revisar no exige email; aprobar sí', () => {
    const p = { apellido: 'A', nombre: 'B', dni: '1', cuil: '2', fecha_nacimiento: '1990-01-01', telefono: '3', domicilio_calle: 'c', domicilio_localidad: 'l', domicilio_provincia: 'p' }
    expect(faltantes(p, 'revisar')).toEqual([])
    expect(faltantes(p, 'aprobar')).toEqual(['email'])
  })
  it('en listados el DNI no se muestra entero', () => {
    expect(dniEnmascarado('40999888')).toBe('••• 888')
    expect(dniEnmascarado(null)).toBe('—')
  })
})

describe('minimización: no hay lugar para datos sensibles', () => {
  const sql = leer('supabase/migrations/20261208110000_postulaciones.sql')
  const tabla = sql.slice(sql.indexOf('create table if not exists public.postulaciones ('), sql.indexOf('-- Una sola postulación abierta'))
  it.each(['salud', 'enfermedad', 'medicacion', 'sanguineo', 'causas', 'antecedentes', 'armas', 'padre', 'madre', 'fuma'])('la tabla no tiene columna "%s"', palabra => {
    expect(tabla.toLowerCase()).not.toContain(palabra)
  })
  it('el catálogo del cliente tampoco los ofrece', () => {
    const todos = [...CAMPOS.map(c => c.campo), ...CAMPOS_SELECCION.map(c => c.campo)].join(' ')
    expect(todos).not.toMatch(/salud|enfermedad|medicacion|sangu|causa|antecedente|arma|padre|madre|fuma/)
  })
  it('los datos de selección permitidos coinciden con la base', () => {
    const lista = /array\['estado_civil'[\s\S]*?'dni_buen_estado'\]/.exec(sql)?.[0] ?? ''
    for (const c of CAMPOS_SELECCION) expect(lista).toContain(`'${c.campo}'`)
  })
})

describe('archivo de la solicitud', () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)])
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(100)])
  it('reconoce el tipo por los bytes, no por el nombre', () => {
    expect(tipoPorFirma(new Uint8Array(jpg.subarray(0, 16)))?.ext).toBe('jpg')
    expect(tipoPorFirma(new Uint8Array(pdf.subarray(0, 16)))?.ext).toBe('pdf')
    expect(tipoPorFirma(new Uint8Array(Buffer.from('<html><script>alert(1)</script>')))).toBeNull()
  })
  it('rechaza vacío, demasiado grande y formatos no admitidos', () => {
    expect(validarArchivoSolicitud(Buffer.alloc(0))).toMatchObject({ ok: false, status: 400 })
    expect(validarArchivoSolicitud(Buffer.concat([jpg, Buffer.alloc(MAX_BYTES_SOLICITUD)]))).toMatchObject({ ok: false, status: 413 })
    expect(validarArchivoSolicitud(Buffer.from('texto plano cualquiera'))).toMatchObject({ ok: false, status: 415 })
  })
  it('calcula la huella para no cargar dos veces la misma imagen', () => {
    const v = validarArchivoSolicitud(jpg)
    expect('sha256' in v ? v.sha256 : '').toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('rutas: la base autoriza antes de tocar Storage o Auth', () => {
  it('archivo: primero la RPC con la sesión del usuario, después la subida con service_role', () => {
    const r = leer('app/api/postulaciones/archivo/route.ts')
    expect(r.indexOf("rpc('postulacion_registrar_archivo'")).toBeGreaterThan(-1)
    expect(r.indexOf("rpc('postulacion_registrar_archivo'")).toBeLessThan(r.indexOf('.upload('))
    expect(r).toMatch(/delete\(\)\.eq\('id', archivoId\)/) // si falla la subida, no queda registro huérfano
    expect(r.indexOf("rpc('postulacion_abrir_archivo'")).toBeLessThan(r.indexOf('createSignedUrl'))
    expect(r).toMatch(/FIRMA_SEGUNDOS = 60/)
  })
  it('alta: crea el empleado en la base y después su acceso con DNI y cambio obligatorio (sin emails)', () => {
    const r = leer('app/api/postulaciones/[id]/alta/route.ts')
    expect(r.indexOf("rpc('postulacion_alta_efectiva'")).toBeLessThan(r.indexOf('ensureEmployeeAuth(admin.client'))
    expect(r).toMatch(/ensureEmployeeAuth\(admin\.client, empleado, \{ conservarPassword: true \}\)/)
    expect(r).toMatch(/if \(r\.action === 'creado'\) \{\s*const m = await marcarCambioObligatorio\(admin\.client, empleado\.id, 'alta', acceso\.perfil\.id\)/)
    // Reintento con la cuenta ya creada: no la toca.
    expect(r.indexOf("acceso: 'ya_tenia'")).toBeLessThan(r.indexOf('ensureEmployeeAuth(admin.client'))
    expect(r).not.toMatch(/inviteUserByEmail|invitarEmpleado|resetPasswordForEmail/)
  })
  it('el bucket no tiene políticas de Storage (sólo el servidor lo usa)', () => {
    const sql = leer('supabase/migrations/20261208110000_postulaciones.sql')
    expect(sql).not.toMatch(/on storage\.objects/)
    expect(sql).toMatch(/values \('postulaciones', 'postulaciones', false/)
  })
})

describe('completar el legajo de alguien que ya es empleado (JC 11/11)', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const sql = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/migrations/20261211110000_postulacion_completar_legajo.sql'), 'utf8')
  it('sólo Administración/Gerencia, coincidencia por DNI o CUIL y sin pisar datos', () => {
    expect(sql).toMatch(/postulacion_gestiona\(\)/)
    expect(sql).toMatch(/no coincide por DNI ni CUIL/)
    expect(sql).toMatch(/'solicitud_empleo', 'pendiente'/)
    expect(sql).toMatch(/revoke all on function public\.postulacion_completar_legajo\(uuid, uuid\) from public, anon/)
  })
  it('el email del empleado sólo se carga si está vacío', () => {
    expect(sql).toMatch(/v\.email is not null and nullif\(btrim\(coalesce\(u\.email, ''\)\), ''\) is null/)
  })
})
