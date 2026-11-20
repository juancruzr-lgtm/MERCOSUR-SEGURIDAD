import { describe, expect, it } from 'vitest'
import path from 'node:path'
import ts from 'typescript'

// F-04 (auditoría funcional 19/11/2026): en Reportes → «Planilla empleado»,
// «Editar» y «Anular» de una carga manual llamaban a abrirEdicionManual,
// setRegistroAnulando y setMotivoAnulacion, que sólo existían dentro del
// componente Asistencia: al hacer clic, ReferenceError. tsc lo reportaba como
// TS2304/TS2552 ("Cannot find name") pero nadie lo miraba.
//
// Este test compila sólo app/dashboard/AppClient.tsx (sin resolver imports,
// para que sea rápido) y exige que no haya ningún identificador inexistente.
// Los imports sin resolver dan TS2307 y tipos `any`, que acá no importan.

const ARCHIVO = path.resolve(__dirname, '../app/dashboard/AppClient.tsx')
const NOMBRE_INEXISTENTE = new Set([2304, 2552])

function diagnosticosDeNombres() {
  const programa = ts.createProgram([ARCHIVO], {
    noResolve: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2020,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    types: [],
    skipLibCheck: true,
    strict: false,
  })
  const fuente = programa.getSourceFile(ARCHIVO)!
  return programa.getSemanticDiagnostics(fuente)
    .filter(d => NOMBRE_INEXISTENTE.has(d.code))
    .map(d => {
      const { line } = fuente.getLineAndCharacterOfPosition(d.start ?? 0)
      return { linea: line + 1, texto: ts.flattenDiagnosticMessageText(d.messageText, ' ') }
    })
}

describe('AppClient — ningún handler apunta a un identificador inexistente', () => {
  it('Reportes y Asistencia no referencian nombres que no existen (TS2304/TS2552)', () => {
    const errores = diagnosticosDeNombres()
      // JSX intrínseco y globals de React/Next llegan como any sin resolver;
      // sólo cuentan los nombres que no existen en ningún lado.
      .filter(e => !/'(React|JSX)'/.test(e.texto))
    expect(errores).toEqual([])
  }, 120_000)
})
