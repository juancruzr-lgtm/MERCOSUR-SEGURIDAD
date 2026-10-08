/**
 * GET /api/estatuto/original?version=1
 *
 * El Word ORIGINAL del Estatuto Interno, sólo para Administración y Gerencia.
 * Ver lib/estatuto-original.ts.
 *
 * El permiso NO se decide acá: se pregunta a la base con el token de quien
 * llama (las mismas funciones que protegen los borradores del Estatuto). Un
 * vigilador recibe 403 aunque conozca la dirección; sin sesión, 401.
 *
 * Antes de entregarlo se compara la huella del archivo con la registrada para
 * esa versión: si no coinciden, no se entrega (el archivo que sale es,
 * comprobadamente, el que se registró).
 */

import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken } from '@/app/api/_lib/employee-auth'
import { nombreDescarga, rutaOriginal } from '@/lib/estatuto-original'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIN_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' }

const error = (status: number, mensaje: string) =>
  NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE })

export async function GET(req: NextRequest) {
  const identificador = req.nextUrl.searchParams.get('version') ?? ''
  const ruta = rutaOriginal(identificador)
  if (!ruta) return error(400, 'Versión inválida')

  const token = getBearerToken(req)
  if (!token) return error(401, 'Sesión requerida')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return error(500, 'Configuración incompleta')

  // Cliente con la identidad de quien llama: RLS y auth.uid() son los suyos.
  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: usuario, error: errUsuario } = await db.auth.getUser(token)
  if (errUsuario || !usuario?.user) return error(401, 'Sesión inválida')

  const [personal, gerencia] = await Promise.all([
    db.rpc('puede_gestionar_personal_actual'),
    db.rpc('puede_acceder_gerencia_actual'),
  ])
  if (personal.error || gerencia.error) return error(500, 'No se pudo verificar el permiso')
  if (personal.data !== true && gerencia.data !== true) {
    return error(403, 'El original del Estatuto es sólo para Administración y Gerencia')
  }

  // La versión tiene que existir para quien pide (RLS: Administración y
  // Gerencia ven también los borradores).
  const { data: version, error: errVersion } = await db
    .from('estatuto_versiones')
    .select('identificador, archivo_sha256')
    .eq('identificador', identificador)
    .maybeSingle()
  if (errVersion) return error(500, 'No se pudo leer la versión')
  if (!version) return error(404, 'Versión inexistente')

  let archivo: Buffer
  try {
    archivo = await readFile(join(process.cwd(), ruta))
  } catch {
    return error(404, 'Archivo no disponible')
  }

  const huella = createHash('sha256').update(archivo).digest('hex')
  if (huella !== version.archivo_sha256) {
    return error(409, 'El archivo no coincide con la huella registrada para esta versión')
  }

  return new NextResponse(new Uint8Array(archivo), {
    status: 200,
    headers: {
      ...SIN_CACHE,
      'Content-Type': 'application/msword',
      'Content-Disposition': `attachment; filename="${nombreDescarga(identificador)}"`,
      'Content-Length': String(archivo.length),
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
