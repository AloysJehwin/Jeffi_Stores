// Product media types and pure helpers, safe to import from client components.

export const MEDIA_KINDS = ['image', 'video', 'external_video', 'document', 'model_3d', 'spin_360', 'audio'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Kinds that inherit together: a scope with its own video overrides the parent's video only. */
export type MediaGroup = 'image' | 'video' | 'document' | 'model_3d' | 'spin_360' | 'audio'
export const MEDIA_GROUPS: MediaGroup[] = ['image', 'video', 'model_3d', 'spin_360', 'audio', 'document']
export const mediaGroup = (kind: string): MediaGroup => (kind === 'external_video' ? 'video' : (kind as MediaGroup))

export const MEDIA_GROUP_LABEL: Record<MediaGroup, string> = {
  image: 'Images',
  video: 'Videos',
  model_3d: '3D models',
  spin_360: '360° views',
  audio: 'Audio',
  document: 'Documents',
}

export interface ProductMediaItem {
  id: string
  kind: MediaKind
  url: string
  thumbnail_url: string | null
  s3_key?: string | null
  s3_thumbnail_key?: string | null
  file_name: string | null
  mime: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  alt: string | null
  caption: string | null
  sort_order: number
  is_primary: boolean
  status?: string
  /** spin_360: { frames: string[] } · model_3d: { usdz_url?, usdz_key? } · external_video: { provider, video_id } · image: { blurhash? } · document: { pages? } */
  metadata: Record<string, any>
  product_id: string | null
  variant_id: string | null
  sub_variant_id: string | null
  created_at?: string
}

/** What the draft stages under fields._media. */
export interface StagedMedia {
  items: ProductMediaItem[]
  /** Sub-variant "use own media" switches changed in this draft. */
  own_sub?: Record<string, boolean>
}

export interface MediaScope {
  variantId?: string | null
  subVariantId?: string | null
}

export const scopeOf = (m: Pick<ProductMediaItem, 'variant_id' | 'sub_variant_id'>): MediaScope => ({
  variantId: m.variant_id ?? null,
  subVariantId: m.sub_variant_id ?? null,
})
export const scopeKey = (s: MediaScope): string =>
  s.subVariantId ? `sub:${s.subVariantId}` : s.variantId ? `variant:${s.variantId}` : 'product'
export const inScope = (m: ProductMediaItem, s: MediaScope): boolean => scopeKey(scopeOf(m)) === scopeKey(s)

export interface MediaLimits {
  maxPerScope: number
  imageMb: number
  videoMb: number
  videoSeconds: number
  documentMb: number
  audioMb: number
  audioSeconds: number
  modelMb: number
  spinFrames: number
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  maxPerScope: 12,
  imageMb: 5,
  videoMb: 50,
  videoSeconds: 180,
  documentMb: 10,
  audioMb: 10,
  audioSeconds: 600,
  modelMb: 25,
  spinFrames: 72,
}

export const ACCEPT: Record<MediaGroup, string> = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/webm',
  document: 'application/pdf',
  audio: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.m4a,.ogg',
  model_3d: '.glb,model/gltf-binary',
  spin_360: 'image/jpeg,image/png,image/webp',
}

export interface ExternalVideo {
  provider: 'youtube' | 'vimeo'
  videoId: string
  embedUrl: string
  watchUrl: string
  thumbnailUrl: string | null
}

/** A YouTube or Vimeo link in any of its usual forms; null for anything else. */
export function parseExternalVideo(raw: string): ExternalVideo | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^(www|m)\./, '')
  const seg = u.pathname.split('/').filter(Boolean)
  let yt: string | null = null
  if (host === 'youtu.be') yt = seg[0] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (seg[0] === 'watch') yt = u.searchParams.get('v')
    else if (['embed', 'shorts', 'live', 'v'].includes(seg[0])) yt = seg[1] ?? null
  }
  if (yt && /^[A-Za-z0-9_-]{6,20}$/.test(yt))
    return {
      provider: 'youtube',
      videoId: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      watchUrl: `https://www.youtube.com/watch?v=${yt}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = seg.filter(s => /^\d{5,12}$/.test(s)).pop()
    if (id)
      return {
        provider: 'vimeo',
        videoId: id,
        embedUrl: `https://player.vimeo.com/video/${id}`,
        watchUrl: `https://vimeo.com/${id}`,
        thumbnailUrl: null,
      }
  }
  return null
}

