'use client'

import { useState, useEffect, useRef } from 'react'
import { Play } from 'lucide-react'
import { Dialog, InfiniteFooter, fetchJson, fieldInputCls, tabCls, useInfiniteList, type InfiniteList } from '@/components/admin/kit'
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
  blurhash?: string | null
  mime_type?: string | null
  width?: number | null
  height?: number | null
}

/** A gallery_videos row as /api/admin/media/videos returns it. */
export interface GalleryVideo {
  id: string
  url: string
  mime: string
  duration_seconds: number | null
  width: number | null
  height: number | null
  aspect: string | null
  /** Poster frame (uploaded) or the image an AI video started from. */
  thumbnail_url: string | null
  blurhash: string | null
  label: string | null
  source: string
  prompt_text: string | null
}

interface Category {
  id: string
  name: string
}

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
  /** Adds an Images | Videos tab; picking a video calls this. */
  onPickVideo?: (video: GalleryVideo) => void
  /** Tab to open on when videos are offered. */
  initialTab?: 'images' | 'videos'
}

const PANEL_INPUT = fieldInputCls

/**
 * Shared gallery image picker modal. Server-paginated via /api/gallery
 * (page/limit/search/category — search + category are applied server-side so
 * they span all pages, not just the loaded one). Used by product images,
 * variant images, and the bulk product-controls image op.
 */
export default function GalleryPicker({ mode = 'multi', maxSelect, onConfirm, onClose, pageSize = 24, onPickVideo, initialTab = 'images' }: Props) {
  const [tab, setTab] = useState<'images' | 'videos'>(onPickVideo ? initialTab : 'images')
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pages of pageSize append on scroll; search + category reset to page 1.
  const list = useInfiniteList<GalleryImage>({
    key: `${query}|${category}`,
    pageSize,
    getKey: g => g.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams({ page: String(p), limit: String(pageSize) })
      if (query) params.set('search', query)
      if (category) params.set('category', category)
      const data = await fetchJson(`/api/gallery?${params.toString()}`, signal)
      return { rows: data.images || [], total: data.total || 0 }
    },
  })
  const images = list.rows
  const loading = list.loading

  const videoList = useInfiniteList<GalleryVideo>({
    key: tab === 'videos' ? `v|${query}` : null,
    pageSize,
    getKey: v => v.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams({ page: String(p), limit: String(pageSize) })
      if (query) params.set('search', query)
      const data = await fetchJson(`/api/admin/media/videos?${params.toString()}`, signal)
      return { rows: data.videos || [], total: data.total || 0 }
    },
  })
  const showVideos = tab === 'videos'

  // Load categories once.
  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { categories: [] }))
      .then(d => setCategories(d.categories || []))
      .catch(() => {})
  }, [])

  // Debounce the search box.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setQuery(search.trim()), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const onSearch = (v: string) => setSearch(v)
  const onCategory = (v: string) => setCategory(v)

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
    // Preserve selection order; every loaded page stays in `images`.
    const picked = selected.map(id => images.find(g => g.id === id)).filter(Boolean) as GalleryImage[]
    if (picked.length) onConfirm(picked)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      zIndex="z-[300]"
      size="xl"
      title="Choose from Gallery"
      footer={
        mode === 'multi' && !showVideos ? (
          <>
            <button type="button" onClick={onClose} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmMulti}
              disabled={selected.length === 0}
              className="control-md bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
            >
              {selected.length > 0 ? `Add ${selected.length} Image${selected.length > 1 ? 's' : ''}` : 'Add Images'}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="-m-5">
        {onPickVideo && (
          <div role="tablist" className="flex gap-0.5 px-5 border-b border-border-default">
            {(['images', 'videos'] as const).map(t => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={tabCls(tab === t)}>
                {t === 'images' ? 'Images' : 'Videos'}
              </button>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-b border-border-default flex gap-2 items-center">
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={e => onSearch(e.target.value)}
            className={`flex-1 min-w-0 ${PANEL_INPUT}`}
          />
          <div className={`w-36 sm:w-48 shrink-0 ${showVideos ? 'hidden' : ''}`}>
            <AdminSelect
              value={category}
              onChange={onCategory}
              placeholder="All categories"
              options={[
                { value: '', label: 'All categories' },
                ...categories.map(c => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
        </div>

        {showVideos ? (
          <VideoGrid list={videoList} search={search} onPick={v => onPickVideo?.(v)} />
        ) : (
          <div className="p-4 pr-3">
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
                        <div className="absolute top-1 right-1 bg-accent-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold z-10">
                          {selIdx + 1}
                        </div>
                      )}
                      <div className="aspect-square">
                        <ImgWithSkeleton
                          src={gimg.thumbnail_url || gimg.image_url}
                          alt={gimg.custom_name || gimg.file_name}
                          blurhash={gimg.blurhash}
                          className="w-full h-full object-cover"
                        />
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
            {!loading && <InfiniteFooter shown={images.length} control={list} noun="images" />}
          </div>
        )}
      </div>
    </Dialog>
  )
}

function VideoGrid({ list, search, onPick }: { list: InfiniteList<GalleryVideo>; search: string; onPick: (v: GalleryVideo) => void }) {
  const videos = list.rows
  return (
    <div className="p-4 pr-3">
      {list.loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!list.loading && videos.length === 0 && (
        <p className="text-center text-foreground-secondary py-16">{search ? 'No videos match your search.' : 'No videos in gallery yet.'}</p>
      )}
      {!list.loading && videos.length > 0 && (
        <div className="grid grid-cols-4 gap-3 w-full">
          {videos.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(v)}
              className="relative rounded-lg overflow-hidden border-2 border-border-default hover:border-accent-400 transition-colors text-left"
            >
              <div className="relative aspect-square bg-black">
                {v.thumbnail_url ? (
                  <ImgWithSkeleton src={v.thumbnail_url} alt={v.label || 'Video'} blurhash={v.blurhash} className="w-full h-full object-cover" />
                ) : (
                  <video src={v.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                )}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                    <Play className="h-4 w-4" />
                  </span>
                </span>
                {v.duration_seconds != null && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[10px] font-medium text-white tabular-nums">
                    {Math.round(v.duration_seconds)}s
                  </span>
                )}
              </div>
              <div className="px-1.5 py-1 bg-surface-secondary">
                <p className="text-xs text-foreground-secondary truncate">{v.label || (v.source === 'ai' ? 'AI video' : 'Video')}</p>
                {v.aspect && <p className="text-xs text-foreground-muted truncate">{v.aspect}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
      {!list.loading && <InfiniteFooter shown={videos.length} control={list} noun="videos" />}
    </div>
  )
}
