// lib/afip/ta-store-supabase.ts
//
// TAStore respaldado en Supabase (tabla afip_ta_cache). Persiste el Ticket de
// Acceso de WSAA entre invocaciones serverless para no pedir uno nuevo cada vez
// (WSAA rechaza reemitir mientras el TA siga vigente). Se usa con service_role.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AfipTA, TAStore } from '@/lib/afip/wsaa'

export function taStoreSupabase(admin: SupabaseClient): TAStore {
  return {
    async get(servicio: string): Promise<AfipTA | null> {
      const { data, error } = await admin
        .from('afip_ta_cache')
        .select('token, sign, expira')
        .eq('servicio', servicio)
        .maybeSingle()
      if (error || !data) return null
      return { token: data.token as string, sign: data.sign as string, expira: Date.parse(data.expira as string) }
    },
    async set(servicio: string, ta: AfipTA): Promise<void> {
      await admin.from('afip_ta_cache').upsert({
        servicio,
        token: ta.token,
        sign: ta.sign,
        expira: new Date(ta.expira).toISOString(),
        actualizado: new Date().toISOString(),
      })
    },
  }
}
