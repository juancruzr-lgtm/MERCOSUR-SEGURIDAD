import { describe, expect, it } from 'vitest'
import { resumirError } from '../lib/ia/gemini'

// Cuerpo real de un 429 de Gemini. Lo importante está DESPUÉS de los links, y
// el recorte ciego anterior lo cortaba siempre.
const CUERPO_429 = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details. '
      + 'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. '
      + 'To monitor your current usage, head to: https://ai.dev/rate-limit. \n'
      + '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, '
      + 'limit: 15\n* Please retry in 27s.',
  },
})

describe('resumirError', () => {
  it('conserva la linea que dice que cuota se agoto', () => {
    const r = resumirError(CUERPO_429)
    expect(r).toMatch(/Quota exceeded for metric/)
    expect(r).toMatch(/generate_content_free_tier_requests/)
    expect(r).toMatch(/limit: 15/)
  })

  it('tira los links de documentacion, que no aportan al registro', () => {
    expect(resumirError(CUERPO_429)).not.toMatch(/https?:\/\//)
  })

  it('entra en el limite de la columna', () => {
    expect(resumirError(CUERPO_429).length).toBeLessThanOrEqual(400)
  })

  it('sin lineas de cuota devuelve el mensaje del proveedor', () => {
    const cuerpo = JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload received.' } })
    expect(resumirError(cuerpo)).toBe('Invalid JSON payload received.')
  })

  it('si no es JSON no rompe: Vercel puede devolver texto plano al cortar', () => {
    const r = resumirError('An error occurred with your deployment')
    expect(r).toBe('An error occurred with your deployment')
  })

  it('nunca devuelve mas de 400 caracteres, venga lo que venga', () => {
    expect(resumirError('x'.repeat(5000)).length).toBe(400)
  })
})
