import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'

vi.mock('@/lib/google-ads/assets', () => ({ fetchImage: vi.fn() }))

import { IMAGE_SPECS, imageGroups, padJpeg, processImage } from '@/lib/marketplace/images'

/** A deterministic test photo: a gradient with noise of the given amplitude. */
async function photo(w: number, h: number, amp: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3)
  let s = 7
  for (let i = 0; i < buf.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const base = ((i % (w * 3)) / (w * 3)) * 200
    buf[i] = Math.max(0, Math.min(255, base + ((s >> 8) % (2 * amp + 1)) - amp))
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

const MIN = 500 * 1024
const MAX = 1_000_000

describe('processImage (Myntra)', () => {
  const spec = IMAGE_SPECS.myntra

  for (const [label, w, h, amp] of [
    ['a typical landscape photo', 800, 600, 40],
    ['a plain image', 400, 400, 0],
    ['a large, very busy photo', 2400, 3200, 127],
  ] as const) {
    it(`fits ${label} onto a 3:4 canvas of at least 1080x1440 within 500 KB-1 MB`, async () => {
      const out = await processImage(await photo(w, h, amp), spec)
      const meta = await sharp(out.buffer).metadata()
      expect(meta.format).toBe('jpeg')
      expect(meta.width).toBe(out.width)
      expect(meta.height).toBe(out.height)
      expect(out.width).toBeGreaterThanOrEqual(1080)
      expect(out.height).toBeGreaterThanOrEqual(1440)
      expect(out.width * 4).toBe(out.height * 3)
      expect(out.buffer.length).toBeGreaterThanOrEqual(MIN)
      expect(out.buffer.length).toBeLessThanOrEqual(MAX)
    })
  }
})

describe('processImage (AJIO)', () => {
  it('upscales so the short edge is at least 1000 px and keeps the aspect ratio', async () => {
    const out = await processImage(await photo(600, 800, 20), IMAGE_SPECS.ajio)
    expect(out.width).toBe(1000)
    expect(out.height).toBe(1333)
    expect(out.buffer.length).toBeLessThanOrEqual(IMAGE_SPECS.ajio.maxBytes)
  })
})

describe('padJpeg', () => {
  it('reaches the target size and stays a readable JPEG', async () => {
    const small = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const padded = padJpeg(small, 200_000)
    expect(padded.length).toBeGreaterThanOrEqual(200_000)
    expect(padded.length).toBeLessThan(200_010)
    expect((await sharp(padded).metadata()).width).toBe(20)
  })
})

describe('imageGroups', () => {
  const unit = (key: string, variantId: string | null, sku: string, images: string[], styleId: string | null = null) =>
    ({ key, productId: 'p1', variantId, name: 'Tee', variantName: variantId ? 'Red' : null, ourSku: sku, images, listing: styleId ? { styleId, marketplaceSku: null } : null }) as any

  it('groups the sizes of a style and names the folder by style ID', () => {
    const groups = imageGroups(
      [unit('a', 'v1', 'TEE-RED-S', ['u1', 'u2'], '12345'), unit('b', 'v1', 'TEE-RED-M', ['u1', 'u2'], '12345'), unit('c', 'v2', 'TEE BLUE/S', ['u3'])],
      10
    )
    expect(groups).toEqual([
      { folder: '12345', label: 'Tee · Red', skus: ['TEE-RED-S', 'TEE-RED-M'], images: ['u1', 'u2'] },
      { folder: 'TEE_BLUE_S', label: 'Tee · Red', skus: ['TEE BLUE/S'], images: ['u3'] },
    ])
  })
})
