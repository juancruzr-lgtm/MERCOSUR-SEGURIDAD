// El snapshot de esquema va a un repo público: sólo catálogo, nada de datos ni secretos.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { archivosEsquema } from './entorno'
import { revisar } from '../../scripts/db-snapshot/generar.mjs'

describe('snapshot de esquema', () => {
  it('tiene los 4 archivos esperados', () => {
    expect(archivosEsquema().map(f => basename(f))).toEqual([
      '00-supabase.sql', '10-tablas.sql', '20-funciones.sql', '30-politicas-grants-triggers.sql'])
  })
  for (const f of archivosEsquema()) {
    it(`${basename(f)} no tiene URLs, tokens, CBU ni filas de datos`, () => {
      expect(revisar(readFileSync(f, 'utf8'))).toEqual([])
    })
  }
  it('el detector marca lo que debe marcar', () => {
    expect(revisar(`insert into x values (1)`)).toContain('INSERT (datos)')
    expect(revisar(`select 'https://ejemplo.test/a'`)).toContain('URL')
    expect(revisar(`'eyJhbGciOiJIUzI1NiJ9xxxx'`)).toContain('JWT')
  })
})
