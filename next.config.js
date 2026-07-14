/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  experimental: { cpus: 1 },
}
module.exports = nextConfig
