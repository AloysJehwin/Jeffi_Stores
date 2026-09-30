'use client'

import { useState } from 'react'
import type { NoteAttachment } from '@/lib/customer-notes-shared'

export default function NoteAttachments({
  attachments,
  size = 'md',
}: {
  attachments: NoteAttachment[]
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState<NoteAttachment | null>(null)
  if (!attachments || attachments.length === 0) return null
  const images = attachments.filter(a => a.kind === 'image')
  const audio = attachments.filter(a => a.kind === 'audio')
  const dim = size === 'sm' ? 'w-16 h-16' : 'w-24 h-24'

  return (
    <div className="mt-3 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              className={`${dim} rounded-lg overflow-hidden border border-border-default hover:ring-2 hover:ring-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500`}
              title={a.originalName || 'Photo'}
            >
              <img
                src={a.thumbnailUrl || a.url}
                alt={a.originalName || 'Note photo'}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {audio.map(a => (
        <div key={a.id} className="flex items-center gap-2">
          <audio controls preload="none" src={a.url} className="h-9 max-w-full" />
          {a.durationSeconds ? <span className="text-[11px] text-foreground-muted">{a.durationSeconds}s</span> : null}
        </div>
      ))}
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={open.url}
            alt={open.originalName || 'Note photo'}
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <a
            href={open.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="absolute top-4 right-16 text-xs px-3 py-1.5 rounded-lg bg-white/90 text-gray-900 font-medium"
          >
            Open original
          </a>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute top-4 right-4 text-xs px-3 py-1.5 rounded-lg bg-white/90 text-gray-900 font-medium"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
