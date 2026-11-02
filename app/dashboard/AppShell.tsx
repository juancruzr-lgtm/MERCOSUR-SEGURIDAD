'use client'

/**
 * app/dashboard/AppShell.tsx
 *
 * Arranque liviano de /dashboard. Resuelve sesión, perfil y delegación (lo
 * mismo que hacía AppClient al montar) y recién entonces baja el shell que
 * corresponde al rol:
 *
 *   guardia    → GuardiaMobile    (chunk propio)
 *   supervisor → SupervisorMobile (chunk propio)
 *   admin      → AppClient        (bundle de administración, ~14k líneas)
 *
 * Antes la página importaba AppClient entero y el vigilador descargaba todo
 * el bundle de administración (≈1,7 MB sin comprimir) para usar sólo
 * GuardiaMobile. La decisión de shell es la misma función (shellDeUsuario) y
 * con los mismos datos, así que la conducta no cambia.
 *
 * AppClient conserva su propio login y sus ramas de guardia/supervisor: si un
 * admin cierra sesión y entra otra persona desde ese login, sigue funcionando
 * igual que antes.
 */

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { shellDeUsuario } from '@/lib/capacidades'
import Login, { perfilDeSesionActual, resolverDelegacionGerencia } from './Login'

const Cargando = () => (
  <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', color:'#64748b', fontFamily:'sans-serif' }}>
    Cargando...
  </div>
)

const GuardiaMobile = dynamic(() => import('@/components/guardia/GuardiaMobile'), { ssr: false, loading: Cargando })
const SupervisorMobile = dynamic(() => import('@/components/supervisor/SupervisorMobile'), { ssr: false, loading: Cargando })
const AppClient = dynamic(() => import('./AppClient'), { ssr: false, loading: Cargando })

type Estado =
  | { fase: 'cargando' }
  | { fase: 'login' }
  | { fase: 'listo'; perfil: any }

export default function AppShell() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })

  const entrar = useCallback(async (perfilBase: any) => {
    const perfil = await resolverDelegacionGerencia(perfilBase)
    setEstado({ fase: 'listo', perfil })
  }, [])

  useEffect(() => {
    let vivo = true
    void perfilDeSesionActual().then(async perfil => {
      if (!vivo) return
      if (!perfil) { setEstado({ fase: 'login' }); return }
      await entrar(perfil)
    })
    return () => { vivo = false }
  }, [entrar])

  if (estado.fase === 'cargando') return <Cargando />
  if (estado.fase === 'login') return <Login onLogin={u => { void entrar(u) }} />

  const perfil = estado.perfil
  const shell = shellDeUsuario(perfil)

  if (shell === 'denegado') {
    return (
      <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, color:'#64748b', background:'#0a0e1a', padding:24, textAlign:'center' }}>
        <div style={{ fontSize:40 }}>🔒</div>
        <div style={{ fontSize:18, color:'#e2e8f0' }}>Tu cuenta no tiene un puesto operativo asignado.</div>
        <div style={{ maxWidth:420 }}>Pedile a Administración que te asigne un puesto para poder usar el sistema.</div>
      </div>
    )
  }
  if (shell === 'guardia') return <GuardiaMobile user={perfil} />
  if (shell === 'supervisor') return <SupervisorMobile user={perfil} />
  return <AppClient perfilInicial={perfil} />
}
