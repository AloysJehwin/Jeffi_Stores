import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import sharp from 'sharp'
import { uploadTemplateAsset } from '@jeffi/tenancy'

// WhatsApp header media from anywhere: a URL (any host, any image format — e.g. a Google image link with no
// extension) or uploaded bytes is fetched, turned into something WhatsApp accepts and re-hosted on our CDN,
// which every approved template's header prefix points at. Images become JPEG (≤ 5 MB, ≤ 1600 px); MP4 video
// and PDF documents are re-hosted as they are.
export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const MAX_INPUT = 15 * 1024 * 1024
const MAX_IMAGE = 5 * 1024 * 1024
const PASS_THROUGH: Record<string, number> = { 'video/mp4': 16 * 1024 * 1024, 'application/pdf': 15 * 1024 * 1024 }

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./]
function privateAddress(ip: string) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) return PRIVATE_V4.some(r => r.test(v4))
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new MediaError(422, 'invalid_media_url', 'media_url must be an http(s) link')
  if (url.port && !['80', '443'].includes(url.port)) throw new MediaError(422, 'invalid_media_url', 'media_url must use the standard web ports')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw new MediaError(422, 'invalid_media_url', `Could not resolve ${url.hostname}`)
  if (addrs.some(a => privateAddress(a.address))) throw new MediaError(422, 'invalid_media_url', 'media_url points at a private address')
}

/** Fetches a public URL (redirects re-checked, size-capped) and returns its bytes and declared type. */
export async function fetchMedia(raw: string): Promise<{ bytes: Buffer; type: string }> {
  let url: URL
  try { url = new URL(raw) } catch { throw new MediaError(422, 'invalid_media_url', 'media_url is not a valid link') }
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url)
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'JeffiMedia/1.0', accept: 'image/*,video/mp4,application/pdf;q=0.9,*/*;q=0.5' } })
      .catch(e => { throw new MediaError(422, 'media_unreachable', `Could not download media_url: ${(e as Error).message}`) })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url); continue }
    if (!res.ok || !res.body) throw new MediaError(422, 'media_unreachable', `Downloading media_url returned HTTP ${res.status}`)
    if (Number(res.headers.get('content-length') ?? 0) > MAX_INPUT) throw new MediaError(413, 'media_too_large', 'media_url is larger than 15 MB')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length
      if (size > MAX_INPUT) throw new MediaError(413, 'media_too_large', 'media_url is larger than 15 MB')
      chunks.push(Buffer.from(chunk))
    }
    return { bytes: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() }
  }
  throw new MediaError(422, 'media_unreachable', 'media_url redirects too many times')
}

/** Any image sharp can read → JPEG within WhatsApp's limits; MP4/PDF unchanged; anything else is refused. */
export async function normalizeMedia(bytes: Buffer, declared: string): Promise<{ bytes: Buffer; mime: string; width?: number; height?: number }> {
  const meta = await sharp(bytes, { animated: false }).metadata().catch(() => null)
  if (meta?.format) {
    for (const [edge, quality] of [[1600, 85], [1600, 72], [1280, 70], [1024, 65]] as const) {
      const out = await sharp(bytes, { animated: false }).rotate().flatten({ background: '#ffffff' })
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      if (out.data.length <= MAX_IMAGE) return { bytes: out.data, mime: 'image/jpeg', width: out.info.width, height: out.info.height }
    }
    throw new MediaError(413, 'media_too_large', 'The image is still over 5 MB after compression')
  }
  const limit = PASS_THROUGH[declared]
  if (limit) {
    if (bytes.length > limit) throw new MediaError(413, 'media_too_large', `${declared} media must be under ${Math.round(limit / 1048576)} MB`)
    return { bytes, mime: declared }
  }
  throw new MediaError(415, 'unsupported_media', 'Use an image (any format), an MP4 video or a PDF')
}

/** Normalizes and hosts the media; returns its CDN URL. */
export async function hostMedia(bytes: Buffer, declared: string) {
  const media = await normalizeMedia(bytes, declared)
  const { url } = await uploadTemplateAsset(media.bytes, 'media', media.mime)
  return { url, content_type: media.mime, bytes: media.bytes.length, width: media.width ?? null, height: media.height ?? null }
}

// The same source in a batch/bulk send is fetched, hosted and charged once (per pod, for an hour).
const hosted = new Map<string, { url: string; at: number }>()
export async function hostUrl(raw: string): Promise<{ url: string; fresh: boolean }> {
  const hit = hosted.get(raw)
  if (hit && Date.now() - hit.at < 3_600_000) return { url: hit.url, fresh: false }
  const src = await fetchMedia(raw)
  const { url } = await hostMedia(src.bytes, src.type)
  if (hosted.size > 500) hosted.delete(hosted.keys().next().value!)
  hosted.set(raw, { url, at: Date.now() })
  return { url, fresh: true }
}
