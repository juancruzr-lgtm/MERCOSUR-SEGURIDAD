'use client'

import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('No se pudo registrar la PWA', error)
      })
    }

    if (document.readyState === 'complete') {
      registrar()
      return
    }

    window.addEventListener('load', registrar)
    return () => window.removeEventListener('load', registrar)
  }, [])

  return null
}
