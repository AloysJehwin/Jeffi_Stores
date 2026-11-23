// Stock photos first, AI generation second (docs/plans/STOCK_IMAGES.md). A short keyword search goes to the gateway's
// /v1/images/stock (Pexels, then Pixabay); one hit is picked and copied into the store's bucket under a stable key
// (stock/<provider>-<id>), so a rebuild reuses the file. Free: no preauthorize/settle. Only when stock finds nothing
// does pictureFor fall back to generateImage, which bills as before.
import { aiGatewayHeaders, aiGatewayUrl } from '@/lib/shared/ai-client'
import { currentBucket, fetchRemoteImage, getS3Url, inspectObject, stableThumbnailKey, uploadGalleryImage } from '@/lib/shared/s3'
import { queryOne } from '@/lib/shared/db'
import { getRedisClient } from '@/lib/shared/redis'
import { generateImage, type GenerateImageOpts } from './media'
import type { StockCredit, StockSource } from './stock-credits'

/** The shape a picture is cut to (site-blocks' image field sizes). */
export type StockShape = 'hero' | 'wide' | 'landscape' | 'portrait' | 'story' | 'square'
type Orientation = 'landscape' | 'portrait' | 'square'

const ORIENTATION: Record<StockShape, Orientation> = { hero: 'landscape', wide: 'landscape', landscape: 'landscape', portrait: 'portrait', story: 'portrait', square: 'square' }
/** Narrower hits are left out; a hero needs 1600 px. */
export const STOCK_MIN_WIDTH: Record<StockShape, number> = { hero: 1600, wide: 1280, landscape: 1200, portrait: 800, story: 720, square: 1000 }

export interface StockHit {
  provider: StockSource
  id: string
  url: string
  width: number
  height: number
  alt: string
  photographer: string
  photographerUrl: string | null
  pageUrl: string
}

export interface StockPicture {
  url: string
  width: number
  height: number
  thumbnailUrl?: string
  galleryId?: string
  alt: string
  credit: StockCredit
}

const SEARCH_TIMEOUT_MS = 10_000
/** A pick comes from the first this many hits the site has not used yet. */
const TOP = 15
/** Recently used hits per query, across stores, so stores of one kind rarely share a picture. */
const RECENT_TTL_SEC = 14 * 86_400
/** uploadGalleryImage's longest edge. */
const GALLERY_EDGE = 1600

const hitKey = (h: { provider: string; id: string }) => `${h.provider}:${h.id}`

/** A short keyword search: lower case, letters and digits, at most `words` words. */
export function searchTerms(s: string, words = 4): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join(' ')
}

/** Each search with "indian" first, then as given (once, when it already says India). */
export function stockQueries(queries: string[]): string[] {
  const out: string[] = []
  for (const q of queries.map(x => searchTerms(x))) {
    if (!q) continue
    for (const v of /\bindia/.test(q) ? [q] : [`indian ${q}`, q]) if (!out.includes(v)) out.push(v)
  }
  return out
}

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** A number for a site from any id (a draft id), when it has no brief seed. */
export const seedOf = (id: string) => hash(id)

const validHit = (h: unknown): h is StockHit => {
  const x = h as StockHit
  return !!x && (x.provider === 'pexels' || x.provider === 'pixabay') && !!x.id && /^https:\/\//.test(x.url ?? '') && /^https:\/\//.test(x.pageUrl ?? '') && x.width > 0 && x.height > 0
}

