'use client'

import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download, File, Film, Headphones, Image as ImageIcon } from 'lucide-react'
import MediaViewer from './MediaViewer'
import PdfCanvasViewer from './PdfCanvasViewer'
import { fetchStreamUrl } from './stream-client'

export interface ViewerFile {
  id: string
  kind: 'video' | 'audio' | 'pdf' | 'image' | 'other'
  displayName: string
  pageCount: number | null
  /** Server-computed: master vaultDownloadsEnabled && file.downloadable. */
  downloadAllowed: boolean
}

// Per-item viewer: a file switcher + the right viewer for the selected file's kind. A download
// button appears ONLY when the server said the file is downloadable (never for a stream URL).

const KIND_ICON = { video: Film, audio: Headphones, pdf: BookOpen, image: ImageIcon, other: File } as const

export default function ItemViewer({ files }: { files: ViewerFile[] }) {
  const [activeId, setActiveId] = useState(files[0]?.id)
  const active = files.find(f => f.id === activeId) ?? files[0]
  if (!active) return null

  return (
    <div>
      {files.length > 1 ? (
        <div role="tablist" aria-label="Files" className="mb-3 flex gap-2 overflow-x-auto pb-1 pr-12">
          {files.map((f, i) => {
            const Icon = KIND_ICON[f.kind] ?? File
            const on = f.id === active.id
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveId(f.id)}
                className={`inline-flex max-w-[16rem] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  on ? 'bg-white text-neutral-950' : 'bg-white/[0.05] text-neutral-300 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.09]'
                }`}
              >
                <span className="tabular-nums text-neutral-500">{i + 1}</span>
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{f.displayName}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl bg-neutral-900 p-2 ring-1 ring-white/[0.06] sm:p-3">
        {active.kind === 'pdf' ? (
          <PdfCanvasViewer fileId={active.id} pageCount={active.pageCount} />
        ) : active.kind === 'video' || active.kind === 'audio' ? (
          <MediaViewer fileId={active.id} kind={active.kind} />
        ) : active.kind === 'image' ? (
          <ImageCanvas fileId={active.id} />
        ) : (
          <OtherFile file={active} />
        )}
      </div>

      {active.downloadAllowed ? (
        <DownloadButton file={active} />
      ) : (
        <p className="mt-3 text-xs text-neutral-500">Streaming only — download isn&apos;t available for this file.</p>
      )}
    </div>
  )
}

function ImageCanvas({ fileId }: { fileId: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { url } = await fetchStreamUrl(fileId)
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          if (!alive) return
          const c = ref.current
          if (!c) return
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          c.getContext('2d')?.drawImage(img, 0, 0)
        }
        img.onerror = () => alive && setErr(true)
        img.src = url
      } catch {
        if (alive) setErr(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [fileId])

  if (err) return <p className="p-6 text-sm text-red-400">Could not load image.</p>
  return <canvas ref={ref} className="mx-auto w-full max-w-full" onContextMenu={e => e.preventDefault()} />
}

function OtherFile({ file }: { file: ViewerFile }) {
  // Non-browser formats (zip/epub/apps) have no in-browser viewer; they are download-only.
  return (
    <p className="p-6 text-center text-sm text-neutral-400">
      {file.downloadAllowed
        ? 'This file type opens outside the browser — use the download below.'
        : 'This file type cannot be previewed and downloads are not enabled.'}
    </p>
  )
}

function DownloadButton({ file }: { file: ViewerFile }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      const { url } = await fetchStreamUrl(file.id, true)
      // Navigate to the attachment-disposition URL to trigger the download.
      window.location.href = url
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
    >
      <Download className="h-4 w-4" aria-hidden />
      {busy ? 'Preparing…' : 'Download'}
    </button>
  )
}
