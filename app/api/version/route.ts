import { NextResponse } from 'next/server'

// Versión publicada (la misma que lleva cada copia de la app en NEXT_PUBLIC_APP_VERSION).
// La usa lib/version-app.ts para que una copia vieja se recargue antes de consultar
// la base. Pública y sin datos: sólo la versión. Sin caché en ningún nivel.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
