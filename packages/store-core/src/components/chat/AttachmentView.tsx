'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, File as FileIcon, X } from 'lucide-react'
import type { SupportAttachment } from '@/lib/support/types'
import { fileSize } from './format'

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <button type="button" aria-label="Close" className="absolute top-4 right-4 text-white/80 hover:text-white p-2" onClick={onClose}>
        <X className="w-6 h-6" />
      </button>
      <a href={src.startsWith('/api/') ? `${src}?download=1` : src} download onClick={e => e.stopPropagation()} aria-label="Download" className="absolute top-4 right-16 text-white/80 hover:text-white p-2">
        <Download className="w-6 h-6" />
      </a>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-w-full max-h-full object-contain rounded" onClick={e => e.stopPropagation()} />
    </div>
  )
}

function FileTile({ a, mine }: { a: SupportAttachment; mine: boolean }) {
  const Icon = a.kind === 'pdf' || a.kind === 'doc' ? FileText : FileIcon
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border min-w-0 max-w-[260px] ${
        mine ? 'border-white/25 bg-white/10 hover:bg-white/20' : 'border-border-default bg-surface hover:bg-surface-secondary'
      }`}
    >
      <Icon className="w-5 h-5 shrink-0 opacity-80" />
      <span className="min-w-0">
        <span className="block text-xs font-medium truncate">{a.name}</span>
        <span className="block text-[10px] opacity-70">
          {a.kind === 'pdf' ? 'PDF' : a.mime.split('/')[1]?.toUpperCase().slice(0, 8) || 'File'} · {fileSize(a.size)}
        </span>
      </span>
      <Download className="w-4 h-4 shrink-0 opacity-60 ml-auto" />
    </a>
  )
}

/** A message's files: images in a grid (tap to enlarge), players for video/audio, tiles for documents. */
export default function AttachmentView({ items, mine }: { items: SupportAttachment[]; mine: boolean }) {
  const [zoom, setZoom] = useState<SupportAttachment | null>(null)
  if (!items.length) return null
  const images = items.filter(a => a.kind === 'image')
  const rest = items.filter(a => a.kind !== 'image')
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className={`grid gap-1 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {images.map(a => (
            <button key={a.id} type="button" onClick={() => setZoom(a)} className="block overflow-hidden rounded-lg bg-black/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.thumbUrl ?? a.url}
                alt={a.name}
                loading="lazy"
                className={`w-full object-cover ${images.length === 1 ? 'max-h-64' : 'h-28'}`}
                style={images.length === 1 && a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
              />
            </button>
          ))}
        </div>
      )}
      {rest.map(a =>
        a.kind === 'video' ? (
          <video key={a.id} src={a.url} controls preload="metadata" className="w-full max-w-[320px] max-h-64 rounded-lg bg-black" />
        ) : a.kind === 'audio' ? (
          <audio key={a.id} src={a.url} controls preload="metadata" className="w-full max-w-[280px]" />
        ) : (
          <FileTile key={a.id} a={a} mine={mine} />
        )
      )}
      {zoom && <Lightbox src={zoom.url} alt={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  )
}
