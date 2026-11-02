// lib/ia/cron-auth.ts
//
// Autenticación del cron de IA (/api/ia/cron). pg_cron llama con
// `Authorization: Bearer <secreto>`; el secreto vive en Vercel como
// IA_CRON_SECRET y, del lado de la base, en Supabase Vault (ver
// supabase/migrations/20261120140000_ia_cron_secret_vault.sql).
//
// Rotación sin cortar el cron: se carga el nuevo en IA_CRON_SECRET, el viejo
// en IA_CRON_SECRET_ANTERIOR, se actualiza el Vault, y cuando las llamadas ya
// llegan con el nuevo se borra IA_CRON_SECRET_ANTERIOR. Pasos completos en
// docs/auditoria-2026-10/regla_validacion.md.

import { timingSafeEqual } from 'crypto'

/** Claves de app_config que NUNCA se leen desde el código de la app. */
export const CLAVES_SECRETAS_APP_CONFIG = ['ia_cron_secret'] as const

type Entorno = Record<string, string | undefined>

function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Secretos aceptados hoy, en orden: actual (o CRON_SECRET) y el anterior durante una rotación. */
export function secretosAceptados(env: Entorno): string[] {
  const actual = (env.IA_CRON_SECRET || env.CRON_SECRET || '').trim()
  const anterior = (env.IA_CRON_SECRET_ANTERIOR || '').trim()
  return [actual, anterior].filter(s => s.length > 0)
}

export function autorizadoCronIA(header: string | null | undefined, env: Entorno): boolean {
  if (!header || !header.startsWith('Bearer ')) return false
  const recibido = header.slice('Bearer '.length)
  if (!recibido) return false
  return secretosAceptados(env).some(s => igualSeguro(recibido, s))
}
