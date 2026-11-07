import sharp, { type OutputInfo } from 'sharp'
import JSZip from 'jszip'
import { fetchImage } from '@/lib/google-ads/assets'
import type { SellableUnit } from './catalog-load'
import type { MarketplaceChannel } from './types'

// Product photos shaped to each marketplace's upload rules and zipped per style (colour), since
// every size of a style shares its images. Myntra: 3:4 on white, at least 1080x1440, JPEG between
// 500 KB and 1 MB. AJIO: short edge at least 1000 px, up to 14 images, also uploaded so the
// listing sheet can carry public URLs.

export interface ImageSpec {
  /** Output width; with `height` the image is padded onto that exact canvas, without it the short edge is at least this. */
  width: number
  height: number | null
  minBytes: number
  maxBytes: number
  maxImages: number
  publicUrls: boolean
}

export const IMAGE_SPECS: Record<MarketplaceChannel, ImageSpec> = {
  myntra: { width: 1080, height: 1440, minBytes: 500 * 1024, maxBytes: 1_000_000, maxImages: 10, publicUrls: false },
  ajio: { width: 1000, height: null, minBytes: 0, maxBytes: 2_000_000, maxImages: 14, publicUrls: true },
}

export const MAX_PACK_IMAGES = 150
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
// Larger 3:4 canvases tried when a plain photo stays under the minimum size.
const UPSCALE = [1, 1.25, 1.5, 1.75, 2]
const MAX_LONG_EDGE = 3000

/** Adds JPEG comment segments after SOI until the file reaches `target` bytes (the portal rejects small files). */
export function padJpeg(buf: Buffer, target: number): Buffer {
  if (buf.length >= target || buf[0] !== 0xff || buf[1] !== 0xd8) return buf
  const segs: Buffer[] = []
  let need = target - buf.length
  while (need > 0) {
    const payload = Math.min(65533, Math.max(1, need - 4))
    const seg = Buffer.alloc(4 + payload, 0x20)
    seg[0] = 0xff
    seg[1] = 0xfe
    seg.writeUInt16BE(payload + 2, 2)
    segs.push(seg)
    need -= seg.length
  }
  return Buffer.concat([buf.subarray(0, 2), ...segs, buf.subarray(2)])
}

export interface ProcessedImage {
  buffer: Buffer
  width: number
  height: number
  quality: number
  padded: boolean
}

type Raw = { data: Buffer; info: OutputInfo }

const encode = (raw: Raw, quality: number) =>
  sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } })
    .jpeg({ quality, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' })
    .toBuffer()

async function render(src: Buffer, spec: ImageSpec, scale: number): Promise<Raw> {
  const img = sharp(src, { failOn: 'none' }).rotate()
  if (spec.height) {
    return img
      .resize(Math.round(spec.width * scale), Math.round(spec.height * scale), { fit: 'contain', background: WHITE })
      .flatten({ background: WHITE })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  }
  const meta = await sharp(src, { failOn: 'none' }).metadata()
  const w = meta.autoOrient?.width ?? meta.width ?? spec.width
  const h = meta.autoOrient?.height ?? meta.height ?? spec.width
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  const factor = short < spec.width ? spec.width / short : long > MAX_LONG_EDGE ? MAX_LONG_EDGE / long : 1
  return img
    .resize(Math.round(w * factor), Math.round(h * factor), { fit: 'fill' })
    .flatten({ background: WHITE })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
}

/** Highest quality at or under maxBytes (binary search over 30..95). */
async function fitUnder(raw: Raw, maxBytes: number): Promise<{ buffer: Buffer; quality: number }> {
  let lo = 30
  let hi = 95
  let best: { buffer: Buffer; quality: number } | null = null
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2)
    const buffer = await encode(raw, q)
    if (buffer.length <= maxBytes) {
      best = { buffer, quality: q }
      lo = q + 1
    } else hi = q - 1
  }
  return best ?? { buffer: await encode(raw, 20), quality: 20 }
}

