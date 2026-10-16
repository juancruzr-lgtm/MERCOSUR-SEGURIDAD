/**
 * Aviso del Estatuto (JC, 16/10/2026): insiste sin bloquear. La tarjeta no se
 * puede esconder; el cartel sí ("Después") y avisa que se puede fichar igual.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { VistaAvisoEstatuto } from '@/components/estatuto/AvisoEstatuto'

const nada = () => {}

describe('aviso del Estatuto', () => {
  it('sin cartel: sólo la tarjeta, que lleva a leer y aceptar y no tiene "Después"', () => {
    const html = renderToStaticMarkup(<VistaAvisoEstatuto destino="/estatuto" cartel={false} onDespues={nada} />)
    expect(html).toContain('ESTATUTO INTERNO')
    expect(html).toContain('href="/estatuto"')
    expect(html).toContain('Leer y aceptar')
    expect(html).not.toContain('Después')
    expect(html).not.toContain('role="dialog"')
  })

  it('con cartel: pantalla completa que se cierra con "Después" y no impide fichar', () => {
    const html = renderToStaticMarkup(<VistaAvisoEstatuto destino="/estatuto" cartel onDespues={nada} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Después')
    expect(html).toContain('Podés seguir usando la app y fichar normalmente')
    expect(html).toContain('volver hasta que lo aceptes')
    // La tarjeta sigue debajo: cerrar el cartel no la saca.
    expect(html.match(/Leer y aceptar/g)).toHaveLength(2)
  })

  it('no ofrece aceptar desde el aviso: aceptar exige abrir el documento', () => {
    const html = renderToStaticMarkup(<VistaAvisoEstatuto destino="/x" cartel onDespues={nada} />)
    expect(html).not.toMatch(/type="checkbox"|Aceptar estatuto/)
  })
})
