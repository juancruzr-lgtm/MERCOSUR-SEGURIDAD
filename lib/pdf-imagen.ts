/**
 * lib/pdf-imagen.ts
 *
 * Convierte las páginas de un PDF en imágenes, en el navegador. Lo usan las
 * credenciales escaneadas por Administración: para verlas en el legajo sin
 * descargarlas, y para que la IA las lea y las recorte igual que una foto.
 *
 * pdf.js se carga recién cuando hace falta (no pesa en el resto de la app).
 */

const VERSION = '3.11.174'
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}`

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (p: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> }
}
interface PdfDoc { numPages: number; getPage: (n: number) => Promise<PdfPagina>; destroy: () => Promise<void> }
interface PdfPagina {
  getViewport: (p: { scale: number }) => { width: number; height: number }
  render: (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
}

let cargando: Promise<PdfJs> | null = null

function cargarPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs }
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  if (cargando) return cargando
  cargando = new Promise<PdfJs>((ok, mal) => {
    const s = document.createElement('script')
    s.src = `${BASE}/pdf.min.js`
    s.async = true
    s.onload = () => {
      if (!w.pdfjsLib) { cargando = null; mal(new Error('pdf.js')); return }
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.js`
      ok(w.pdfjsLib)
    }
    s.onerror = () => { cargando = null; mal(new Error('No se pudo cargar el lector de PDF')) }
    document.head.appendChild(s)
  })
  return cargando
}

export const esPdf = (f: Blob) => f.type === 'application/pdf'

/**
 * Cada página del PDF como JPEG (hasta `maxPaginas`), con el lado mayor en
 * `ladoMax` píxeles: alcanza para leer una credencial escaneada.
 */
export async function pdfAImagenes(pdf: Blob, opciones: { maxPaginas?: number; ladoMax?: number } = {}): Promise<Blob[]> {
  const { maxPaginas = 4, ladoMax = 1800 } = opciones
  const lib = await cargarPdfJs()
  const doc = await lib.getDocument({ data: await pdf.arrayBuffer() }).promise
  try {
    const salida: Blob[] = []
    for (let n = 1; n <= Math.min(doc.numPages, maxPaginas); n++) {
      const pagina = await doc.getPage(n)
      const base = pagina.getViewport({ scale: 1 })
      const escala = ladoMax / Math.max(base.width, base.height)
      const vista = pagina.getViewport({ scale: escala })
      const c = document.createElement('canvas')
      c.width = Math.round(vista.width); c.height = Math.round(vista.height)
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise
      const b = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', 0.9))
      if (b) salida.push(b)
    }
    return salida
  } finally {
    void doc.destroy()
  }
}

/** La primera página del PDF como archivo JPEG (para subirla o leerla como una foto). */
export async function pdfAFoto(pdf: File): Promise<File> {
  const [img] = await pdfAImagenes(pdf, { maxPaginas: 1 })
  if (!img) throw new Error('El PDF no tiene páginas')
  return new File([img], pdf.name.replace(/\.pdf$/i, '') + '.jpg', { type: 'image/jpeg' })
}
