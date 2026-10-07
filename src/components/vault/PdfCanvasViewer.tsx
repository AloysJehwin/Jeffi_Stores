'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchStreamUrl } from './stream-client'

// pdfjs-dist renders each page to <canvas>: no text layer, no native PDF toolbar (no save/print).
// Worker is app-served same-origin from /api/vault/pdf-worker (the pdfjs-dist build), not a CDN.

const WORKER_SRC = '/api/vault/pdf-worker'

export default function PdfCanvasViewer({ fileId, pageCount }: { fileId: string; pageCount?: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const canvases: HTMLCanvasElement[] = []

    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = `${WORKER_SRC}?v=${pdfjs.version}`

        const { url } = await fetchStreamUrl(fileId)
        const doc = await pdfjs.getDocument({ url }).promise
        if (cancelled) return

        const host = containerRef.current
        if (!host) return
        host.innerHTML = ''

        const total = pageCount && pageCount > 0 ? Math.min(pageCount, doc.numPages) : doc.numPages
        for (let n = 1; n <= total; n++) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const scale = Math.min(2, (host.clientWidth || 800) / page.getViewport({ scale: 1 }).width)
          const viewport = page.getViewport({ scale: Math.max(scale, 0.5) })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'mx-auto mb-4 w-full max-w-full rounded bg-white shadow'
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          host.appendChild(canvas)
          canvases.push(canvas)
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
        }
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      canvases.forEach(c => {
        c.width = 0
        c.height = 0
      })
    }
  }, [fileId, pageCount])

  return (
    <div>
      {status === 'loading' ? <p className="text-sm text-neutral-500">Loading document…</p> : null}
      {status === 'error' ? <p className="text-sm text-red-400">Could not render this document.</p> : null}
      <div ref={containerRef} onContextMenu={e => e.preventDefault()} />
    </div>
  )
}
