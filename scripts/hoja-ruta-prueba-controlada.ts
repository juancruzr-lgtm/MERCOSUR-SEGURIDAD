// Prueba controlada de la hoja de ruta con datos exportados (solo lectura).
// NO se conecta a ninguna base ni envía WhatsApp: lee un JSON con las tablas
// de un día (supervisores_guardia, usuarios, supervisiones,
// supervision_respuestas, checklist_items, objetivos, puntos) y muestra, por
// cada guardia, la hoja de la app, el mensaje exacto de WhatsApp, su longitud
// y si quedaría "pendiente por longitud".
//
// Uso: npx tsx scripts/hoja-ruta-prueba-controlada.ts <datos.json>
import { readFileSync } from 'fs'
import { armarHojaRuta, mensajeWhatsApp, textoHojaRuta, LIMITE_CUERPO_PLANTILLA } from '../lib/hoja-ruta'
import { cargarDatosHojaRuta, guardiaCubre, ventanaGuardia, type GuardiaSupervisorFila } from '../lib/hoja-ruta-datos'

const datos = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const tablas: Record<string, any[]> = { ...datos }

function db() {
  const q = (rows: any[]) => {
    let r = [...(rows ?? [])]
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => { r = r.filter(x => x[c] === v); return b },
      in: (c: string, vs: any[]) => { r = r.filter(x => vs.includes(x[c])); return b },
      gte: (c: string, v: any) => { r = r.filter(x => new Date(x[c]).getTime() >= new Date(v).getTime()); return b },
      lte: (c: string, v: any) => { r = r.filter(x => new Date(x[c]).getTime() <= new Date(v).getTime()); return b },
      order: (c: string) => { r.sort((a, z) => (a[c] < z[c] ? -1 : 1)); return b },
      then: (ok: any) => Promise.resolve({ data: r, error: null }).then(ok),
    }
    return b
  }
  return {
    from: (t: string) => q(tablas[t]),
    rpc: (_n: string, a: any) => Promise.resolve({
      data: (tablas.puntos ?? []).filter(p => p.guardia === a.p_guardia_id)
        .map(p => ({ ...p, ts: new Date(p.ts).toISOString() })), error: null,
    }),
  }
}

async function main() {
  // Las fechas de la base vienen con +00:00; se normalizan a ISO como en Supabase.
  for (const s of tablas.supervisiones ?? []) s.created_at = new Date(s.created_at).toISOString()
  for (const r of tablas.supervision_respuestas ?? []) r.created_at = new Date(r.created_at).toISOString()
  const guardias = (tablas.supervisores_guardia ?? []) as GuardiaSupervisorFila[]
  for (const g of guardias.filter(guardiaCubre)) {
    const c = armarHojaRuta(await cargarDatosHojaRuta(db(), g))
    const m = mensajeWhatsApp(c)
    const v = ventanaGuardia(g)
    console.log('='.repeat(72))
    console.log(`Guardia ${g.id} · ${v.inicio} → ${v.fin} · se generaría 30 min después del fin`)
    console.log(`Visitas: ${c.recorrido.length} (${c.recorrido.filter(x => x.fuente !== 'supervision').length} con GPS) · novedades: ${c.recorrido.reduce((n, x) => n + x.novedades.length, 0)}`)
    console.log(`WhatsApp: ${m.longitud} caracteres de ${LIMITE_CUERPO_PLANTILLA} → ${m.bloqueado ? 'PENDIENTE POR LONGITUD (no se envía)' : 'se enviaría un único mensaje'}`)
    console.log('--- Hoja en la app ---')
    console.log(textoHojaRuta(c))
    console.log('--- Mensaje exacto de WhatsApp ---')
    console.log(m.mensaje)
  }
}
void main()
