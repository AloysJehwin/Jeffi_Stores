'use client'

import { useEffect, useMemo, useState } from 'react'
import MediaItemView, { KIND_LABEL, MediaThumb } from './MediaItemView'
import type { ProductMediaItem } from '@/lib/catalog/product-media-shared'

/** Stage + thumbnail strip over any mix of kinds. Documents are left to DocumentList. */
export default function ProductMediaGallery({
  items,
  ar = false,
  aspect = 'aspect-square',
  emptyNode = null,
}: {
  items: ProductMediaItem[]
  ar?: boolean
  aspect?: string
  emptyNode?: React.ReactNode
}) {
  const shown = useMemo(() => items.filter(m => m.kind !== 'document'), [items])
  const [sel, setSel] = useState(0)
  // A new selection (variant switch) starts at its first item.
  const key = shown.map(m => m.id).join(',')
  useEffect(() => setSel(0), [key])
  if (shown.length === 0) return <>{emptyNode}</>
  const cur = shown[Math.min(sel, shown.length - 1)]
  return (
    <div className="space-y-3">
      <div className={`${aspect} overflow-hidden rounded-xl border border-border-default bg-surface-secondary`}>
        <MediaItemView key={cur.id} m={cur} ar={ar} />
      </div>
      {cur.caption && cur.kind !== 'audio' && <p className="text-xs text-foreground-muted">{cur.caption}</p>}
      {shown.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {shown.map((m, i) => (
            <button
              key={m.id}
              type="button"
              title={KIND_LABEL[m.kind]}
              aria-label={`${KIND_LABEL[m.kind]} ${i + 1}`}
              aria-pressed={i === sel}
              onClick={() => setSel(i)}
              className={`h-14 w-14 overflow-hidden rounded-lg border-2 transition-colors ${i === sel ? 'border-accent-500' : 'border-border-default hover:border-border-secondary'}`}
            >
              <MediaThumb m={m} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
