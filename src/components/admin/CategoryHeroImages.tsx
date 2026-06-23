'use client'

import { useState, useRef } from 'react'
import { Upload, Trash2, ImageIcon } from 'lucide-react'

interface Props {
  categoryId: string
  mobileImage: string | null
  desktopImage: string | null
}

function ImageSlot({
  label, variant, categoryId, currentImage,
  onUploaded, onCleared,
}: {
  label: string
  variant: 'mobile' | 'desktop'
  categoryId: string
  currentImage: string | null
  onUploaded: (path: string) => void
  onCleared: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setLoading(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('variant', variant)
    const res = await fetch(`/api/admin/categories/${categoryId}/hero-image`, { method: 'POST', body: form })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? 'Upload failed'); return }
    onUploaded(data.path)
  }

  async function handleClear() {
    setLoading(true)
    setError('')
    const res = await fetch(`/api/admin/categories/${categoryId}/hero-image`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    })
    setLoading(false)
    if (!res.ok) { setError('Clear failed'); return }
    onCleared()
  }

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">{label}</p>

      {currentImage ? (
        <div className="relative group rounded-xl overflow-hidden border border-border-default aspect-video bg-surface-secondary">
          <img src={currentImage} alt={label} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Replace
            </button>
            <button
              onClick={handleClear}
              disabled={loading}
              className="flex items-center gap-1.5 bg-red-500/80 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full aspect-video rounded-xl border-2 border-dashed border-border-default hover:border-primary-400 bg-surface-secondary hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all flex flex-col items-center justify-center gap-2 text-foreground-muted hover:text-primary-500"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ImageIcon className="w-7 h-7" />
              <span className="text-xs font-semibold">Upload image</span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export default function CategoryHeroImages({ categoryId, mobileImage, desktopImage }: Props) {
  const [mobile, setMobile] = useState(mobileImage)
  const [desktop, setDesktop] = useState(desktopImage)

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm p-5">
      <h3 className="text-sm font-bold text-foreground mb-1">Hero Carousel Images</h3>
      <p className="text-xs text-foreground-muted mb-4">
        Used in the homepage hero carousel. Mobile is portrait (768×1024), desktop is landscape (1440×640).
      </p>
      <div className="flex gap-4">
        <ImageSlot
          label="Mobile (portrait)"
          variant="mobile"
          categoryId={categoryId}
          currentImage={mobile}
          onUploaded={setMobile}
          onCleared={() => setMobile(null)}
        />
        <ImageSlot
          label="Desktop (landscape)"
          variant="desktop"
          categoryId={categoryId}
          currentImage={desktop}
          onUploaded={setDesktop}
          onCleared={() => setDesktop(null)}
        />
      </div>
    </div>
  )
}
