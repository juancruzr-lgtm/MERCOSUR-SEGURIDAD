/**
 * División del bundle de /dashboard por rol (auditoría PWA oct-2026).
 *
 * El vigilador no tiene que descargar el bundle de administración: la página
 * monta AppShell, que resuelve sesión y perfil y recién después baja el shell
 * de su rol con next/dynamic. Guardas de código: si alguien vuelve a importar
 * AppClient en forma estática desde el arranque, el test falla.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('división del bundle por rol', () => {
  it('la página monta AppShell, no AppClient', () => {
    const page = sinComentarios(leer('app/dashboard/page.tsx'))
    expect(page).toMatch(/import\('\.\/AppShell'\)/)
    expect(page).not.toMatch(/AppClient/)
  })

  it('AppShell sólo importa AppClient, GuardiaMobile y SupervisorMobile con next/dynamic', () => {
    const shell = sinComentarios(leer('app/dashboard/AppShell.tsx'))
    const estaticos = Array.from(shell.matchAll(/^import .* from ['"]([^'"]+)['"]/gm), m => m[1])
    expect(estaticos).not.toContain('./AppClient')
    expect(estaticos).not.toContain('@/components/guardia/GuardiaMobile')
    expect(estaticos).not.toContain('@/components/supervisor/SupervisorMobile')
    expect(shell).toMatch(/dynamic\(\(\) => import\('\.\/AppClient'\)/)
    expect(shell).toMatch(/dynamic\(\(\) => import\('@\/components\/guardia\/GuardiaMobile'\)/)
    expect(shell).toMatch(/dynamic\(\(\) => import\('@\/components\/supervisor\/SupervisorMobile'\)/)
    // La decisión de shell es la misma función que usa AppClient.
    expect(shell).toMatch(/shellDeUsuario\(perfil\)/)
  })

  it('Login no arrastra el bundle de administración', () => {
    const login = sinComentarios(leer('app/dashboard/Login.tsx'))
    const estaticos = Array.from(login.matchAll(/^import .* from ['"]([^'"]+)['"]/gm), m => m[1])
    expect(estaticos.every(m => !/AppClient|components\/(guardia|supervisor|rondas|liquidacion)/.test(m))).toBe(true)
  })

  it('AppClient no repite la RPC de delegación cuando AppShell ya la resolvió', () => {
    const app = leer('app/dashboard/AppClient.tsx')
    expect(app).toMatch(/cargarSesionPorRol\(perfilInicial, true\)/)
    expect(app).not.toMatch(/rpc\('tiene_delegacion_gerencia_actual'\)/)
  })
})
