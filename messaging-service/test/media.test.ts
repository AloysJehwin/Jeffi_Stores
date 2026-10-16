import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'

vi.mock('@jeffi/tenancy', () => ({ uploadCdnAsset: vi.fn(async (_b: Buffer, mime: string) => ({ key: 'k', url: `https://cdn.test/media.${mime.split('/')[1]}` })) }))
const { normalizeMedia, fetchMedia, hostMedia } = await import('../src/media')

const png = (w: number, h: number, alpha = false) =>
  sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: { r: 200, g: 80, b: 40, alpha: alpha ? 0.5 : 1 } } })

describe('media', () => {
  it('turns any image format into a WhatsApp-safe JPEG within 1600px', async () => {
    const webp = await png(3000, 1000, true).webp().toBuffer()
    const out = await normalizeMedia(webp, 'image/webp')
    expect(out.mime).toBe('image/jpeg')
    expect(out.width).toBe(1600)
    expect((await sharp(out.bytes).metadata()).format).toBe('jpeg')
  })

  it('keeps MP4/PDF as they are and refuses anything else', async () => {
    expect((await normalizeMedia(Buffer.from('%PDF-1.4'), 'application/pdf')).mime).toBe('application/pdf')
    await expect(normalizeMedia(Buffer.from('hello'), 'text/plain')).rejects.toMatchObject({ code: 'unsupported_media' })
  })

  it('refuses private and non-web links before fetching', async () => {
    await expect(fetchMedia('http://127.0.0.1/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
    await expect(fetchMedia('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ code: 'invalid_media_url' })
    await expect(fetchMedia('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_media_url' })
  })

  it('hosts the converted image and returns its CDN URL', async () => {
    const out = await hostMedia(await png(10, 10).avif().toBuffer(), 'image/avif')
    expect(out).toMatchObject({ url: 'https://cdn.test/media.jpeg', content_type: 'image/jpeg' })
  })
})
