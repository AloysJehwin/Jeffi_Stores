'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Copy, Link2, Loader2, Star, Trash2, Upload, Images as ImagesIcon, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import GalleryPicker, { type GalleryImage, type GalleryVideo } from '../GalleryPicker'
import AiMediaButton from '../ai/AiMediaButton'
import AiVideoButton from '../ai/AiVideoButton'
import AdminSelect from '../AdminSelect'
import AIEnrichButton from '../AIEnrichButton'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'
import { galleryUpload, readVideoFile, uploadGalleryVideo } from '../media/media-upload'
import MediaItemView, { KIND_ICON, KIND_LABEL, MediaThumb } from '@/components/media/MediaItemView'
import {
  ACCEPT,
  MEDIA_GROUPS,
  MEDIA_GROUP_LABEL,
  formatBytes,
  mediaGroup,
  parseExternalVideo,
  resolveMedia,
  scopeKey,
  type MediaGroup,
  type MediaKind,
  type MediaLimits,
  type MediaScope,
  type ProductMediaItem,
  type StagedMedia,
} from '@/lib/catalog/product-media-shared'

export interface MediaVariant {
  id: string
  name: string
  useOwn: boolean
  subs: { id: string; name: string; useOwn: boolean }[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const btn =
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border-secondary bg-surface text-xs font-medium text-foreground hover:bg-surface-secondary disabled:opacity-50'
const inputCls =
  'field-normal w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent'

function blank(kind: MediaKind, scope: MediaScope, productId: string): ProductMediaItem {
  return {
    id: crypto.randomUUID(),
    kind,
    url: '',
    thumbnail_url: null,
    s3_key: null,
    s3_thumbnail_key: null,
    file_name: null,
    mime: null,
    size_bytes: null,
    width: null,
    height: null,
    duration_seconds: null,
    alt: null,
    caption: null,
    sort_order: 0,
    is_primary: false,
    status: 'ready',
    metadata: {},
    product_id: scope.variantId || scope.subVariantId ? null : productId,
    variant_id: scope.subVariantId ? null : (scope.variantId ?? null),
    sub_variant_id: scope.subVariantId ?? null,
  }
}

function kindOfFile(f: File): MediaKind | null {
  const n = f.name.toLowerCase()
  if (f.type.startsWith('image/')) return 'image'
  if (f.type === 'video/mp4' || f.type === 'video/webm') return 'video'
  if (f.type === 'application/pdf' || n.endsWith('.pdf')) return 'document'
  if (f.type.startsWith('audio/') || /\.(mp3|m4a|ogg)$/.test(n)) return 'audio'
  if (n.endsWith('.glb')) return 'model_3d'
  return null
}

function mimeOf(f: File): string {
  const n = f.name.toLowerCase()
  if (n.endsWith('.glb')) return 'model/gltf-binary'
  if (n.endsWith('.usdz')) return 'model/vnd.usdz+zip'
  if (n.endsWith('.m4a')) return 'audio/mp4'
  if (n.endsWith('.mp3')) return 'audio/mpeg'
  if (n.endsWith('.ogg')) return 'audio/ogg'
  return f.type
}

function mediaDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const a = document.createElement('audio')
    const src = URL.createObjectURL(file)
    const done = (v: number | null) => {
      URL.revokeObjectURL(src)
      resolve(v)
    }
    a.preload = 'metadata'
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null)
    a.onerror = () => done(null)
    a.src = src
  })
}

// First page of a PDF as a JPEG (pdf.js, already used by the vault viewer). Null when it can't render.
async function pdfThumbnail(file: File): Promise<Blob | null> {
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = `/api/vault/pdf-worker?v=${pdfjs.version}`
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 600 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    return await new Promise(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.85))
  } catch {
    return null
  }
}

