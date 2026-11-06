'use client'

/**
 * app/dashboard/Login.tsx
 *
 * Pantalla de inicio de sesión y verificación de baja laboral. Sale de
 * AppClient para que el arranque de /dashboard (AppShell) no tenga que bajar
 * el bundle de administración sólo para mostrar el login o decidir el shell.
 * El contenido es el mismo que vivía en AppClient (sin cambios de conducta).
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeErrorAuth, validarCredencialesLogin, validarEmail } from '@/lib/auth-mensajes'
import { limpiarRecuperacionPendiente } from '@/lib/auth-recuperacion'
import { limpiarPasswordDni, marcarPasswordDni, passwordEsDni } from '@/lib/acceso-password-dni'
import { alpha, FONT_BRAND } from '@/components/ui/base'
import { brandAssets, brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import { COLUMNAS_USUARIO } from '@/lib/usuarios-columnas'

const FONT_BODY = `${brandTypography.currentBody}, sans-serif`

// Subconjunto de los estilos S de AppClient que usa el login (mismos valores).
const S: Record<string, React.CSSProperties> = {
  btn: { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:8, fontSize:13, fontWeight:800, cursor:'pointer', border:'none', fontFamily:FONT_BRAND, transition:'background .15s ease, border-color .15s ease, color .15s ease' },
  btnSecondary: { background:alpha(brandColors.surface2, 0.88), color:brandColors.text, border:`1px solid ${brandColors.border}` },
  input: { width:'100%', background:alpha(brandColors.surface2, 0.9), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:'10px 14px', color:brandColors.text, fontSize:14, fontFamily:FONT_BODY, outline:'none' },
  label: { display:'block', fontSize:12, color:brandColors.muted, marginBottom:6, fontWeight:800, textTransform:'uppercase' as const, letterSpacing:0.5, fontFamily:FONT_BRAND },
}

// Baja laboral confirmada = acceso bloqueado (migración 20261110120000). La base
// ya no le deja leer ni escribir nada; esto sólo muestra un mensaje claro y
// cierra la sesión. Si la función todavía no existe (migración sin aplicar), no bloquea.
export async function accesoBloqueadoPorBaja(): Promise<boolean> {
  const { data, error } = await supabase.rpc('mi_acceso_estado')
  if (error) return false
  return Boolean((data as { bloqueado?: boolean } | null)?.bloqueado)
}
export const MENSAJE_ACCESO_BLOQUEADO = 'Tu acceso a la app está deshabilitado por una baja laboral. Si es un error, consultá con Administración.'

// Delegación gerencial (Fase 2D): resuelve la vigencia (desde/hasta/revocada)
// en la base y la adjunta como booleano al perfil, para que capacidadesDe sume
// el acceso gerencial completo mientras esté activa. No cambia puesto/rol.
// Si falla, queda sin delegación (fail-closed).
export async function resolverDelegacionGerencia<T extends object>(perfilBase: T): Promise<T & { acceso_gerencia_delegado?: boolean }> {
  try {
    const { data: delegado } = await supabase.rpc('tiene_delegacion_gerencia_actual')
    return { ...perfilBase, acceso_gerencia_delegado: delegado === true }
  } catch {
    return perfilBase
  }
}

// Sesión guardada → perfil. Sin sesión: null. Con baja laboral o sin perfil:
// cierra la sesión y devuelve null (el llamador muestra el login). Es el mismo
// arranque que tenía AppClient; ahora lo comparten AppShell y AppClient.
export async function perfilDeSesionActual(): Promise<any | null> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return null

  if (await accesoBloqueadoPorBaja()) {
    await supabase.auth.signOut()
    return null
  }

  const { data: perfil, error } = await supabase
    .from('usuarios')
    .select(COLUMNAS_USUARIO)
    .eq('auth_user_id', data.session.user.id)
    .single()

  if (error || !perfil) {
    await supabase.auth.signOut()
    return null
  }
  return perfil
}

export default function Login({ onLogin, errorInicial }: { onLogin: (u: any) => void; errorInicial?: string | null }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState(errorInicial || '')
  const [resetMsg, setResetMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // Baja laboral: la cuenta queda con ban en Supabase Auth.
  const mensajeError = (authError: unknown, accion: string) => {
    const raw = typeof authError === 'object' && authError && 'message' in authError ? String((authError as { message: unknown }).message) : ''
    return /banned/i.test(raw) ? MENSAJE_ACCESO_BLOQUEADO : mensajeErrorAuth(authError, accion)
  }

  const login = async () => {
    const emailLogin = email.trim().toLowerCase()
    const passwordLogin = pass.trim()

    setError('')
    setResetMsg('')
    const invalido = validarCredencialesLogin(emailLogin, passwordLogin)
    if (invalido) {
      setError(invalido)
      return
    }

    setLoading(true)

    // Acá había tres console.log de depuración —el email, el error y `data`—.
    // El último es el grave: `data` es la respuesta completa de
    // `signInWithPassword`, o sea `session.access_token` y
    // `session.refresh_token` impresos en la consola del navegador, en
    // producción, en cada inicio de sesión de cada vigilador. El error ya se
    // le muestra al usuario con `mensajeErrorAuth`; los tres no hacían falta.
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data']
    let err: unknown
    try {
      ({ data, error: err } = await supabase.auth.signInWithPassword({
        email: emailLogin,
        password: passwordLogin,
      }))
    } catch (e) {
      err = e
      data = { user: null, session: null }
    }

    if (err || !data.user) {
      setError(mensajeError(err, 'inicio de sesión'))
      setLoading(false)
      return
    }

    if (await accesoBloqueadoPorBaja()) {
      await supabase.auth.signOut()
      setError(MENSAJE_ACCESO_BLOQUEADO)
      setLoading(false)
      return
    }

    let { data: perfil, error: perfilError } = await supabase
      .from('usuarios')
      .select(COLUMNAS_USUARIO)
      .eq('auth_user_id', data.user.id)
      .maybeSingle()

    if ((!perfil || perfilError) && data.user.email) {
      const fallback = await supabase
        .from('usuarios')
        .select(COLUMNAS_USUARIO)
        .eq('email', data.user.email.trim().toLowerCase())
        .maybeSingle()

      if (fallback.data) {
        perfil = fallback.data
        perfilError = null
        await supabase
          .from('usuarios')
          .update({ auth_user_id: data.user.id })
          .eq('id', fallback.data.id)
      }
    }

    if (perfilError || !perfil) {
      if (perfilError) console.error('Login: error al leer el perfil', perfilError.message)
      setError('Tu usuario no tiene un perfil asignado. Consultá con Administración.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    // Ingresó con su contraseña: no queda ninguna recuperación pendiente en este equipo.
    limpiarRecuperacionPendiente()
    // ¿Entró con la contraseña inicial (DNI)? Se marca sólo esta sesión; la
    // contraseña no se guarda ni se envía (lib/acceso-password-dni.ts).
    if (passwordEsDni(passwordLogin, (perfil as { dni?: string | null }).dni)) marcarPasswordDni(data.session?.access_token)
    else limpiarPasswordDni()
    onLogin(perfil)
    setLoading(false)
  }

  const recuperarPassword = async () => {
    setError('')
    setResetMsg('')
    const emailNormalizado = email.trim().toLowerCase()

    const invalido = validarEmail(emailNormalizado)
    if (invalido) {
      setError(`${invalido} Escribilo arriba y tocá de nuevo "Olvidé mi contraseña".`)
      return
    }

    setResetLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailNormalizado, {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined,
      })

      if (error) {
        setError(mensajeError(error, 'recuperación de contraseña'))
      } else {
        setResetMsg('Si el email está registrado, vas a recibir un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.')
      }
    } catch (e) {
      setError(mensajeError(e, 'recuperación de contraseña'))
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh',
      display:'flex',
      alignItems:'center',
      justifyContent:'center',
      padding:24,
      background:`
        radial-gradient(circle at 18% 18%, ${alpha(brandColors.yellow, 0.18)}, transparent 30%),
        radial-gradient(circle at 82% 8%, ${alpha(brandColors.red, 0.16)}, transparent 26%),
        linear-gradient(135deg, ${brandColors.black} 0%, ${brandColors.appBg} 54%, ${brandColors.carbon} 100%)
      `,
      fontFamily:FONT_BRAND,
    }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:30 }}>
          <img
            src={brandAssets.logoFondoOscuro}
            alt="Mercosur Seguridad"
            style={{ width:'min(280px, 78vw)', height:'auto', objectFit:'contain', filter:`drop-shadow(0 18px 34px ${alpha(brandColors.black, 0.5)})` }}
          />
          <div style={{ color:brandColors.text, fontSize:13, marginTop:12, letterSpacing:0.6 }}>Sistema de Control Operativo</div>
        </div>
        <div style={{
          background:alpha(brandColors.surface, 0.94),
          border:`1px solid ${alpha(brandColors.yellow, 0.26)}`,
          borderRadius:16,
          padding:32,
          boxShadow:`0 24px 80px ${alpha(brandColors.black, 0.45)}`,
          backdropFilter:'blur(12px)',
        }}>
          <div style={{ fontFamily:FONT_BRAND, fontSize:20, fontWeight:800, marginBottom:24, color:brandColors.textStrong }}>Iniciar sesión</div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Email</label>
            <input
              style={S.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@mercosur.com"
            />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Contraseña</label>
            <input
              style={S.input}
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
            />
          </div>
          {error && <div style={{ color:semanticColors.error, fontSize:13, marginBottom:12 }}>{error}</div>}
          {resetMsg && <div style={{ color:semanticColors.success, fontSize:13, marginBottom:12 }}>{resetMsg}</div>}
          <button
            style={{ ...S.btn, background:brandColors.yellow, color:brandColors.black, width:'100%', justifyContent:'center', fontFamily:FONT_BRAND, fontWeight:800 }}
            onClick={login}
            disabled={loading}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
          <button
            style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center', marginTop:10 }}
            onClick={recuperarPassword}
            disabled={resetLoading}
          >
            {resetLoading ? 'Enviando...' : 'Olvidé mi contraseña'}
          </button>
        </div>
      </div>
    </div>
  )
}
