const { execSync } = require('child_process')
const { writeFileSync } = require('fs')
const { join } = require('path')
const { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } = require('next/constants')
const { version } = require('./package.json')

// Versión de la app, fijada en el BUILD: `<package.json>+<commit corto>`.
// En Vercel sale de VERCEL_GIT_COMMIT_SHA; en local, del repo; si no hay
// ninguno, 'dev'. La usan la telemetría (os_sessions.app_version), la
// pantalla Diagnóstico y el registro del Service Worker (/sw.js?v=…), que con
// cada deploy cambia de URL, instala el worker nuevo y purga las cachés viejas.
function commitCorto() {
  const desdeVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (desdeVercel) return desdeVercel.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || `${version}+${commitCorto()}`

// public/sw-version.js (generado, fuera del repo): lo importa public/sw.js con
// importScripts. Así el CONTENIDO del worker cambia con cada deploy y
// `registration.update()` detecta la versión nueva aunque la página lleve
// horas abierta con el código viejo.
function escribirVersionWorker() {
  try {
    writeFileSync(
      join(__dirname, 'public', 'sw-version.js'),
      `// Generado por next.config.js en el build. No editar.\nself.SW_VERSION = ${JSON.stringify(APP_VERSION)}\n`,
    )
  } catch (error) {
    console.warn('[next.config] no se pudo escribir public/sw-version.js', error)
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  async headers() {
    return [
      {
        // El worker nunca se sirve desde la caché HTTP: el navegador tiene que
        // ver cada deploy. (Los navegadores ya limitan a 24 h, esto lo baja a 0.)
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/sw-version.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ]
  },
  experimental: {
    cpus: 1,
    // El Word original del Estatuto no está en /public (no se sirve como
    // estático): sólo lo lee esta ruta, que verifica el permiso. Hay que
    // decirle a Next que lo empaquete junto con la función.
    outputFileTracingIncludes: {
      '/api/estatuto/original': ['./privado/estatuto/**/*'],
    },
  },
}
module.exports = (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) escribirVersionWorker()
  return nextConfig
}
module.exports.APP_VERSION = APP_VERSION
