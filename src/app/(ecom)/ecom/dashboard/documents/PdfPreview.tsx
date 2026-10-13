'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

// Renders the PDF to <canvas> with pdf.js — the app's CSP / X-Frame-Options forbid framing PDFs.
const WORKER_SRC = '/api/vault/pdf-worker'

export default function PdfPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!url) return
    let cancelled = false
    setStatus('loading')
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = `${WORKER_SRC}?v=${pdfjs.version}`
        const r = await fetch(url)
        if (!r.ok) throw new Error(String(r.status))
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise
        const width = host.current?.clientWidth || 600
        const canvases: HTMLCanvasElement[] = []
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1) })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'mx-auto mb-3 block h-auto w-full bg-white shadow-sm'
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          canvases.push(canvas)
        }
        if (cancelled || !host.current) return
        // Swap only when the new render is ready, so the old preview stays up meanwhile.
        host.current.replaceChildren(...canvases)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [url])

  return (
    <div className="relative">
      <div ref={host} className="min-h-[420px]" />
      {status === 'loading' && <div className="absolute inset-0 flex items-start justify-center pt-40"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>}
      {status === 'error' && <p className="absolute inset-x-0 top-40 text-center text-sm text-foreground-muted">Could not load the preview.</p>}
    </div>
  )
}
