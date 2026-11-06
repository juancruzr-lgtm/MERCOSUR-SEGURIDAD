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
import { supabase } from '@/lib/supabase'
import { enlaceFueInvitacion, limpiarRecuperacionPendiente, recuperacionPendientePara, tomarErrorEnlace } from '@/lib/auth-recuperacion'
import { exigenciaCambioDni, limpiarPasswordDni, passwordDniPendientePara, politicaCambioDni, posponerPasswordDni } from '@/lib/acceso-password-dni'
import NuevaPassword from '@/components/auth/NuevaPassword'
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
  | { fase: 'login'; error?: string | null }
  | { fase: 'recuperacion' }
  | { fase: 'avisoEnlace'; perfil: any; error: string }
  | { fase: 'cambioDni'; perfil: any; obligatorio: boolean }
  | { fase: 'listo'; perfil: any }

export default function AppShell() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })

  const entrar = useCallback(async (perfilBase: any) => {
    const perfil = await resolverDelegacionGerencia(perfilBase)
    // Entró con la contraseña inicial (DNI): según la política vigente se le
    // pide una propia antes de entrar (lib/acceso-password-dni.ts).
    const exigencia = exigenciaCambioDni(politicaCambioDni(), shellDeUsuario(perfil))
    if (exigencia !== 'no') {
      const { data } = await supabase.auth.getSession()
      if (passwordDniPendientePara(data.session?.access_token, exigencia)) {
        setEstado({ fase: 'cambioDni', perfil, obligatorio: exigencia === 'obligatorio' })
        return
      }
    }
    setEstado({ fase: 'listo', perfil })
  }, [])

  const arrancar = useCallback(async (vivo: () => boolean = () => true) => {
    // getSession espera a que supabase-js procese el enlace de la URL.
    const { data } = await supabase.auth.getSession()
    if (!vivo()) return
    const errorEnlace = tomarErrorEnlace()
    // Barrera de interfaz (no de servidor): la sesión abierta por un enlace de
    // recuperación válido no entra al panel hasta fijar la contraseña nueva.
    if (data.session && recuperacionPendientePara(data.session.access_token)) {
      setEstado({ fase: 'recuperacion' })
      return
    }
    const perfil = await perfilDeSesionActual()
    if (!vivo()) return
    if (!perfil) { setEstado({ fase: 'login', error: errorEnlace }); return }
    // Enlace vencido/usado con una sesión previa abierta: Supabase conserva esa
    // sesión. Se avisa en vez de entrar en silencio como si el enlace funcionara.
    if (errorEnlace) { setEstado({ fase: 'avisoEnlace', perfil, error: errorEnlace }); return }
    await entrar(perfil)
  }, [entrar])

  useEffect(() => {
    let vivo = true
    void arrancar(() => vivo)
    return () => { vivo = false }
  }, [arrancar])

  const cancelarRecuperacion = useCallback(async () => {
    limpiarRecuperacionPendiente()
    await supabase.auth.signOut()
    setEstado({ fase: 'login' })
  }, [])

  if (estado.fase === 'cargando') return <Cargando />
  if (estado.fase === 'login') return <Login errorInicial={estado.error} onLogin={u => { void entrar(u) }} />
  if (estado.fase === 'avisoEnlace') {
    const { perfil, error } = estado
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', padding:24, fontFamily:'sans-serif' }}>
        <div role="alert" style={{ width:'100%', maxWidth:420, background:'#111827', border:'1px solid #334155', borderRadius:16, padding:28 }}>
          <div style={{ fontSize:20, fontWeight:800, color:'#f8fafc', marginBottom:8 }}>El enlace no se pudo usar</div>
          <div style={{ fontSize:13, color:'#fca5a5', marginBottom:12 }}>{error}</div>
          <div style={{ fontSize:13, color:'#94a3b8', marginBottom:20 }}>Tu contraseña no cambió. Ya tenías una sesión abierta como {perfil?.nombre} {perfil?.apellido}.</div>
          <button type="button" onClick={() => { void entrar(perfil) }} style={{ width:'100%', padding:'11px 16px', borderRadius:8, border:'none', background:'#eab308', color:'#0a0e1a', fontWeight:800, fontSize:14, cursor:'pointer' }}>Continuar con mi sesión</button>
          <button type="button" onClick={() => { void cancelarRecuperacion() }} style={{ width:'100%', padding:'10px 16px', borderRadius:8, border:'1px solid #334155', background:'transparent', color:'#e2e8f0', fontWeight:700, fontSize:13, cursor:'pointer', marginTop:10 }}>Cerrar sesión</button>
        </div>
      </div>
    )
  }
  if (estado.fase === 'recuperacion') {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', padding:24, fontFamily:'sans-serif' }}>
        <div style={{ width:'100%', maxWidth:420, background:'#111827', border:'1px solid #334155', borderRadius:16, padding:28 }}>
          <div style={{ fontSize:20, fontWeight:800, color:'#f8fafc', marginBottom:8 }}>
            {enlaceFueInvitacion() ? 'Bienvenido/a a Mercosur Seguridad' : 'Crear contraseña nueva'}
          </div>
          <div style={{ fontSize:13, color:'#94a3b8', marginBottom:20 }}>
            {enlaceFueInvitacion()
              ? 'Para activar tu acceso, elegí tu contraseña personal. No la compartas con nadie: vas a usarla con tu email para ingresar.'
              : 'Para terminar la recuperación, elegí tu contraseña nueva. Vas a usarla desde ahora para ingresar.'}
          </div>
          <NuevaPassword
            textoBoton="Guardar y entrar"
            textoCancelar="Cancelar y volver al inicio"
            onCancelar={() => { void cancelarRecuperacion() }}
            onListo={() => {
              limpiarRecuperacionPendiente()
              limpiarPasswordDni()
              setEstado({ fase: 'cargando' })
              void arrancar()
            }}
          />
        </div>
      </div>
    )
  }
  if (estado.fase === 'cambioDni') {
    const { perfil, obligatorio } = estado
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a', padding:24, fontFamily:'sans-serif' }}>
        <div role="dialog" aria-labelledby="cambio-dni-titulo" style={{ width:'100%', maxWidth:420, background:'#111827', border:'1px solid #334155', borderRadius:16, padding:28 }}>
          <div id="cambio-dni-titulo" style={{ fontSize:20, fontWeight:800, color:'#f8fafc', marginBottom:8 }}>Elegí tu contraseña personal</div>
          <div style={{ fontSize:13, color:'#94a3b8', marginBottom:20 }}>
            Tu contraseña actual es tu número de DNI, un dato que conocen muchas personas.
            Para proteger tu cuenta, elegí una contraseña propia. Tu email para ingresar no cambia.
          </div>
          <NuevaPassword
            dni={perfil?.dni}
            textoBoton="Guardar y entrar"
            textoCancelar={obligatorio ? 'Cerrar sesión' : 'Ahora no'}
            onCancelar={() => {
              if (obligatorio) { limpiarPasswordDni(); void cancelarRecuperacion(); return }
              posponerPasswordDni()
              setEstado({ fase: 'listo', perfil })
            }}
            onListo={() => {
              limpiarPasswordDni()
              setEstado({ fase: 'listo', perfil })
            }}
          />
        </div>
      </div>
    )
  }

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
