'use client'

import { useState } from 'react'
import { primaryImage } from './product-view'

const PLACEHOLDER =
  'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'

export function ImagePlaceholderIcon({ className, strokeWidth }: { className: string; strokeWidth: number }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={PLACEHOLDER} />
    </svg>
  )
}

export function ProductGallery({ images, name }: { images: any[]; name: string }) {
  const [selected, setSelected] = useState(0)
  const shown = images[selected] || primaryImage(images)
  return (
    <div className="space-y-3">
      {shown ? (
        <div className="aspect-square overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.image_url || shown.thumbnail_url} alt={name} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-xl border border-border-default bg-surface-secondary">
          <ImagePlaceholderIcon className="h-16 w-16 text-foreground-muted" strokeWidth={1} />
        </div>
      )}
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img: any, idx: number) => (
            <button
              key={img.id}
              onClick={() => setSelected(idx)}
              className={`h-14 w-14 overflow-hidden rounded-lg border-2 transition-colors ${idx === selected ? 'border-accent-500' : 'border-border-default hover:border-border-secondary'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbnail_url || img.image_url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