export default function MediaManager({
  productId,
  initial,
  variants,
  limits,
  readOnly: readOnlyProp,
  scope,
  onScope,
  onVariantOwn,
  onChange,
  onCountsChange,
  ai,
}: {
  /** Prompt seeds for the AI image and video generators. */
  ai?: { imagePrompt?: string; videoPrompt?: string; context?: string }
  productId: string
  initial: StagedMedia
  variants: MediaVariant[]
  limits: MediaLimits
  readOnly?: boolean
  scope: MediaScope
  onScope: (s: MediaScope) => void
  /** The variant's "use own media" switch lives on the variant row (use_own_images). */
  onVariantOwn: (variantId: string, on: boolean) => void
  /** Called after any change, so the form autosaves the draft. */
  onChange: () => void
  /** Items per scope key, for the Variants tab summary. */
  onCountsChange?: (counts: Record<string, number>) => void
}) {
  const canWrite = useCanWrite('products')
  const readOnly = readOnlyProp || !canWrite
  const [items, setItems] = useState<ProductMediaItem[]>(() => (initial.items || []).map(m => ({ ...m, metadata: m.metadata ?? {} })))
  const [ownSub, setOwnSub] = useState<Record<string, boolean>>(initial.own_sub ?? {})
  const [touched, setTouched] = useState(false)
  const [filter, setFilter] = useState<MediaGroup | 'all'>('all')
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const dragId = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const spinRef = useRef<HTMLInputElement>(null)

  const key = scopeKey(scope)
  useEffect(() => {
    const c: Record<string, number> = {}
    for (const m of items) {
      const k = scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id })
      c[k] = (c[k] ?? 0) + 1
    }
    onCountsChange?.(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  const variant = variants.find(v => v.id === (scope.variantId ?? variants.find(x => x.subs.some(s => s.id === scope.subVariantId))?.id))
  const sub = scope.subVariantId ? variant?.subs.find(s => s.id === scope.subVariantId) : null
  const subOwn = (id: string, fallback: boolean) => ownSub[id] ?? fallback
  const scopeOwn = sub ? subOwn(sub.id, sub.useOwn) : variant && scope.variantId ? variant.useOwn : true

  const commit = (fn: (prev: ProductMediaItem[]) => ProductMediaItem[]) => {
    setItems(prev => fn(prev))
    setTouched(true)
    setTimeout(onChange, 0)
  }
  const inScopeOf = (k: string) => items.filter(m => scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id }) === k)
  const scoped = useMemo(
    () => inScopeOf(key).sort((a, b) => a.sort_order - b.sort_order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, key]
  )
  const visible = filter === 'all' ? scoped : scoped.filter(m => mediaGroup(m.kind) === filter)

  // What this scope shows while it inherits: the parent chain, own scopes only.
  const effective = useMemo(() => {
    const ownVariant = new Set(variants.filter(v => v.useOwn).map(v => v.id))
    const ownSubs = new Set(variants.flatMap(v => v.subs.filter(s => subOwn(s.id, s.useOwn)).map(s => s.id)))
    return items.filter(m => (m.sub_variant_id ? ownSubs.has(m.sub_variant_id) : m.variant_id ? ownVariant.has(m.variant_id) : true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, variants, ownSub])
  const inherited = scopeOwn ? [] : resolveMedia(effective, scope)

  const countFor = (k: string) => inScopeOf(k).length
  const room = () => limits.maxPerScope - scoped.length
  const primaryImageUrl = (scoped.find(m => m.kind === 'image' && m.is_primary) ?? scoped.find(m => m.kind === 'image'))?.url || undefined

  const add = (partial: Partial<ProductMediaItem> & { kind: MediaKind }, at = scope) => {
    const base = blank(partial.kind, at, productId)
    commit(prev => {
      const k = scopeKey(at)
      const n = prev.filter(m => scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id }) === k)
      const hasPrimary = n.some(m => m.is_primary && mediaGroup(m.kind) === mediaGroup(partial.kind))
      return [...prev, { ...base, ...partial, id: base.id, sort_order: n.length, is_primary: !hasPrimary && partial.kind === 'image' }]
    })
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(b => b + 1)
    try {
      await fn()
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally {
      setBusy(b => b - 1)
    }
  }

  const api = `/api/admin/products/${productId}/media`
  const postJson = async (body: unknown) => {
    const r = await fetch(api, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
    return j
  }
  const uploadImage = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(api, { method: 'POST', credentials: 'include', body: fd })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`)
    return j.item as Partial<ProductMediaItem>
  }
  const uploadDirect = async (file: File, kind: 'document' | 'audio' | 'model_3d') => {
    const mime = mimeOf(file)
    const p = await postJson({ action: 'presign', kind, mimeType: mime, size: file.size })
    const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: file })
    if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`)
    const c = await postJson({ action: 'confirm', key: p.key })
    return { url: c.url as string, s3_key: c.key as string, mime, size_bytes: file.size, file_name: file.name.slice(0, 255) }
  }

  async function uploadFile(file: File) {
    const kind = kindOfFile(file)
    if (!kind) throw new Error(`${file.name}: unsupported file type`)
    const mb = file.size / 1024 / 1024
    const cap = { image: limits.imageMb, video: limits.videoMb, document: limits.documentMb, audio: limits.audioMb, model_3d: limits.modelMb }[
      kind as 'image'
    ]
    if (cap && mb > cap) throw new Error(`${file.name} is ${mb.toFixed(1)} MB; the limit is ${cap} MB`)
    if (kind === 'image') return add({ kind, ...(await uploadImage(file)) })
    if (kind === 'video') {
      const meta = await readVideoFile(file)
      if (meta.durationSec && meta.durationSec > limits.videoSeconds)
        throw new Error(`${file.name} runs ${Math.round(meta.durationSec)}s; the limit is ${limits.videoSeconds}s`)
      const { video, poster } = await uploadGalleryVideo(file)
      return add({
        kind,
        url: video.url,
        thumbnail_url: poster?.url ?? video.thumbnail_url,
        mime: video.mime,
        size_bytes: file.size,
        width: video.width,
        height: video.height,
        duration_seconds: video.duration_seconds,
        file_name: file.name.slice(0, 255),
        metadata: { gallery_video_id: video.id, ...(video.blurhash ? { blurhash: video.blurhash } : {}) },
      })
    }
    if (kind === 'audio') {
      const d = await mediaDuration(file)
      if (d && d > limits.audioSeconds) throw new Error(`${file.name} runs ${Math.round(d)}s; the limit is ${limits.audioSeconds}s`)
      return add({ kind, ...(await uploadDirect(file, 'audio')), duration_seconds: d ? Math.round(d * 100) / 100 : null })
    }
    if (kind === 'document') {
      const up = await uploadDirect(file, 'document')
      const thumb = await pdfThumbnail(file)
      const t = thumb ? await galleryUpload(thumb, `${file.name.replace(/\.pdf$/i, '')}-page1.jpg`).catch(() => null) : null
      return add({ kind, ...up, thumbnail_url: t?.url ?? null, caption: file.name.replace(/\.pdf$/i, '').slice(0, 500) })
    }
    return add({ kind: 'model_3d', ...(await uploadDirect(file, 'model_3d')), metadata: { ar: true } })
  }

  function onFiles(list: FileList | null) {
    if (!list?.length) return
    setError(null)
    const files = Array.from(list).slice(0, Math.max(0, room()))
    if (files.length < list.length) setError(`This scope holds up to ${limits.maxPerScope} items.`)
    void run(async () => {
      for (const f of files) await uploadFile(f).catch(e => setError(e.message))
    })
  }

  function onSpin(list: FileList | null) {
    if (!list?.length || room() < 1) return
    setError(null)
    const files = Array.from(list)
      .filter(f => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, limits.spinFrames)
    void run(async () => {
      const frames: Partial<ProductMediaItem>[] = []
      for (const f of files) frames.push(await uploadImage(f))
      if (frames.length < 2) throw new Error('A 360° view needs at least 2 frames')
      add({
        kind: 'spin_360',
        url: frames[0].url!,
        thumbnail_url: frames[0].thumbnail_url ?? frames[0].url ?? null,
        width: frames[0].width ?? null,
        height: frames[0].height ?? null,
        metadata: { frames: frames.map(f => f.url), frame_keys: frames.map(f => f.s3_key) },
      })
    })
  }

  function addUrl() {
    const v = parseExternalVideo(urlText)
    if (!v) return setError('Paste a YouTube or Vimeo link')
    if (room() < 1) return setError(`This scope holds up to ${limits.maxPerScope} items.`)
    add({ kind: 'external_video', url: v.watchUrl, thumbnail_url: v.thumbnailUrl, metadata: { provider: v.provider, video_id: v.videoId } })
    setUrlText('')
    setUrlOpen(false)
    setError(null)
  }

  function addFromGallery(images: GalleryImage[]) {
    setGalleryOpen(false)
    const pick = images.slice(0, Math.max(0, room()))
    void run(async () => {
      for (const g of pick) {
        const j = await postJson({ gallery_image_id: g.id })
        add({ kind: 'image', ...j.item })
      }
    })
  }
  function addGalleryVideo(v: GalleryVideo) {
    setGalleryOpen(false)
    if (room() < 1) return
    add({
      kind: 'video',
      url: v.url,
      thumbnail_url: v.thumbnail_url,
      mime: v.mime,
      width: v.width,
      height: v.height,
      duration_seconds: v.duration_seconds,
      file_name: v.label,
      metadata: { gallery_video_id: v.id },
    })
  }

  const patch = (id: string, p: Partial<ProductMediaItem>) => commit(prev => prev.map(m => (m.id === id ? { ...m, ...p } : m)))
  const remove = (id: string) => {
    commit(prev => prev.filter(m => m.id !== id))
    if (openId === id) setOpenId(null)
  }
  const setPrimary = (id: string) =>
    commit(prev => {
      const t = prev.find(m => m.id === id)
      if (!t) return prev
      const g = mediaGroup(t.kind)
      return prev.map(m =>
        scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id }) === key && mediaGroup(m.kind) === g
          ? { ...m, is_primary: m.id === id }
          : m
      )
    })
  const reorder = (id: string, toIndex: number) =>
    commit(prev => {
      const list = prev
        .filter(m => scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id }) === key)
        .sort((a, b) => a.sort_order - b.sort_order)
      const from = list.findIndex(m => m.id === id)
      if (from < 0 || toIndex < 0 || toIndex >= list.length || from === toIndex) return prev
      const [x] = list.splice(from, 1)
      list.splice(toIndex, 0, x)
      const order = new Map(list.map((m, i) => [m.id, i]))
      return prev.map(m => (order.has(m.id) ? { ...m, sort_order: order.get(m.id)! } : m))
    })

  function setOwn(on: boolean) {
    if (sub) {
      setOwnSub(o => ({ ...o, [sub.id]: on }))
      setTouched(true)
      setTimeout(onChange, 0)
    } else if (variant && scope.variantId) {
      setTouched(true)
      onVariantOwn(variant.id, on)
    }
  }

  // Copies (new ids) of the selected items, or the whole scope, into other scopes.
  function copyTo(targets: MediaScope[]) {
    const src = selected.size ? scoped.filter(m => selected.has(m.id)) : scoped
    commit(prev => {
      let next = [...prev]
      for (const t of targets) {
        const k = scopeKey(t)
        let n = next.filter(m => scopeKey({ variantId: m.variant_id, subVariantId: m.sub_variant_id }) === k).length
        for (const m of src) {
          if (n >= limits.maxPerScope) break
          const b = blank(m.kind, t, productId)
          next = [...next, { ...m, id: b.id, product_id: b.product_id, variant_id: b.variant_id, sub_variant_id: b.sub_variant_id, sort_order: n++, is_primary: false }]
        }
      }
      return next
    })
    // Copying into a scope means it should show its own media.
    for (const t of targets) {
      if (t.subVariantId) setOwnSub(o => ({ ...o, [t.subVariantId!]: true }))
      else if (t.variantId) onVariantOwn(t.variantId, true)
    }
    setCopyOpen(false)
    setSelected(new Set())
  }

  const open = items.find(m => m.id === openId) ?? null
  const scopeLabel = sub ? `${variant?.name} / ${sub.name}` : variant && scope.variantId ? variant.name : 'Product'
  const groupsPresent = MEDIA_GROUPS.filter(g => scoped.some(m => mediaGroup(m.kind) === g))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_1fr]">
      {touched && <input type="hidden" name="_media" value={JSON.stringify({ items, own_sub: ownSub } satisfies StagedMedia)} readOnly />}

      {/* Scope picker */}
      <nav aria-label="Media scope" className="space-y-1 rounded-xl border border-border-default bg-surface p-2 text-sm">
        <ScopeButton label="Product" count={countFor('product')} active={key === 'product'} own onClick={() => onScope({})} />
        {variants.map(v => (
          <div key={v.id}>
            <ScopeButton
              label={v.name}
              count={countFor(`variant:${v.id}`)}
              active={key === `variant:${v.id}`}
              own={v.useOwn}
              onClick={() => onScope({ variantId: v.id })}
            />
            {v.subs.map(s => (
              <ScopeButton
                key={s.id}
                nested
                label={s.name}
                count={countFor(`sub:${s.id}`)}
                active={key === `sub:${s.id}`}
                own={subOwn(s.id, s.useOwn)}
                onClick={() => onScope({ variantId: v.id, subVariantId: s.id })}
              />
            ))}
          </div>
        ))}
        {variants.length === 0 && <p className="px-2 py-1 text-xs text-foreground-muted">Saved variants appear here.</p>}
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{scopeLabel}</h3>
            <p className="text-xs text-foreground-muted">
              {scoped.length}/{limits.maxPerScope} items
              {key !== 'product' && (scopeOwn ? ' · own media' : ' · inherits from ' + (sub ? 'its variant' : 'the product'))}
            </p>
          </div>
          {key !== 'product' && (
            <label className="flex items-center gap-2 text-xs text-foreground-secondary">
              <input type="checkbox" checked={scopeOwn} disabled={readOnly} onChange={e => setOwn(e.target.checked)} />
              Use own media
            </label>
          )}
        </div>

        {!scopeOwn ? (
          <div className="rounded-xl border border-dashed border-border-secondary p-4">
            <p className="mb-3 text-xs text-foreground-muted">
              Shows {sub ? "its variant's" : "the product's"} media. Turn on “Use own media” to give it its own
              {scoped.length > 0 ? ` (${scoped.length} saved item${scoped.length === 1 ? '' : 's'} come back)` : ''}.
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {inherited.map(m => (
                <div key={m.id} className="aspect-square overflow-hidden rounded-lg border border-border-default opacity-80">
                  <MediaThumb m={m} />
                </div>
              ))}
              {inherited.length === 0 && <p className="col-span-full text-xs text-foreground-muted">Nothing to inherit yet.</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept={[ACCEPT.image, ACCEPT.video, ACCEPT.document, ACCEPT.audio, ACCEPT.model_3d].join(',')}
                onChange={e => {
                  onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <input
                ref={spinRef}
                type="file"
                multiple
                hidden
                accept={ACCEPT.spin_360}
                onChange={e => {
                  onSpin(e.target.files)
                  e.target.value = ''
                }}
              />
              <button type="button" className={btn} disabled={readOnly || room() < 1} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload
              </button>
              <button type="button" className={btn} disabled={readOnly || room() < 1} onClick={() => setUrlOpen(o => !o)}>
                <Link2 className="h-3.5 w-3.5" /> Video link
              </button>
              <button type="button" className={btn} disabled={readOnly || room() < 1} onClick={() => setGalleryOpen(true)}>
                <ImagesIcon className="h-3.5 w-3.5" /> From gallery
              </button>
              <button type="button" className={btn} disabled={readOnly || room() < 1} onClick={() => spinRef.current?.click()}>
                360° set
              </button>
              {!readOnly && room() > 0 && (
                <>
                  <AiMediaButton
                    feature="product_image"
                    scope="products"
                    sizes={[AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.portrait]}
                    defaultPrompt={ai?.imagePrompt}
                    referenceImageUrl={primaryImageUrl}
                    usageRef={productId}
                    saveToGallery
                    label="Generate with AI"
                    triggerClassName={btn}
                    onPick={img => {
                      if (img.galleryId) addFromGallery([{ id: img.galleryId } as GalleryImage])
                    }}
                  />
                  <AiVideoButton
                    scope="products"
                    defaultPrompt={ai?.videoPrompt ?? ai?.imagePrompt}
                    referenceImageUrl={primaryImageUrl}
                    defaultAspect="1:1"
                    usageRef={productId}
                    label="AI video"
                    triggerClassName={btn}
                    onPick={v =>
                      add({
                        kind: 'video',
                        url: v.url,
                        thumbnail_url: v.posterUrl ?? null,
                        duration_seconds: v.durationSec ?? null,
                        metadata: v.galleryVideoId ? { gallery_video_id: v.galleryVideoId } : {},
                      })
                    }
                  />
                </>
              )}
              <button type="button" className={btn} disabled={readOnly || scoped.length === 0} onClick={() => setCopyOpen(true)}>
                <Copy className="h-3.5 w-3.5" /> Copy {selected.size ? `${selected.size} selected` : 'all'} to…
              </button>
              {busy > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                </span>
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              Images, MP4/WebM video (≤{limits.videoMb} MB, {limits.videoSeconds}s), PDF (≤{limits.documentMb} MB), MP3/M4A/OGG (≤
              {limits.audioMb} MB), GLB 3D (≤{limits.modelMb} MB). Drag to reorder; the star marks the primary of each kind.
            </p>
            {urlOpen && (
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlText}
                  onChange={e => setUrlText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addUrl()
                    }
                  }}
                  placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
                  className={inputCls}
                />
                <button type="button" className={btn} onClick={addUrl}>
                  Add
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}

            {groupsPresent.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {(['all', ...groupsPresent] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFilter(g)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === g ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/70'}`}
                  >
                    {g === 'all' ? `All ${scoped.length}` : `${MEDIA_GROUP_LABEL[g]} ${scoped.filter(m => mediaGroup(m.kind) === g).length}`}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
              {visible.map(m => {
                const Icon = KIND_ICON[m.kind]
                const idx = scoped.indexOf(m)
                return (
                  <div
                    key={m.id}
                    draggable={!readOnly}
                    onDragStart={() => (dragId.current = m.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      if (dragId.current && dragId.current !== m.id) reorder(dragId.current, idx)
                      dragId.current = null
                    }}
                    className={`group relative overflow-hidden rounded-lg border-2 ${openId === m.id ? 'border-accent-500' : 'border-border-default'}`}
                  >
                    <button type="button" onClick={() => setOpenId(m.id)} className="block aspect-square w-full" title={KIND_LABEL[m.kind]}>
                      <MediaThumb m={m} />
                    </button>
                    <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                      <Icon className="h-3 w-3" />
                      {KIND_LABEL[m.kind]}
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Select for copy"
                      checked={selected.has(m.id)}
                      onChange={e =>
                        setSelected(s => {
                          const n = new Set(s)
                          if (e.target.checked) n.add(m.id)
                          else n.delete(m.id)
                          return n
                        })
                      }
                      className="absolute right-1 top-1"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1 py-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" title="Move earlier" disabled={readOnly || idx === 0} onClick={() => reorder(m.id, idx - 1)}>
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Primary" disabled={readOnly} onClick={() => setPrimary(m.id)}>
                        <Star className={`h-3.5 w-3.5 ${m.is_primary ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                      </button>
                      <button type="button" title="Remove" disabled={readOnly} onClick={() => remove(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Move later" disabled={readOnly || idx === scoped.length - 1} onClick={() => reorder(m.id, idx + 1)}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {m.is_primary && <Star className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-yellow-400 text-yellow-400 group-hover:hidden" />}
                  </div>
                )
              })}
              {visible.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-border-secondary p-6 text-center text-xs text-foreground-muted">
                  No media here yet.
                </div>
              )}
            </div>

            {open && scopeKey({ variantId: open.variant_id, subVariantId: open.sub_variant_id }) === key && (
              <ItemEditor
                m={open}
                aiContext={ai?.context}
                readOnly={readOnly}
                onPatch={p => patch(open.id, p)}
                onClose={() => setOpenId(null)}
                uploadImage={uploadImage}
                uploadUsdz={async f => {
                  const mime = 'model/vnd.usdz+zip'
                  const p = await postJson({ action: 'presign', kind: 'model_3d', mimeType: mime, size: f.size })
                  const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: f })
                  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
                  return postJson({ action: 'confirm', key: p.key })
                }}
              />
            )}
          </>
        )}
      </div>

      {galleryOpen && (
        <GalleryPicker
          mode="multi"
          maxSelect={Math.max(0, room())}
          onClose={() => setGalleryOpen(false)}
          onConfirm={addFromGallery}
          onPickVideo={addGalleryVideo}
        />
      )}
      {copyOpen && (
        <CopyDialog
          variants={variants}
          from={key}
          onClose={() => setCopyOpen(false)}
          onCopy={copyTo}
          count={selected.size || scoped.length}
        />
      )}
    </div>
  )
}

function ScopeButton({
  label,
  count,
  active,
  own,
  nested,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  own: boolean
  nested?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left ${nested ? 'pl-6 text-xs' : ''} ${active ? 'bg-accent-500/10 text-accent-700 font-medium' : 'text-foreground hover:bg-surface-secondary'}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-foreground-muted">{own ? count : 'inherits'}</span>
    </button>
  )
}

function CopyDialog({
  variants,
  from,
  count,
  onClose,
  onCopy,
}: {
  variants: MediaVariant[]
  from: string
  count: number
  onClose: () => void
  onCopy: (t: MediaScope[]) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const all: { key: string; label: string; scope: MediaScope; nested?: boolean; parent?: string }[] = [
    { key: 'product', label: 'Product', scope: {} },
    ...variants.flatMap(v => [
      { key: `variant:${v.id}`, label: v.name, scope: { variantId: v.id } },
      ...v.subs.map(s => ({ key: `sub:${s.id}`, label: s.name, scope: { variantId: v.id, subVariantId: s.id }, nested: true, parent: v.id })),
    ]),
  ].filter(x => x.key !== from)
  const toggle = (k: string, on: boolean) =>
    setPicked(p => {
      const n = new Set(p)
      if (on) n.add(k)
      else n.delete(k)
      return n
    })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Copy media">
      <div className="w-full max-w-md rounded-xl bg-surface-elevated p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Copy {count} item{count === 1 ? '' : 's'} to…</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {variants.map(v => {
            const subs = v.subs.map(s => `sub:${s.id}`).filter(k => k !== from)
            return subs.length > 0 ? (
              <button
                key={`all-${v.id}`}
                type="button"
                className="block text-xs text-accent-600 hover:underline"
                onClick={() => setPicked(p => new Set([...p, ...subs]))}
              >
                All sub-variants of {v.name}
              </button>
            ) : null
          })}
          {all.map(x => (
            <label key={x.key} className={`flex items-center gap-2 py-0.5 text-sm ${x.nested ? 'pl-5' : ''}`}>
              <input type="checkbox" checked={picked.has(x.key)} onChange={e => toggle(x.key, e.target.checked)} />
              {x.label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${btn} bg-accent-500 text-white border-accent-500 hover:bg-accent-600`}
            disabled={picked.size === 0}
            onClick={() => onCopy(all.filter(x => picked.has(x.key)).map(x => x.scope))}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}

function ItemEditor({
  m,
  readOnly,
  onPatch,
  onClose,
  uploadImage,
  uploadUsdz,
  aiContext,
}: {
  m: ProductMediaItem
  aiContext?: string
  readOnly?: boolean
  onPatch: (p: Partial<ProductMediaItem>) => void
  onClose: () => void
  uploadImage: (f: File) => Promise<Partial<ProductMediaItem>>
  uploadUsdz: (f: File) => Promise<{ url: string; key: string }>
}) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e: any) {
      setErr(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-border-default bg-surface p-4 md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-lg border border-border-default">
        <MediaItemView m={m} ar />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{KIND_LABEL[m.kind]}</span>
          <button type="button" onClick={onClose} aria-label="Close editor">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-foreground-muted break-all">
          {m.file_name || m.url}
          {m.size_bytes ? ` · ${formatBytes(m.size_bytes)}` : ''}
          {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
          {m.duration_seconds ? ` · ${Math.round(Number(m.duration_seconds))}s` : ''}
          {m.kind === 'spin_360' ? ` · ${(m.metadata?.frames ?? []).length} frames` : ''}
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-secondary">Alt text</label>
          <AIEnrichButton
            fieldLabel={`Alt text for a product ${KIND_LABEL[m.kind].toLowerCase()}`}
            value={m.alt ?? ''}
            onChange={v => onPatch({ alt: v.slice(0, 255) || null })}
            scope="products:write"
            context={[aiContext, m.caption && `Caption: ${m.caption}`, 'Short, literal description of what the media shows, under 125 characters.'].filter(Boolean).join('. ')}
            maxLength={125}
            write
          >
            <input
              type="text"
              maxLength={255}
              disabled={readOnly}
              value={m.alt ?? ''}
              onChange={e => onPatch({ alt: e.target.value || null })}
              className={`${inputCls} pr-8`}
              placeholder="Describe it for screen readers"
            />
          </AIEnrichButton>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-secondary">
            {m.kind === 'document' ? 'Title' : 'Caption'}
          </label>
          <input
            type="text"
            maxLength={500}
            disabled={readOnly}
            value={m.caption ?? ''}
            onChange={e => onPatch({ caption: e.target.value || null })}
            className={inputCls}
            placeholder={m.kind === 'document' ? 'e.g. Datasheet, User manual, BIS certificate' : ''}
          />
        </div>
        {m.kind === 'document' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-secondary">Document type</label>
            <AdminSelect
              disabled={readOnly}
              value={m.metadata?.doc_type ?? ''}
              onChange={v => onPatch({ metadata: { ...m.metadata, doc_type: v || undefined } })}
              options={[
                { value: '', label: 'Other' },
                { value: 'datasheet', label: 'Datasheet' },
                { value: 'manual', label: 'Manual' },
                { value: 'certificate', label: 'Certificate' },
                { value: 'warranty', label: 'Warranty card' },
              ]}
            />
          </div>
        )}
        {(m.kind === 'model_3d' || m.kind === 'video' || m.kind === 'audio') && (
          <label className={btn}>
            {m.thumbnail_url ? 'Replace poster' : 'Add poster image'}
            <input
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              disabled={readOnly || busy}
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void guard(async () => onPatch({ thumbnail_url: (await uploadImage(f)).url ?? null }))
              }}
            />
          </label>
        )}
        {m.kind === 'model_3d' && (
          <>
            <label className={btn}>
              {m.metadata?.usdz_url ? 'Replace USDZ (iOS AR)' : 'Add USDZ for iOS AR'}
              <input
                type="file"
                hidden
                accept=".usdz,model/vnd.usdz+zip"
                disabled={readOnly || busy}
                onChange={e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void guard(async () => {
                    const r = await uploadUsdz(f)
                    onPatch({ metadata: { ...m.metadata, usdz_url: r.url, usdz_key: r.key } })
                  })
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground-secondary">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={m.metadata?.ar !== false}
                onChange={e => onPatch({ metadata: { ...m.metadata, ar: e.target.checked } })}
              />
              Offer “View in your space” (AR)
            </label>
          </>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />}
        {err && <p className="text-xs text-red-500">{err}</p>}
        {!UUID_RE.test(m.id) && <p className="text-xs text-red-500">This item has an invalid id and will not be saved.</p>}
      </div>
    </div>
  )
}
