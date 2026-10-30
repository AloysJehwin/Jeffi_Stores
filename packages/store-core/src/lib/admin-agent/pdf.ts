import 'server-only'
import path from 'node:path'
import { createRequire } from 'node:module'

// A PDF's text layer and its pages as images, both from the app's one pdfjs (with @napi-rs/canvas).
// Two pdfjs versions in one process share a global fake worker and then fail with "API version does
// not match Worker version", so nothing here pulls in a second copy.

async function open(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  return pdfjs.getDocument({
    data: new Uint8Array(buf),
    standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
    cMapUrl: path.join(root, 'cmaps') + path.sep,
    cMapPacked: true,
  }).promise
}

export async function pdfText(buf: Buffer, maxPages = 50): Promise<{ text: string; pages: number }> {
  const doc = await open(buf)
  try {
    const out: string[] = []
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      out.push(content.items.map(i => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join(''))
      page.cleanup()
    }
    return { text: out.join('\n\n'), pages: doc.numPages }
  } finally {
    await doc.loadingTask.destroy()
  }
}

/** Each page as a PNG, for reading a scan with the vision model. */
export async function* pdfPageImages(buf: Buffer, opts: { maxPages: number; scale?: number }): AsyncGenerator<Buffer> {
  const doc = await open(buf)
  try {
    for (let n = 1; n <= Math.min(doc.numPages, opts.maxPages); n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: opts.scale ?? 2 })
      const { canvas } = (doc as any).canvasFactory.create(viewport.width, viewport.height)
      await page.render({ canvas, viewport } as any).promise
      yield canvas.toBuffer('image/png') as Buffer
      page.cleanup()
    }
  } finally {
    await doc.loadingTask.destroy()
  }
}
