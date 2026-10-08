/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
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
module.exports = nextConfig
