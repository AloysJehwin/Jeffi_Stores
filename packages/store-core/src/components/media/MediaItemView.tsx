'use client'

import dynamic from 'next/dynamic'
import { Box, FileText, Film, Image as ImageIcon, Music, RotateCw, MonitorPlay } from 'lucide-react'
import { embedUrlOf, formatBytes, mediaPoster, type MediaKind, type ProductMediaItem } from '@/lib/catalog/product-media-shared'

// Heavy viewers load only when such an item is on screen.
const ModelViewer = dynamic(() => import('./ModelViewer'), { ssr: false })
const SpinViewer = dynamic(() => import('./SpinViewer'), { ssr: false })

export const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  external_video: MonitorPlay,
  document: FileText,
  model_3d: Box,
  spin_360: RotateCw,
  audio: Music,
}

export const KIND_LABEL: Record<MediaKind, string> = {
  image: 'Image',
  video: 'Video',
  external_video: 'Video link',
  document: 'Document',
  model_3d: '3D model',
  spin_360: '360° view',
  audio: 'Audio',
}

/** A small still for any item; falls back to the kind's icon. */
export function MediaThumb({ m, className = 'h-full w-full' }: { m: ProductMediaItem; className?: string }) {
  const poster = mediaPoster(m)
  const Icon = KIND_ICON[m.kind] ?? ImageIcon
  return (
    <span className={`relative flex items-center justify-center overflow-hidden bg-surface-secondary ${className}`}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt={m.alt ?? ''} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Icon className="h-6 w-6 text-foreground-muted" />
      )}
      {m.kind !== 'image' && poster && (
        <span className="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white">
          <Icon className="h-3 w-3" />
        </span>
      )}
    </span>
  )
}

/** One item at full size: the right player for its kind. */
export default function MediaItemView({ m, ar = false, className = 'h-full w-full' }: { m: ProductMediaItem; ar?: boolean; className?: string }) {
  switch (m.kind) {
    case 'video':
      return (
        <video
          src={m.url}
          poster={m.thumbnail_url ?? undefined}
          controls
          playsInline
          preload="metadata"
          className={`${className} bg-black object-contain`}
        />
      )
    case 'external_video': {
      const src = embedUrlOf(m)
      return src ? (
        <iframe
          src={src}
          title={m.alt || m.caption || 'Video'}
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className={`${className} border-0 bg-black`}
        />
      ) : null
    }
    case 'model_3d':
      return (
        <ModelViewer
          src={m.url}
          iosSrc={m.metadata?.usdz_url}
          poster={m.thumbnail_url}
          alt={m.alt}
          ar={ar && m.metadata?.ar !== false}
          className={className}
        />
      )
    case 'spin_360':
      return <SpinViewer frames={(m.metadata?.frames as string[]) ?? []} alt={m.alt} className={className} />
    case 'audio':
      return (
        <div className={`${className} flex flex-col items-center justify-center gap-3 bg-surface-secondary p-4`}>
          <Music className="h-10 w-10 text-foreground-muted" />
          {m.caption && <p className="text-sm text-foreground-secondary text-center">{m.caption}</p>}
          <audio src={m.url} controls preload="none" className="w-full max-w-sm" />
        </div>
      )
    case 'document':
      return (
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${className} flex flex-col items-center justify-center gap-2 bg-surface-secondary p-4 text-center`}
        >
          {m.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.thumbnail_url} alt="" className="max-h-[75%] object-contain shadow" />
          ) : (
            <FileText className="h-12 w-12 text-foreground-muted" />
          )}
          <span className="text-sm font-medium text-foreground">{m.caption || m.file_name || 'Document'}</span>
          <span className="text-xs text-foreground-muted">PDF {formatBytes(m.size_bytes)}</span>
        </a>
      )
    default:
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={m.url} alt={m.alt ?? ''} className={`${className} object-contain`} />
  }
}

/** Downloadable documents (datasheets, manuals, certificates) as a list. */
export function DocumentList({ items, title = 'Documents' }: { items: ProductMediaItem[]; title?: string }) {
  const docs = items.filter(m => m.kind === 'document')
  if (docs.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="divide-y divide-border-default rounded-lg border border-border-default">
        {docs.map(d => (
          <li key={d.id}>
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-secondary/60">
              <FileText className="h-5 w-5 shrink-0 text-red-500" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{d.caption || d.file_name || 'Document'}</span>
              <span className="text-xs text-foreground-muted">{formatBytes(d.size_bytes)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
