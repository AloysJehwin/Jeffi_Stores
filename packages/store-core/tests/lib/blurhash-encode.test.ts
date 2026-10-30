import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { decode, isBlurhashValid } from 'blurhash'
import { computeBlurhash } from '@/lib/shared/s3'

async function solid(r: number, g: number, b: number, width = 600, height = 400) {
  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer()
}

describe('computeBlurhash', () => {
  it('produces a valid blurhash for a real image buffer', async () => {
    const hash = await computeBlurhash(await solid(200, 80, 40))
    expect(hash).toBeTruthy()
    expect(isBlurhashValid(hash as string).result).toBe(true)
  })

  it('round-trips to roughly the source colour', async () => {
    const hash = await computeBlurhash(await solid(200, 80, 40))
    const pixels = decode(hash as string, 8, 8)
    expect(Math.abs(pixels[0] - 200)).toBeLessThan(40)
    expect(Math.abs(pixels[1] - 80)).toBeLessThan(40)
    expect(Math.abs(pixels[2] - 40)).toBeLessThan(40)
  })

  it('gives different hashes for different images', async () => {
    const [a, b] = await Promise.all([
      computeBlurhash(await solid(10, 10, 200)),
      computeBlurhash(await solid(220, 30, 10)),
    ])
    expect(a).not.toBe(b)
  })

  it('handles a non-square image', async () => {
    const hash = await computeBlurhash(await solid(120, 120, 120, 1600, 400))
    expect(isBlurhashValid(hash as string).result).toBe(true)
  })

  // The fallback contract: a failure must never break an upload, it just means the UI
  // keeps using its existing skeleton.
  it('returns null instead of throwing on a non-image buffer', async () => {
    expect(await computeBlurhash(Buffer.from('not an image'))).toBeNull()
  })

  it('returns null instead of throwing on an empty buffer', async () => {
    expect(await computeBlurhash(Buffer.alloc(0))).toBeNull()
  })
})
