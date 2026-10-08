'use client'

/**
 * app/estatuto/PaginaEstatuto.tsx
 *
 * Página propia del Estatuto Interno. La identidad sale de la sesión: no hay
 * id en la URL, así que nadie llega por acá a la constancia de otro.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import EstatutoInterno from '@/components/estatuto/EstatutoInterno'

export default function PaginaEstatuto() {
  const router = useRouter()
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const session = data?.session
      if (!session) { router.push('/dashboard'); return }
      const { data: perfil, error: e } = await supabase
        .from('usuarios')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .eq('estado', 'activo')
        .maybeSingle()
      if (!vigente) return
      if (e || !perfil) { setError('No se encontró tu usuario activo.'); return }
      setUsuarioId(perfil.id)
    })()
    return () => { vigente = false }
  }, [router])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#0f172a', borderBottom: '1px solid #1e2d42', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 12px', fontSize: 13 }}
        >
          ← Volver
        </button>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Estatuto Interno</div>
      </div>
      <div style={{ padding: '20px 16px' }}>
        {error && <div style={{ color: '#fca5a5', textAlign: 'center' }}>{error}</div>}
        {!error && !usuarioId && <div style={{ color: '#64748b', textAlign: 'center' }}>Cargando…</div>}
        {usuarioId && <EstatutoInterno empleadoId={usuarioId} esPropio />}
      </div>
    </div>
  )
}
