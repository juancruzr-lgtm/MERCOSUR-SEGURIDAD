'use client'

import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Si al cargar ya había un worker controlando la página, cualquier cambio de
    // controlador posterior significa que se activó una versión NUEVA: recargamos
    // una sola vez para tomar el código actualizado (evita chunks JS viejos en
    // memoria). En la primera instalación (sin controlador) no recargamos.
    const habiaControlador = !!navigator.serviceWorker.controller
    let recargando = false
    const alCambiarControlador = () => {
      if (!habiaControlador || recargando) return
      recargando = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', alCambiarControlador)

    let registro: ServiceWorkerRegistration | null = null

    const activarWorkerEnEspera = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    }

    const registrar = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(reg => {
          registro = reg
          // Ya hay una versión nueva esperando: activarla.
          activarWorkerEnEspera(reg)
          reg.addEventListener('updatefound', () => {
            const entrante = reg.installing
            if (!entrante) return
            entrante.addEventListener('statechange', () => {
              // Instalado y con un controlador previo => hay actualización lista.
              if (entrante.state === 'installed' && navigator.serviceWorker.controller) {
                activarWorkerEnEspera(reg)
              }
            })
          })
        })
        .catch(error => {
          console.warn('No se pudo registrar la PWA', error)
        })
    }

    // Al volver a la app (foco/visibilidad) buscamos si hay un deploy nuevo.
    const buscarActualizacion = () => {
      if (document.visibilityState === 'visible') registro?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', buscarActualizacion)

    if (document.readyState === 'complete') {
      registrar()
    } else {
      window.addEventListener('load', registrar)
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', alCambiarControlador)
      document.removeEventListener('visibilitychange', buscarActualizacion)
      window.removeEventListener('load', registrar)
    }
  }, [])

  return null
}