/** The gateway's hits for one search, at least the shape's width; [] on any failure. */
export async function searchStock(query: string, shape: StockShape): Promise<StockHit[]> {
  try {
    const res = await fetch(`${aiGatewayUrl()}/v1/images/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiGatewayHeaders() },
      body: JSON.stringify({ query, orientation: ORIENTATION[shape], minWidth: STOCK_MIN_WIDTH[shape], perPage: 30 }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { results?: unknown[] }
    return Array.isArray(body.results) ? body.results.filter(validHit) : []
  } catch {
    return []
  }
}

/**
 * One hit from the first TOP the site has not used, steered by the site's seed: one not used recently by another
 * store when there is one.
 */
export function pickStock(hits: StockHit[], o: { minWidth: number; used: Set<string>; recent: Set<string>; seed: number; salt: string }): StockHit | null {
  const top = hits.filter(h => h.width >= o.minWidth && !o.used.has(hitKey(h))).slice(0, TOP)
  const fresh = top.filter(h => !o.recent.has(hitKey(h)))
  const pool = fresh.length ? fresh : top
  return pool.length ? pool[hash(`${o.seed}:${o.salt}`) % pool.length] : null
}

const recentKey = (query: string) => `stock:recent:${query}`

async function recentFor(query: string): Promise<Set<string>> {
  try {
    const r = getRedisClient()
    return typeof r?.smembers === 'function' ? new Set<string>(await r.smembers(recentKey(query))) : new Set()
  } catch {
    return new Set()
  }
}

async function noteRecent(query: string, key: string): Promise<void> {
  try {
    const r = getRedisClient()
    if (typeof r?.sadd !== 'function') return
    await r.sadd(recentKey(query), key)
    await r.expire(recentKey(query), RECENT_TTL_SEC)
  } catch {
    // a hint only
  }
}

async function tenantIdSafe(): Promise<string | null> {
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return await resolveTenantId()
  } catch {
    return null
  }
}

// The store's gallery keeps one row per stock file, with its credit and the photo's page (gallery_images.source_url).
async function recordGallery(hit: StockHit, up: { url: string; thumbnailUrl: string; s3Key: string; s3ThumbnailKey: string; fileName: string; fileSize: number | null; mimeType: string; width: number; height: number; blurhash: string | null }, credit: StockCredit, tenantId?: string | null): Promise<string | undefined> {
  try {
    const row = await queryOne<{ id: string }>(
      `WITH found AS (SELECT id FROM gallery_images WHERE s3_key = $3 AND source = 'stock' LIMIT 1),
       ins AS (
         INSERT INTO gallery_images (image_url, thumbnail_url, s3_key, s3_thumbnail_key, s3_bucket, file_name, file_size, mime_type, width, height, blurhash, custom_name, tenant_id, source, source_url, credit, media_kind)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'stock', $14, $15::jsonb, 'image' WHERE NOT EXISTS (SELECT 1 FROM found)
         RETURNING id)
       SELECT id FROM ins UNION ALL SELECT id FROM found LIMIT 1`,
      [up.url, up.thumbnailUrl, up.s3Key, up.s3ThumbnailKey, await currentBucket(), up.fileName, up.fileSize, up.mimeType, up.width, up.height, up.blurhash, `Stock: ${hit.alt || credit.name}`.slice(0, 255), tenantId ?? (await tenantIdSafe()), hit.pageUrl.slice(0, 1000), JSON.stringify(credit)]
    )
    return row?.id
  } catch (err) {
    console.warn(`[stock] gallery_images insert failed: ${(err as Error).message}`)
    return undefined
  }
}

/** The hit in the store's bucket at stock/<provider>-<id>: reused when already there, else downloaded and copied. */
export async function copyStock(hit: StockHit, o: { skipGallery?: boolean; tenantId?: string | null } = {}): Promise<StockPicture> {
  const key = `stock/${hit.provider}-${hit.id.replace(/[^A-Za-z0-9]/g, '')}`
  const credit: StockCredit = { name: hit.photographer.slice(0, 80), url: hit.photographerUrl, source: hit.provider, pageUrl: hit.pageUrl }
  const s3Key = `${key}.webp`
  let up
  if ((await inspectObject(s3Key, 1))?.size) {
    const scale = Math.min(1, GALLERY_EDGE / Math.max(hit.width, hit.height))
    const s3ThumbnailKey = stableThumbnailKey(key, 'webp')
    up = { url: await getS3Url(s3Key), thumbnailUrl: await getS3Url(s3ThumbnailKey), s3Key, s3ThumbnailKey, fileName: key.slice(6) + '.webp', fileSize: null, mimeType: 'image/webp', width: Math.round(hit.width * scale), height: Math.round(hit.height * scale), blurhash: null }
  } else {
    up = await uploadGalleryImage(await fetchRemoteImage(hit.url), key, { key })
  }
  const galleryId = o.skipGallery ? undefined : await recordGallery(hit, up, credit, o.tenantId)
  return { url: up.url, width: up.width, height: up.height, thumbnailUrl: up.thumbnailUrl, ...(galleryId ? { galleryId } : {}), alt: hit.alt, credit }
}

export interface StockRequest {
  /** Short searches, best first; each is tried with "indian" first. */
  queries: string[]
  shape: StockShape
  /** The site's seed (brief.seed), so one site's picks are stable and another site's differ. */
  seed: number
  /** provider:id pairs this site already shows; a pick is added to it. */
  used: Set<string>
  /** Preview-only pictures: copied, never listed in the store's gallery. */
  skipGallery?: boolean
  tenantId?: string | null
}

/** A stock picture for the request, or null (no key, no hit, or every copy failed). Never throws. */
export async function stockPicture(r: StockRequest): Promise<StockPicture | null> {
  const minWidth = STOCK_MIN_WIDTH[r.shape]
  for (const q of stockQueries(r.queries)) {
    const hits = await searchStock(q, r.shape)
    if (!hits.length) continue
    const recent = await recentFor(q)
    for (let attempt = 0; attempt < 2; attempt++) {
      const hit = pickStock(hits, { minWidth, used: r.used, recent, seed: r.seed, salt: `${q}:${attempt}` })
      if (!hit) break
      // Taken before the copy, so parallel workers never pick the same one; a failed copy stays out too.
      r.used.add(hitKey(hit))
      try {
        const pic = await copyStock(hit, r)
        await noteRecent(q, hitKey(hit))
        return pic
      } catch (err) {
        console.warn(`[stock] ${hitKey(hit)} not copied: ${(err as Error).message?.slice(0, 200)}`)
      }
    }
  }
  return null
}

export interface PictureRequest {
  stock?: StockRequest | null
  /** The AI fallback; absent = stock only. */
  ai?: GenerateImageOpts | null
  /** Asked just before the AI fallback (the studio's budget). */
  aiAllowed?: () => boolean
}

export interface Picture {
  url: string
  width: number
  height: number
  galleryId?: string
  alt?: string
  /** Set for a stock photo; null for an AI one. */
  credit: StockCredit | null
  source: 'stock' | 'ai'
}

/** Stock first, then AI generation. Null when neither made one; an AI failure throws as generateImage does. */
export async function pictureFor(p: PictureRequest): Promise<Picture | null> {
  const s = p.stock ? await stockPicture(p.stock).catch(() => null) : null
  if (s) return { url: s.url, width: s.width, height: s.height, ...(s.galleryId ? { galleryId: s.galleryId } : {}), alt: s.alt, credit: s.credit, source: 'stock' }
  if (!p.ai || (p.aiAllowed && !p.aiAllowed())) return null
  const img = (await generateImage(p.ai)).images[0]
  return img ? { url: img.url, width: img.width, height: img.height, ...(img.galleryId ? { galleryId: img.galleryId } : {}), credit: null, source: 'ai' } : null
}
