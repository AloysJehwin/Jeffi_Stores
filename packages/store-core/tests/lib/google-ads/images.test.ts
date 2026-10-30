import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'

const { queryMany } = vi.hoisted(() => ({ queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany, queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/customer-links', () => ({ catalogBaseUrl: vi.fn() }))

import { fetchImage, prepareImages } from '@/lib/google-ads/assets'

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()

describe('Performance Max images from the catalogue', () => {
  it('fits product images to 1.91:1 and 1:1 and the logo to a 512px square, by image id', async () => {
    queryMany.mockResolvedValueOnce([{ id: 'img-1', image_url: 'https://cdn.example.in/p.png' }])
    const product = await png(800, 600)
    const logo = await png(300, 120)
    const fetchImpl = vi.fn(async (url: string) => new Response(url.includes('logo') ? logo : product)) as any

    const out = await prepareImages(['img-1', 'missing'], 'https://cdn.example.in/logo.png', fetchImpl)
    expect(queryMany.mock.calls[0][1]).toEqual([['img-1', 'missing']])
    expect(out.landscape).toHaveLength(1)
    const meta = async (b64: string) => sharp(Buffer.from(b64, 'base64')).metadata()
    expect(await meta(out.landscape[0])).toMatchObject({ width: 1200, height: 628, format: 'jpeg' })
    expect(await meta(out.square[0])).toMatchObject({ width: 1200, height: 1200, format: 'jpeg' })
    expect(await meta(out.logo!)).toMatchObject({ width: 512, height: 512, format: 'png' })
  })

  it('only downloads https images and reports failures', async () => {
    await expect(fetchImage('http://cdn.example.in/x.png')).rejects.toThrow('https')
    const notFound = vi.fn(async () => new Response('', { status: 404 })) as any
    await expect(fetchImage('https://cdn.example.in/x.png', notFound)).rejects.toThrow('HTTP 404')
  })
})
