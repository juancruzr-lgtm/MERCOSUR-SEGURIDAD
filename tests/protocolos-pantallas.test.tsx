/**
 * Las pantallas del vigilador muestran el texto íntegro y nunca ofrecen nada
 * que bloquee: el lector siempre tiene «Cerrar» y el aviso siempre «Después».
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LectorProtocolo from '@/components/protocolos/LectorProtocolo'
import AvisoProtocoloIngreso from '@/components/protocolos/AvisoProtocoloIngreso'
import type { DocumentoVigilador } from '@/lib/protocolos'

const TEXTO = 'LA CASONA ALBERGUE MUNICIPAL\nFUNCIONES Y PROCEDIMIENTOS \n\t\nRealizará recorridas con marcación de puntos por el predio cada 2 horas como tiempo máximo entre rondas.'
const doc: DocumentoVigilador = {
  version_id: 'v1', objetivo_id: 'o1', objetivo_nombre: 'LA CASONA', puesto_id: null, puesto_nombre: null,
  numero: 1, titulo: 'LA CASONA ALBERGUE MUNICIPAL', texto: TEXTO, texto_sha256: 'a'.repeat(64),
  aprobado_at: '2026-10-20T13:00:00Z', turnos: ['t1'], abierto_at: null, confirmado_at: null,
}
const nada = async () => null

describe('lector del protocolo', () => {
  it('muestra el texto completo, sin recortes', () => {
    const html = renderToStaticMarkup(<LectorProtocolo doc={doc} desdeCopia={false} guardadoAt={null} onCerrar={() => {}} onConfirmar={nada} />)
    // El texto va como nodo de texto con white-space: pre-wrap (saltos y tabs intactos).
    expect(html).toContain('Realizará recorridas con marcación de puntos por el predio cada 2 horas como tiempo máximo entre rondas.')
    expect(html).toContain('FUNCIONES Y PROCEDIMIENTOS \n\t\n')
    expect(html).toContain('white-space:pre-wrap')
  })

  it('sin confirmar: ofrece confirmar y cerrar, y aclara que no acredita cumplimiento', () => {
    const html = renderToStaticMarkup(<LectorProtocolo doc={doc} desdeCopia={false} guardadoAt={null} onCerrar={() => {}} onConfirmar={nada} />)
    expect(html).toContain('Leí el protocolo')
    expect(html).toContain('Cerrar')
    expect(html).toContain('no acredita el cumplimiento')
  })

  it('confirmado: no vuelve a pedir confirmación', () => {
    const html = renderToStaticMarkup(<LectorProtocolo doc={{ ...doc, confirmado_at: '2026-10-21T10:00:00Z' }} desdeCopia={false} guardadoAt={null} onCerrar={() => {}} onConfirmar={nada} />)
    expect(html).not.toContain('Leí el protocolo')
    expect(html).toContain('Confirmaste la lectura')
  })

  it('sin señal: avisa que es la copia guardada en el teléfono', () => {
    const html = renderToStaticMarkup(<LectorProtocolo doc={doc} desdeCopia guardadoAt={Date.UTC(2026, 9, 21, 9, 0)} onCerrar={() => {}} onConfirmar={nada} />)
    expect(html).toContain('copia guardada en este teléfono')
  })
})

describe('aviso posterior al ingreso', () => {
  it('es una franja con «Leer ahora» y «Después», no una compuerta', () => {
    const html = renderToStaticMarkup(<AvisoProtocoloIngreso doc={doc} onLeer={() => {}} onDespues={() => {}} />)
    expect(html).toContain('Leer ahora')
    expect(html).toContain('Después')
    expect(html).toContain('Protocolo de LA CASONA')
    expect(html).not.toContain('aria-modal')
  })
})
