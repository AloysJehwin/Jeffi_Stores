'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import AdminSelect from '@/components/admin/AdminSelect'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

export interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url: string | null
  file_name: string
  custom_name?: string | null
  category_id?: string | null
  category_name?: string | null
  file_size?: number | null
  s3_key?: string | null
  s3_thumbnail_key?: string | null
  mime_type?: string | null
  width?: number | null
  height?: number | null
}

interface Category { id: string; name: string }

interface Props {
  /** single: click a tile → confirm one immediately. multi: numbered multi-select + confirm button. */
  mode?: 'single' | 'multi'
  /** Cap the number selectable in multi mode (e.g. remaining image slots). */
  maxSelect?: number
  /** Called with the chosen gallery image(s). Always an array (length 1 in single mode). */
  onConfirm: (images: GalleryImage[]) => void
  onClose: () => void
  /** Page size for the paginated gallery fetch. */
  pageSize?: number
}

const PANEL_INPUT = 'px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent'

/**
 * Shared gallery image picker modal. Server-paginated via /api/gallery
 * (page/limit/search/category — search + category are applied server-side so
 * they span all pages, not just the loaded one). Used by product images,
 * variant images, and the bulk product-controls image op.
 */
export default function GalleryPicker({ mode = 'multi', maxSelect, onConfirm, onClose, pageSize = 24 }: Props) {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const load = useCallback(async (p: number, q: string, cat: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(pageSize) })
      if (q.trim()) params.set('search', q.trim())
      if (cat) params.set('category', cat)
      const res = await fetch(`/api/gallery?${params.toString()}`, { credentials: 'include' })
      const data = res.ok ? await res.json() : { images: [], total: 0 }
      setImages(data.images || [])
      setTotal(data.total || 0)
    } catch {
      setImages([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [pageSize])

  // Load categories once.
  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { categories: [] })
      .then(d => setCategories(d.categories || []))
      .catch(() => {})
  }, [])

  // Fetch when page/category change immediately; debounce the search box.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(page, search, category), search ? 300 : 0)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [page, search, category, load])

  // Reset to page 1 when the filters change.
  function onSearch(v: string) { setSearch(v); setPage(1) }
  function onCategory(v: string) { setCategory(v); setPage(1) }

  function toggle(id: string) {
    if (mode === 'single') {
      const img = images.find(g => g.id === id)
      if (img) onConfirm([img])
      return
    }
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (maxSelect != null && prev.length >= maxSelect) return prev
      return [...prev, id]
    })
  }

  function confirmMulti() {
    // Preserve selection order. Selected ids may span pages we've navigated away
    // from; in practice callers select from the visible page, so map from current.
    const picked = selected.map(id => images.find(g => g.id === id)).filter(Boolean) as GalleryImage[]
    if (picked.length) onConfirm(picked)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center backdrop-blur-sm bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface-elevated rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-foreground">Choose from Gallery</h2>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors text-2xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-3 border-b border-border-default flex gap-2 items-center">
          <input type="text" placeholder="Search by name…" value={search} onChange={e => onSearch(e.target.value)} className={`flex-1 ${PANEL_INPUT}`} />
          <div className="w-48 shrink-0">
            <AdminSelect
              value={category}
              onChange={onCategory}
              placeholder="All categories"
              options={[{ value: '', label: 'All categories' }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4 pr-3">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && images.length === 0 && (
            <p className="text-center text-foreground-secondary py-16">
              {search || category ? 'No images match your filters.' : 'No images in gallery yet.'}
            </p>
          )}
          {!loading && images.length > 0 && (
            <div className="grid grid-cols-4 gap-3 w-full">
              {images.map(gimg => {
                const selIdx = selected.indexOf(gimg.id)
                const isSelected = mode === 'multi' && selIdx !== -1
                return (
                  <button
                    key={gimg.id}
                    type="button"
                    onClick={() => toggle(gimg.id)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-colors text-left ${isSelected ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-default hover:border-accent-400'}`}
                  >
                    {isSelected && (
                      <div className="absolute top-1 right-1 bg-accent-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold z-10">{selIdx + 1}</div>
                    )}
                    <div className="aspect-square">
                      <ImgWithSkeleton src={gimg.thumbnail_url || gimg.image_url} alt={gimg.custom_name || gimg.file_name} className="w-full h-full object-cover" />
                    </div>
                    <div className="px-1.5 py-1 bg-surface-secondary">
                      <p className="text-xs text-foreground-secondary truncate">{gimg.custom_name || gimg.file_name}</p>
                      {gimg.category_name && <p className="text-xs text-accent-500 truncate">{gimg.category_name}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="px-6 py-2.5 border-t border-border-default flex items-center justify-between text-xs text-foreground-secondary">
            <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-2 py-1 rounded-md border border-border-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors">Prev</button>
              <span className="px-2 tabular-nums">{page} / {totalPages}</span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-2 py-1 rounded-md border border-border-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors">Next</button>
            </div>
          </div>
        )}

        {mode === 'multi' && (
          <div className="px-6 py-4 border-t border-border-default flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-foreground-secondary hover:text-foreground transition-colors">Cancel</button>
            <button type="button" onClick={confirmMulti} disabled={selected.length === 0}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-surface-secondary disabled:text-foreground-muted text-white rounded-lg text-sm font-semibold transition-colors">
              {selected.length > 0 ? `Add ${selected.length} Image${selected.length > 1 ? 's' : ''}` : 'Add Images'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
