/**
 * lib/acceso-password-dni.ts
 *
 * Migración de las cuentas que todavía entran con la contraseña inicial = DNI
 * (auditoría 06/11/2026: 66 de 70 cuentas activas).
 *
 * Cómo se detecta SIN guardar ni enviar la contraseña: en el login, el
 * navegador ya tiene lo que la persona escribió y su DNI (viene en el perfil).
 * Si coinciden, se marca la SESIÓN (por su session_id, en sessionStorage) y
 * AppShell pide la contraseña nueva antes de entrar. Nada sale del equipo.
 *
 * Política por variable NEXT_PUBLIC_CAMBIO_PASSWORD_DNI (se fija en Vercel):
 *   off         (por defecto) no se pide nada: la conducta no cambia.
 *   estructura  obligatorio para Supervisión, Administración y Gerencia;
 *               a los vigiladores no se les pide todavía.
 *   todos       obligatorio para la estructura; al vigilador se le pide con
 *               "Ahora no" (no se le corta el acceso: puede fichar igual).
 *
 * Es una barrera de interfaz: la contraseña DNI sigue siendo válida en el
 * servidor hasta que la persona la cambia. Por eso se combina con la
 * invitación (cuentas nuevas sin contraseña DNI) y con la consulta de
 * seguimiento docs/consultas/cuentas_password_dni.sql
 * (plan completo: docs/seguridad/ACCESOS-SIN-PASSWORD-DNI.md).
 */
import { sessionIdDe } from './auth-recuperacion'

export type PoliticaCambioDni = 'off' | 'estructura' | 'todos'
export type ExigenciaCambioDni = 'no' | 'obligatorio' | 'sugerido'

export const CLAVE_PASSWORD_DNI = 'ms_password_dni'
export const CLAVE_PASSWORD_DNI_POSPUESTO = 'ms_password_dni_pospuesto'

export function politicaCambioDni(valor: string | undefined = process.env.NEXT_PUBLIC_CAMBIO_PASSWORD_DNI): PoliticaCambioDni {
  const v = String(valor || '').trim().toLowerCase()
  return v === 'estructura' || v === 'todos' ? v : 'off'
}

const soloDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

/** ¿La contraseña escrita es el DNI (con o sin puntos/espacios)? */
export function passwordEsDni(password: string | null | undefined, dni: string | null | undefined): boolean {
  const d = soloDigitos(dni)
  if (d.length < 6) return false
  const p = String(password ?? '').trim()
  if (!p) return false
  return p === String(dni ?? '').trim() || p.replace(/[\s.]/g, '') === d
}

/** shell = resultado de shellDeUsuario(perfil): 'guardia' es el vigilador. */
export function exigenciaCambioDni(politica: PoliticaCambioDni, shell: string): ExigenciaCambioDni {
  if (politica === 'off' || shell === 'denegado') return 'no'
  if (shell !== 'guardia') return 'obligatorio'
  return politica === 'todos' ? 'sugerido' : 'no'
}

function sesionStorage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null } catch { return null }
}

let enMemoria: string | null = null

/** Lo llama el login cuando la contraseña escrita fue el DNI. */
export function marcarPasswordDni(accessToken: string | null | undefined): void {
  const sid = sessionIdDe(accessToken)
  if (!sid) return
  enMemoria = sid
  try { sesionStorage()?.setItem(CLAVE_PASSWORD_DNI, sid) } catch { /* queda en memoria */ }
}

export function limpiarPasswordDni(): void {
  enMemoria = null
  try {
    sesionStorage()?.removeItem(CLAVE_PASSWORD_DNI)
    sesionStorage()?.removeItem(CLAVE_PASSWORD_DNI_POSPUESTO)
  } catch { /* noop */ }
}

/** "Ahora no" del vigilador: no se vuelve a pedir en esta sesión del navegador. */
export function posponerPasswordDni(): void {
  try { sesionStorage()?.setItem(CLAVE_PASSWORD_DNI_POSPUESTO, '1') } catch { /* noop */ }
}

/** ¿La sesión actual entró con la contraseña DNI y no lo resolvió todavía? */
export function passwordDniPendientePara(accessToken: string | null | undefined, exigencia: ExigenciaCambioDni): boolean {
  if (exigencia === 'no') return false
  const sid = sessionIdDe(accessToken)
  if (!sid) return false
  let guardada = enMemoria
  try { guardada = sesionStorage()?.getItem(CLAVE_PASSWORD_DNI) ?? enMemoria } catch { /* noop */ }
  if (!guardada || guardada !== sid) return false
  if (exigencia === 'sugerido') {
    try { if (sesionStorage()?.getItem(CLAVE_PASSWORD_DNI_POSPUESTO) === '1') return false } catch { /* noop */ }
  }
  return true
}
