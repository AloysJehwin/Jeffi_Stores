'use client'

import { useRef, useState } from 'react'
import { Star, X, GripVertical } from 'lucide-react'

export interface EditorImage {
  id: string
  image_url?: string
  thumbnail_url?: string
  is_primary?: boolean
}

interface Props {
  images: EditorImage[]
  maxImages?: number
  size?: 'md' | 'sm'
  uploading?: boolean
  pendingAdds?: number
  deleting?: Record<string, boolean>
  error?: string | null
  onUpload: (file: File) => void | Promise<void>
  onDelete: (imageId: string) => void
  onSetPrimary: (imageId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onOpenGallery?: () => void
}

const SPINNER = (cls: string) => (
  <svg className={cls} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
  </svg>
)

export default function ImageGalleryEditor({
  images,
  maxImages = 5,
  size = 'md',
  uploading = false,
  pendingAdds = 0,
  deleting = {},
  error,
  onUpload,
  onDelete,
  onSetPrimary,
  onReorder,
  onOpenGallery,
}: Props) {
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [fileOver, setFileOver] = useState(false)

  const tile = size === 'sm' ? 'w-20 h-20' : 'w-24 h-24'
  const used = images.length + pendingAdds
  const slotsLeft = Math.max(0, maxImages - used)
  const isEmpty = used === 0

  function finishDrag(to: number | null) {
    const from = dragIndex.current
    dragIndex.current = null
    setDragOver(null)
    if (from === null || to === null || from === to) return
    onReorder(from, to)
  }

  async function acceptFiles(list: FileList | null) {
    if (!list) return
    for (const f of Array.from(list).slice(0, slotsLeft)) {
      if (f.type.startsWith('image/')) await onUpload(f)
    }
  }

  return (
    <div className="space-y-2">
      {images.length > 1 && (
        <p className="text-xs text-foreground-muted">
          Drag a tile to reorder. The starred image shows first on the product page.
        </p>
      )}

      <div
        className={`flex flex-wrap gap-2 rounded-lg transition-colors ${fileOver ? 'ring-2 ring-accent-500 ring-offset-2 ring-offset-surface' : ''}`}
        onDragOver={e => {
          if (Array.from(e.dataTransfer.types).includes('Files') && slotsLeft > 0) {
            e.preventDefault()
            setFileOver(true)
          }
        }}
        onDragLeave={e => {
          if (e.currentTarget === e.target) setFileOver(false)
        }}
        onDrop={e => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          setFileOver(false)
          acceptFiles(e.dataTransfer.files)
        }}
      >
        {images.map((img, idx) => {
          const isDropTarget = dragOver === idx && dragIndex.current !== idx
          return (
            <div
              key={img.id}
              className={`relative group ${tile} rounded-lg border overflow-hidden bg-surface select-none transition-all ${img.is_primary ? 'border-accent-500 ring-1 ring-accent-500' : 'border-border-default'} ${isDropTarget ? 'ring-2 ring-accent-400 scale-[1.03]' : ''}`}
              draggable
              onDragStart={e => {
                dragIndex.current = idx
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnter={() => {
                if (dragIndex.current !== null) setDragOver(idx)
              }}
              onDragOver={e => {
                if (dragIndex.current !== null) e.preventDefault()
              }}
              onDrop={e => {
                if (dragIndex.current !== null) {
                  e.preventDefault()
                  e.stopPropagation()
                  finishDrag(idx)
                }
              }}
              onDragEnd={() => finishDrag(dragOver)}
            >
              <img
                src={img.thumbnail_url || img.image_url}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
              />

              <span className="absolute top-1 right-1 min-w-[16px] text-center text-[10px] bg-black/65 text-white rounded px-1 leading-4 font-semibold pointer-events-none">
                {idx + 1}
              </span>
              {img.is_primary && (
                <span className="absolute top-1 left-1 flex items-center gap-0.5 bg-accent-500 text-white rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none pointer-events-none">
                  <Star className="w-2.5 h-2.5 fill-current" /> Main
                </span>
              )}

              <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                <GripVertical className="w-4 h-4 text-white/70 cursor-grab active:cursor-grabbing" aria-hidden />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => !img.is_primary && onSetPrimary(img.id)}
                    disabled={img.is_primary}
                    className="text-yellow-300 hover:text-yellow-100 disabled:opacity-40 disabled:cursor-default leading-none"
                    title={img.is_primary ? 'Already the main image' : 'Set as main image'}
                    aria-label={img.is_primary ? 'Already the main image' : 'Set as main image'}
                  >
                    <Star className={`w-4 h-4 ${img.is_primary ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(img.id)}
                    disabled={!!deleting[img.id]}
                    className="text-red-300 hover:text-red-100 disabled:opacity-50 leading-none"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {images.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => idx > 0 && onReorder(idx, idx - 1)}
                      disabled={idx === 0}
                      className="w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                      title="Move left"
                      aria-label="Move image left"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => idx < images.length - 1 && onReorder(idx, idx + 1)}
                      disabled={idx === images.length - 1}
                      className="w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                      title="Move right"
                      aria-label="Move image right"
                    >
                      ▶
                    </button>
                  </div>
                )}
              </div>

              {deleting[img.id] && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                  {SPINNER('w-5 h-5 text-white animate-spin')}
                </div>
              )}
            </div>
          )
        })}

        {Array.from({ length: pendingAdds }).map((_, k) => (
          <div
            key={`pending-${k}`}
            className={`relative ${tile} rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center overflow-hidden`}
          >
            <div className="absolute inset-0 animate-pulse bg-surface-tertiary/40" />
            {SPINNER('relative w-5 h-5 text-foreground-muted animate-spin')}
          </div>
        ))}

        {slotsLeft > 0 && (
          <label
            className={`${isEmpty ? `w-full ${size === 'sm' ? 'h-20' : 'h-24'} flex-row gap-2` : `${tile} flex-col gap-1`} rounded-lg border-2 border-dashed border-border-secondary flex items-center justify-center cursor-pointer hover:border-accent-400 hover:bg-surface-secondary/50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={e => {
                acceptFiles(e.target.files)
                e.target.value = ''
              }}
            />
            {uploading ? (
              SPINNER('w-4 h-4 text-foreground-muted animate-spin')
            ) : (
              <>
                <svg
                  className={`${isEmpty ? 'w-6 h-6' : 'w-5 h-5'} text-foreground-muted`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className={`${isEmpty ? 'text-xs' : 'text-[10px]'} text-foreground-muted leading-none`}>
                  {isEmpty ? 'Drop images here, or click to browse' : 'Drop or click'}
                </span>
              </>
            )}
          </label>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {onOpenGallery && slotsLeft > 0 && (
          <button
            type="button"
            onClick={onOpenGallery}
            className="px-2.5 py-1 bg-surface-secondary hover:bg-surface-elevated border border-border-default text-foreground-secondary rounded-lg text-xs font-semibold transition-colors"
          >
            Choose from Gallery
          </button>
        )}
        <span className="text-[11px] text-foreground-muted">
          {used} of {maxImages} used
        </span>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
