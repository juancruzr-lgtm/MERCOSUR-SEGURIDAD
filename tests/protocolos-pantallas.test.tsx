/**
 * Las pantallas del vigilador muestran el texto íntegro y nunca ofrecen nada
 * que bloquee: el lector siempre tiene «Cerrar» y el aviso siempre «Después».
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LectorProtocolo from '@/components/protocolos/LectorProtocolo'
import AvisoProtocoloIngreso from '@/components/protocolos/AvisoProtocoloIngreso'
import { Documento } from '@/components/protocolos/ProtocoloObjetivoPanel'
import { vistaProtocolo } from '@/lib/protocolos'
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

describe('ficha del objetivo: la última guardada rige', () => {
  const base = {
    objetivo_id: 'o1', puesto_id: null, puesto_nombre: null, texto_sha256: 'a'.repeat(64),
    fuente_descripcion: 'WhatsApp de Aldo Monzón, mensaje del 30/09/2026 14:16:16', fuente_fecha: null, fuente_archivo: null, fuente_archivo_sha256: null,
    asociacion: 'confirmada' as const, asociacion_nota: null, asociacion_confirmada_at: null,
    enviado_aprobacion_at: null, aprobado_por_nombre: null, reemplazado_at: null, descartado_at: null,
    motivo_descarte: null, devuelto_motivo: null, notas: null, aperturas: 0, confirmaciones: 0,
  }
  const original = { ...base, id: 'v1', numero: 1, titulo: 'LA CASONA ALBERGUE MUNICIPAL', texto: TEXTO, fuente_tipo: 'whatsapp' as const, estado: 'borrador' as const, creado_at: '2026-10-14T22:30:00Z', aprobado_at: null }
  const render = (versiones: any[], puedeCambiar = true) => renderToStaticMarkup(
    <Documento objetivoId="o1" alcance={vistaProtocolo(versiones)[0]} versiones={versiones}
      puedeCambiar={puedeCambiar} onError={() => {}} onGuardado={async () => {}} />,
  )

  it('sin versión vigente: texto completo, marcado como borrador, con «Que rija este texto»', () => {
    const html = render([original])
    expect(html).toContain('Realizará recorridas con marcación de puntos por el predio cada 2 horas')
    expect(html).toContain('Borrador: todavía no rige ninguna versión')
    expect(html).toContain('Que rija este texto')
    expect(html).toContain('Editar')
  })

  it('con vigente: muestra la que rige, sin pasos de aprobación ni diferencias', () => {
    const vigente = { ...original, id: 'v2', numero: 2, estado: 'vigente' as const, aprobado_at: '2026-10-15T12:00:00Z', aprobado_por_nombre: 'Aldo Monzón', texto: TEXTO + '\nNueva instrucción' }
    const anterior = { ...original, estado: 'reemplazado' as const, reemplazado_at: '2026-10-15T12:00:00Z' }
    const html = render([anterior, vigente])
    expect(html).toContain('Rige desde el')
    expect(html).toContain('Aldo Monzón')
    expect(html).toContain('Nueva instrucción')
    expect(html).toContain('Historial de versiones (2)')
    expect(html).toContain('Volver a esta versión')
    expect(html).toContain('Comparar con')
    for (const viejo of ['Enviar a aprobación', 'Publicar', 'Devolver', 'Confirmar objetivo', 'Diferencias', 'Que rija este texto</button']) {
      expect(html).not.toContain(viejo)
    }
  })

  it('dos borradores (Rapsodia): se elige cuál mirar y cuál rige', () => {
    const otro = { ...original, id: 'v2', numero: 2, texto: 'otro texto' }
    const html = render([original, otro])
    expect(html).toContain('Hay más de un borrador: elegí cuál rige')
    expect(html).toContain('v1 · borrador')
    expect(html).toContain('v2 · borrador')
  })

  it('sin permiso para cambiarlo: se lee, no se edita', () => {
    const html = render([original], false)
    expect(html).toContain('Realizará recorridas')
    expect(html).not.toContain('Editar')
    expect(html).not.toContain('Que rija este texto')
  })
})
