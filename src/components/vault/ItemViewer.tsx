'use client'

import { useEffect, useRef, useState } from 'react'
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

export default function ItemViewer({ files }: { files: ViewerFile[] }) {
  const [activeId, setActiveId] = useState(files[0]?.id)
  const active = files.find(f => f.id === activeId) ?? files[0]
  if (!active) return null

  return (
    <div>
      {files.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {files.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveId(f.id)}
              className={`rounded-md px-3 py-1.5 text-xs ${
                f.id === active.id ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-300'
              }`}
            >
              {f.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
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
        <p className="mt-3 text-xs text-neutral-500">Download is not available for this file.</p>
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

  if (err) return <p className="text-sm text-red-400">Could not load image.</p>
  return <canvas ref={ref} className="mx-auto w-full max-w-full" onContextMenu={e => e.preventDefault()} />
}

function OtherFile({ file }: { file: ViewerFile }) {
  // Non-browser formats (zip/epub/apps) have no in-browser viewer; they are download-only.
  return (
    <p className="text-sm text-neutral-400">
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
      className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {busy ? 'Preparing…' : 'Download'}
    </button>
  )
}