/** One photo to the channel's spec. Throws on a file that is not an image. */
export async function processImage(src: Buffer, spec: ImageSpec): Promise<ProcessedImage> {
  const scales = spec.height ? UPSCALE : [1]
  let last: { raw: Raw; buffer: Buffer; quality: number } | null = null
  for (const scale of scales) {
    const raw = await render(src, spec, scale)
    const top = await encode(raw, 95)
    if (top.length > spec.maxBytes) {
      const fit = await fitUnder(raw, spec.maxBytes)
      last = { raw, ...fit }
      break
    }
    last = { raw, buffer: top, quality: 95 }
    if (top.length >= spec.minBytes) break
  }
  const { raw, quality } = last!
  let buffer = last!.buffer
  const padded = buffer.length < spec.minBytes
  if (padded) buffer = padJpeg(buffer, spec.minBytes + 1024)
  return { buffer, width: raw.info.width, height: raw.info.height, quality, padded }
}

export interface ImageGroup {
  /** Folder name: style ID, else the first SKU. */
  folder: string
  label: string
  skus: string[]
  images: string[]
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'item'

/** Units grouped by style (variant, else product); sizes of one style share its photos. */
export function imageGroups(units: SellableUnit[], maxImages: number): ImageGroup[] {
  const groups = new Map<string, ImageGroup>()
  const folders = new Set<string>()
  for (const u of units) {
    const id = u.variantId ?? u.productId
    const sku = u.listing?.marketplaceSku ?? u.ourSku ?? u.key
    const g = groups.get(id)
    if (g) {
      g.skus.push(sku)
      continue
    }
    let folder = safeName(u.listing?.styleId || sku)
    for (let n = 2; folders.has(folder); n++) folder = `${safeName(u.listing?.styleId || sku)}_${n}`
    folders.add(folder)
    groups.set(id, { folder, label: [u.name, u.variantName].filter(Boolean).join(' · '), skus: [sku], images: u.images.slice(0, maxImages) })
  }
  return [...groups.values()].filter(g => g.images.length)
}

export interface ImagePack {
  zip: Buffer
  groups: number
  images: number
  padded: number
  failed: { folder: string; url: string; error: string }[]
  /** Public URLs per folder, when the channel takes URLs (AJIO). */
  urls: Record<string, string[]>
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** The zip of shaped photos (one folder per style) plus, for AJIO, a CSV of uploaded URLs. */
export async function buildImagePack(
  channel: MarketplaceChannel,
  units: SellableUnit[],
  opts: { fetchImpl?: typeof fetch; upload?: (key: string, body: Buffer) => Promise<string> } = {}
): Promise<ImagePack> {
  const spec = IMAGE_SPECS[channel]
  const groups = imageGroups(units, spec.maxImages)
  const total = groups.reduce((n, g) => n + g.images.length, 0)
  if (!total) throw new Error('None of these products have photos.')
  if (total > MAX_PACK_IMAGES) throw new Error(`That is ${total} photos; pick fewer products (at most ${MAX_PACK_IMAGES} photos per pack).`)
  const zip = new JSZip()
  const failed: ImagePack['failed'] = []
  const urls: Record<string, string[]> = {}
  let images = 0
  let padded = 0
  const stamp = Date.now().toString(36)
  for (const g of groups) {
    for (let i = 0; i < g.images.length; i++) {
      const url = g.images[i]
      try {
        const out = await processImage(await fetchImage(url, opts.fetchImpl), spec)
        const name = `${g.folder}_${i + 1}.jpg`
        zip.file(`${g.folder}/${name}`, out.buffer)
        images++
        if (out.padded) padded++
        if (spec.publicUrls && opts.upload) (urls[g.folder] ??= []).push(await opts.upload(`marketplace/${channel}/images/${stamp}/${g.folder}/${name}`, out.buffer))
      } catch (e) {
        failed.push({ folder: g.folder, url, error: String((e as Error)?.message ?? e).slice(0, 200) })
      }
    }
  }
  if (!images) throw new Error(failed[0]?.error ? `No photo could be prepared: ${failed[0].error}` : 'No photo could be prepared.')
  if (Object.keys(urls).length) {
    const width = Math.max(...Object.values(urls).map(u => u.length))
    const head = ['Style', 'SKUs', ...Array.from({ length: width }, (_, i) => `Image ${i + 1}`)]
    const lines = groups.filter(g => urls[g.folder]).map(g => [g.folder, g.skus.join(' '), ...urls[g.folder]].map(csvCell).join(','))
    zip.file('image-urls.csv', [head.join(','), ...lines].join('\n'))
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  return { zip: buf, groups: groups.length, images, padded, failed, urls }
}
