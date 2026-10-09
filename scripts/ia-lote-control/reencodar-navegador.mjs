// Re-codifica imágenes EXACTAMENTE como la app (#280, lib/comprimir-imagen.ts):
// <img> decodifica (aplica la orientación EXIF), escala por lado mayor,
// dibuja en <canvas> y exporta JPEG con la calidad del perfil. Corre en Edge o
// Chrome sin ventana, con playwright-core (instalar SÓLO en la máquina que
// ejecuta el lote: npm i --no-save playwright-core).

const NAVEGADORES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]

export async function abrirNavegador(ruta = process.env.NAVEGADOR) {
  const { chromium } = await import('playwright-core')
  const { existsSync } = await import('fs')
  const exe = ruta ?? NAVEGADORES.find(p => existsSync(p))
  if (!exe) throw new Error('No se encontró Edge ni Chrome (definir NAVEGADOR=<ruta>)')
  const b = await chromium.launch({ executablePath: exe, headless: false, args: ['--headless=new'] })
  const p = await b.newPage()
  await p.setContent('<!doctype html><title>reencodar</title>')
  return {
    async reencodar(bytes, mime, { ladoMayor, quality }) {
      const base64 = await p.evaluate(async ({ b64, mime, ladoMayor, quality }) => {
        const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob()
        const url = URL.createObjectURL(blob)
        const img = new Image()
        await new Promise((ok, mal) => { img.onload = ok; img.onerror = () => mal(new Error('imagen_carga_fallo')); img.src = url })
        URL.revokeObjectURL(url)
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
        const escala = Math.min(1, ladoMayor / Math.max(w, h))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(w * escala)); c.height = Math.max(1, Math.round(h * escala))
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        const salida = await new Promise(ok => c.toBlob(ok, 'image/jpeg', quality))
        const buf = new Uint8Array(await salida.arrayBuffer())
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return { b64: btoa(s), ancho: c.width, alto: c.height, origen: `${w}x${h}` }
      }, { b64: Buffer.from(bytes).toString('base64'), mime, ladoMayor, quality })
      return { bytes: Buffer.from(base64.b64, 'base64'), dims: `${base64.ancho}x${base64.alto}`, dimsOrigen: base64.origen }
    },
    cerrar: () => b.close(),
  }
}
