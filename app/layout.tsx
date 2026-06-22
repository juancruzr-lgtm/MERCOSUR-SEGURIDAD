import type { Metadata, Viewport } from 'next'
import PwaRegister from './PwaRegister'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mercosur Seguridad',
  description: 'Sistema de Control Operativo',
  applicationName: 'Mercosur Seguridad',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/brand/favicon.ico' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/brand/favicon.ico' }],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Mercosur Seguridad',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: '#05070D',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  )
}
