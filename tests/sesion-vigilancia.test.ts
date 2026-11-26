import { describe, expect, it, vi } from 'vitest'
import { esSesionPerdida, vigilarSesion } from '@/lib/sesion-vigilancia'

describe('esSesionPerdida', () => {
  it('sesión cerrada o vencida', () => {
    expect(esSesionPerdida({ code: 'refresh_token_not_found', status: 400 })).toBe(true)
    expect(esSesionPerdida({ code: 'session_not_found' })).toBe(true)
    expect(esSesionPerdida({ status: 401, message: 'JWT expired' })).toBe(true)
    expect(esSesionPerdida({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(true)
    expect(esSesionPerdida({ message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(true)
  })
  it('red o servidor: NO es sesión perdida', () => {
    expect(esSesionPerdida(null)).toBe(false)
    expect(esSesionPerdida({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe(false)
    expect(esSesionPerdida({ status: 500, message: 'Internal error' })).toBe(false)
    expect(esSesionPerdida({ status: 504 })).toBe(false)
  })
})

function clienteFalso(getUser: () => Promise<any>) {
  let cb: (e: string, s: unknown) => void = () => {}
  const unsubscribe = vi.fn()
  const signOut = vi.fn(async () => { cb('SIGNED_OUT', null) })
  return {
    emitir: (e: string) => cb(e, null),
    unsubscribe, signOut,
    cliente: { auth: { onAuthStateChange: (f: any) => { cb = f; return { data: { subscription: { unsubscribe } } } }, getUser, signOut } },
  }
}

function entornoFalso() {
  const handlers: Record<string, () => void> = {}
  const add = (n: string, h: () => void) => { handlers[n] = h }
  const rm = (n: string) => { delete handlers[n] }
  return {
    handlers,
    entorno: {
      documento: { addEventListener: add, removeEventListener: rm, visibilityState: 'visible' } as any,
      ventana: { addEventListener: add, removeEventListener: rm } as any,
    },
  }
}

describe('vigilarSesion', () => {
  it('SIGNED_OUT lleva al inicio una sola vez', () => {
    const f = clienteFalso(async () => ({ data: { user: { id: 'x' } }, error: null }))
    const alPerderse = vi.fn()
    vigilarSesion(f.cliente as any, alPerderse, entornoFalso().entorno)
    f.emitir('SIGNED_OUT'); f.emitir('SIGNED_OUT')
    expect(alPerderse).toHaveBeenCalledTimes(1)
  })
  it('al volver a la app con la sesión rechazada por el servidor, avisa (caso Sabino)', async () => {
    const f = clienteFalso(async () => ({ data: { user: null }, error: { status: 403, code: 'session_not_found' } }))
    const e = entornoFalso(); const alPerderse = vi.fn()
    vigilarSesion(f.cliente as any, alPerderse, e.entorno)
    e.handlers.visibilitychange(); await new Promise(r => setTimeout(r, 0))
    expect(alPerderse).toHaveBeenCalledTimes(1)
    expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('sin red no echa a nadie', async () => {
    const f = clienteFalso(async () => ({ data: null, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } }))
    const e = entornoFalso(); const alPerderse = vi.fn()
    vigilarSesion(f.cliente as any, alPerderse, e.entorno)
    e.handlers.online(); await new Promise(r => setTimeout(r, 0))
    expect(alPerderse).not.toHaveBeenCalled()
  })
  it('getUser que tira excepción (red) no echa a nadie', async () => {
    const f = clienteFalso(async () => { throw new TypeError('Failed to fetch') })
    const e = entornoFalso(); const alPerderse = vi.fn()
    vigilarSesion(f.cliente as any, alPerderse, e.entorno)
    e.handlers.focus(); await new Promise(r => setTimeout(r, 0))
    expect(alPerderse).not.toHaveBeenCalled()
  })
  it('sesión sana: no hace nada; al desmontar deja de escuchar', async () => {
    const f = clienteFalso(async () => ({ data: { user: { id: 'x' } }, error: null }))
    const e = entornoFalso(); const alPerderse = vi.fn()
    const parar = vigilarSesion(f.cliente as any, alPerderse, e.entorno)
    e.handlers.visibilitychange(); await new Promise(r => setTimeout(r, 0))
    expect(alPerderse).not.toHaveBeenCalled()
    parar()
    expect(f.unsubscribe).toHaveBeenCalled()
    expect(e.handlers.visibilitychange).toBeUndefined()
  })
})