/** The embed URL of an external_video item (stored url is the watch link). */
export const embedUrlOf = (m: Pick<ProductMediaItem, 'url'>): string | null => parseExternalVideo(m.url)?.embedUrl ?? null

const ordered = (items: ProductMediaItem[]) =>
  [...items].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)

/**
 * Media to show for a selection, with inheritance: for each group, the sub-variant's own items,
 * else the variant's, else the product's. `items` must already leave out scopes that do not use
 * their own media (loadProductMedia does).
 */
export function resolveMedia(items: ProductMediaItem[], sel: MediaScope = {}): ProductMediaItem[] {
  const out: ProductMediaItem[] = []
  for (const g of MEDIA_GROUPS) {
    const of = items.filter(m => mediaGroup(m.kind) === g && (m.status ?? 'ready') === 'ready')
    const sub = sel.subVariantId ? of.filter(m => m.sub_variant_id === sel.subVariantId) : []
    const variant = sel.variantId ? of.filter(m => m.variant_id === sel.variantId) : []
    const own = sub.length ? sub : variant.length ? variant : of.filter(m => m.product_id)
    out.push(...ordered(own))
  }
  return out
}

/** Image URLs for a selection, primary first (thumbnails, feeds, share cards). */
export const resolveImageUrls = (items: ProductMediaItem[], sel: MediaScope = {}): string[] =>
  resolveMedia(items, sel)
    .filter(m => m.kind === 'image')
    .map(m => m.url)

/** A still for any item: its thumbnail/poster, the first 360 frame, or the image itself. */
export function mediaPoster(m: ProductMediaItem): string | null {
  if (m.thumbnail_url) return m.thumbnail_url
  if (m.kind === 'image') return m.url
  if (m.kind === 'spin_360') return (m.metadata?.frames as string[] | undefined)?.[0] ?? null
  if (m.kind === 'external_video') return parseExternalVideo(m.url)?.thumbnailUrl ?? null
  return null
}

export function formatBytes(n?: number | null): string {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** schema.org VideoObject / 3DModel entries for a product's media (PDP structured data). */
export function mediaStructuredData(items: ProductMediaItem[], name: string, description?: string | null): Record<string, any>[] {
  const out: Record<string, any>[] = []
  const desc = (description || name).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  for (const m of items) {
    const uploadDate = m.created_at ? new Date(m.created_at).toISOString() : undefined
    if (m.kind === 'video' || m.kind === 'external_video') {
      const thumb = mediaPoster(m)
      if (!thumb) continue
      const ext = m.kind === 'external_video' ? parseExternalVideo(m.url) : null
      out.push({
        '@type': 'VideoObject',
        name: m.caption || m.alt || name,
        description: desc,
        thumbnailUrl: thumb,
        ...(uploadDate && { uploadDate }),
        ...(ext ? { embedUrl: ext.embedUrl } : { contentUrl: m.url }),
        ...(m.duration_seconds ? { duration: `PT${Math.round(Number(m.duration_seconds))}S` } : {}),
      })
    } else if (m.kind === 'model_3d') {
      out.push({
        '@type': '3DModel',
        name: m.caption || m.alt || name,
        encoding: [
          { '@type': 'MediaObject', contentUrl: m.url, encodingFormat: 'model/gltf-binary' },
          ...(m.metadata?.usdz_url ? [{ '@type': 'MediaObject', contentUrl: m.metadata.usdz_url, encodingFormat: 'model/vnd.usdz+zip' }] : []),
        ],
      })
    }
  }
  return out
}
