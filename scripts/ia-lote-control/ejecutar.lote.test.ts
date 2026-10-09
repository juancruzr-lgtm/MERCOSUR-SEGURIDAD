// Lote de control de la IA — EJECUCIÓN (gasta cuota de Gemini: sólo con autorización).
//
// Se corre con el runner de pruebas (que ya resuelve TypeScript y los alias),
// y por defecto queda SALTEADO:
//
//   IA_LOTE_EJECUTAR=si IA_LOTE_MUESTRA=<muestra.json> IA_LOTE_SALIDA=<carpeta fuera del repo> \
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… GEMINI_API_KEY=… \
//   npx vitest run scripts/ia-lote-control/ejecutar.lote.test.ts
//
// Por cada foto: R1 (la guardada, hoy), R1' (otra vez, para medir la
// variación propia del modelo) y R2 (re-codificada con el perfil nuevo, en el
// navegador, igual que el celular). NO escribe nada en la base.

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { GeminiVision } from '@/lib/ia/gemini'
import { PERFIL_POR_TIPO, analizar, armarPedidoControl, compararLecturas, resumirLote } from '@/lib/ia/lote-control'
import type { ItemLote } from '@/lib/ia/lote-control'

const EJECUTAR = process.env.IA_LOTE_EJECUTAR === 'si'

describe.skipIf(!EJECUTAR)('Lote de control de la IA (con autorización)', () => {
  it('compara la foto guardada contra la re-codificada con el perfil nuevo', async () => {
    const muestra = JSON.parse(readFileSync(process.env.IA_LOTE_MUESTRA!, 'utf8')) as { analisis: { id: string; tipo: string }[] }
    const salida = process.env.IA_LOTE_SALIDA!
    mkdirSync(salida, { recursive: true })
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const proveedor = new GeminiVision()
    const { abrirNavegador } = await import('./reencodar-navegador.mjs')
    const nav = await abrirNavegador()
    const items: ItemLote[] = []
    const errores: { id: string; error: string }[] = []
    let tokens = { entrada: 0, salida: 0 }
    try {
      for (const m of muestra.analisis) {
        try {
          const p = await armarPedidoControl(db, m.id)
          const nuevo = await nav.reencodar(p.original.bytes, p.original.mime, PERFIL_POR_TIPO[p.tipo])
          const r1 = await analizar(proveedor, p, p.pedido.imagen)
          const r1b = await analizar(proveedor, p, p.pedido.imagen)
          const r2 = await analizar(proveedor, p, { bytes: nuevo.bytes, mime: 'image/jpeg' })
          for (const r of [r1, r1b, r2]) { tokens = { entrada: tokens.entrada + (r.tokensEntrada ?? 0), salida: tokens.salida + (r.tokensSalida ?? 0) } }
          items.push({
            analisisId: m.id, tipo: p.tipo, bytesOriginal: p.original.bytes.length, bytesNuevo: nuevo.bytes.length,
            compresion: compararLecturas(r1, r2), estabilidad: compararLecturas(r1, r1b),
          })
        } catch (e) {
          errores.push({ id: m.id, error: e instanceof Error ? e.message : String(e) })
        }
        await new Promise(r => setTimeout(r, 1500)) // no saturar la cuota
      }
    } finally {
      await nav.cerrar()
    }
    const resumen = resumirLote(items)
    writeFileSync(join(salida, 'lote-control-ia.json'), JSON.stringify({ generado_at: new Date().toISOString(), tokens, resumen, items, errores }, null, 2))
    console.log(JSON.stringify({ resumen, tokens, errores: errores.length }, null, 2))
    expect(items.length).toBeGreaterThan(0)
  }, 3 * 60 * 60 * 1000)
})
