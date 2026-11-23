import { describe, it, expect } from 'vitest'
import {
  MEDIA_KINDS,
  MEDIA_GROUPS,
  mediaGroup,
  MEDIA_GROUP_LABEL,
  DEFAULT_MEDIA_LIMITS,
  ACCEPT,
  scopeOf,
  scopeKey,
  inScope,
  parseExternalVideo,
  embedUrlOf,
  resolveMedia,
  resolveImageUrls,
  mediaPoster,
  formatBytes,
  mediaStructuredData,
  type ProductMediaItem,
} from '@/lib/catalog/product-media-shared'

function item(over: Partial<ProductMediaItem> = {}): ProductMediaItem {
  return {
    id: over.id ?? 'm1',
    kind: 'image',
    url: 'https://cdn/x.jpg',
    thumbnail_url: null,
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
    metadata: {},
    product_id: 'p1',
    variant_id: null,
    sub_variant_id: null,
    ...over,
  }
}

describe('media groups', () => {
  it('maps external_video into the video group, everything else through', () => {
    expect(mediaGroup('external_video')).toBe('video')
    expect(mediaGroup('image')).toBe('image')
    expect(mediaGroup('audio')).toBe('audio')
  })

  it('exposes labels for every group and kinds list', () => {
    for (const g of MEDIA_GROUPS) expect(MEDIA_GROUP_LABEL[g]).toBeTruthy()
    expect(MEDIA_KINDS).toContain('spin_360')
    expect(ACCEPT.image).toContain('image/jpeg')
    expect(DEFAULT_MEDIA_LIMITS.maxPerScope).toBe(12)
  })
})

describe('scope helpers', () => {
  it('scopeOf reads variant/sub ids with null fallback', () => {
    expect(scopeOf({ variant_id: 'v1', sub_variant_id: null })).toEqual({ variantId: 'v1', subVariantId: null })
    expect(scopeOf({ variant_id: undefined as any, sub_variant_id: undefined as any })).toEqual({
      variantId: null,
      subVariantId: null,
    })
  })

  it('scopeKey prefers sub, then variant, then product', () => {
    expect(scopeKey({ subVariantId: 'sv1', variantId: 'v1' })).toBe('sub:sv1')
    expect(scopeKey({ variantId: 'v1' })).toBe('variant:v1')
    expect(scopeKey({})).toBe('product')
  })

  it('inScope compares scope keys', () => {
    expect(inScope(item({ variant_id: 'v1' }), { variantId: 'v1' })).toBe(true)
    expect(inScope(item({ variant_id: 'v1' }), { variantId: 'v2' })).toBe(false)
  })
})

describe('parseExternalVideo', () => {
  it('parses a youtu.be short link', () => {
    const v = parseExternalVideo('https://youtu.be/abc123XYZ')
    expect(v).toMatchObject({ provider: 'youtube', videoId: 'abc123XYZ' })
    expect(v!.embedUrl).toBe('https://www.youtube-nocookie.com/embed/abc123XYZ')
    expect(v!.thumbnailUrl).toContain('abc123XYZ')
  })

  it('parses a youtube.com watch link', () => {
    expect(parseExternalVideo('https://www.youtube.com/watch?v=abc123XYZ')?.videoId).toBe('abc123XYZ')
  })

  it('parses embed/shorts/live/v path forms', () => {
    expect(parseExternalVideo('https://youtube.com/embed/abc123XYZ')?.videoId).toBe('abc123XYZ')
    expect(parseExternalVideo('https://youtube.com/shorts/abc123XYZ')?.videoId).toBe('abc123XYZ')
  })

  it('parses a vimeo link with a numeric id', () => {
    const v = parseExternalVideo('https://vimeo.com/123456')
    expect(v).toMatchObject({ provider: 'vimeo', videoId: '123456', thumbnailUrl: null })
    expect(v!.embedUrl).toBe('https://player.vimeo.com/video/123456')
  })

  it('rejects non-url, non-http and unknown hosts', () => {
    expect(parseExternalVideo('not a url')).toBeNull()
    expect(parseExternalVideo('ftp://youtu.be/abc123XYZ')).toBeNull()
    expect(parseExternalVideo('https://example.com/x')).toBeNull()
  })

  it('rejects a youtube id that fails the charset/length check', () => {
    expect(parseExternalVideo('https://youtu.be/短')).toBeNull()
    expect(parseExternalVideo('https://youtu.be/ab')).toBeNull()
  })

  it('embedUrlOf reads an item url', () => {
    expect(embedUrlOf({ url: 'https://youtu.be/abc123XYZ' })).toBe('https://www.youtube-nocookie.com/embed/abc123XYZ')
    expect(embedUrlOf({ url: 'nope' })).toBeNull()
  })
})

describe('resolveMedia inheritance', () => {
  it('prefers sub-variant, then variant, then product per group; primary and sort order', () => {
    const items = [
      item({ id: 'pImg', kind: 'image', product_id: 'p1', sort_order: 2 }),
      item({ id: 'pImgPrimary', kind: 'image', product_id: 'p1', is_primary: true, sort_order: 5 }),
      item({ id: 'vImg', kind: 'image', product_id: null, variant_id: 'v1', sort_order: 0 }),
      item({ id: 'svImg', kind: 'image', product_id: null, variant_id: 'v1', sub_variant_id: 'sv1', sort_order: 0 }),
    ]
    // Sub selected: only sub image
    expect(resolveMedia(items, { variantId: 'v1', subVariantId: 'sv1' }).map(m => m.id)).toEqual(['svImg'])
    // Variant selected (no sub): every item carrying this variant id (the sub row has it too)
    expect(resolveMedia(items, { variantId: 'v1' }).map(m => m.id)).toEqual(['vImg', 'svImg'])
    // Nothing selected: product images, primary first
    expect(resolveMedia(items, {}).map(m => m.id)).toEqual(['pImgPrimary', 'pImg'])
  })

  it('skips items that are not ready', () => {
    const items = [item({ id: 'ready' }), item({ id: 'pending', status: 'pending' })]
    expect(resolveMedia(items, {}).map(m => m.id)).toEqual(['ready'])
  })

  it('resolveImageUrls returns only image urls', () => {
    const items = [
      item({ id: 'img', kind: 'image', url: 'https://cdn/a.jpg' }),
      item({ id: 'vid', kind: 'video', url: 'https://cdn/a.mp4' }),
    ]
    expect(resolveImageUrls(items, {})).toEqual(['https://cdn/a.jpg'])
  })
})

describe('mediaPoster', () => {
  it('prefers thumbnail', () => {
    expect(mediaPoster(item({ thumbnail_url: 'https://cdn/t.jpg' }))).toBe('https://cdn/t.jpg')
  })
  it('falls back to the image url', () => {
    expect(mediaPoster(item({ kind: 'image', url: 'https://cdn/i.jpg' }))).toBe('https://cdn/i.jpg')
  })
  it('uses the first 360 frame', () => {
    expect(mediaPoster(item({ kind: 'spin_360', metadata: { frames: ['f0', 'f1'] } }))).toBe('f0')
    expect(mediaPoster(item({ kind: 'spin_360', metadata: {} }))).toBeNull()
  })
  it('uses the external video thumbnail', () => {
    expect(mediaPoster(item({ kind: 'external_video', url: 'https://youtu.be/abc123XYZ' }))).toContain('abc123XYZ')
  })
  it('returns null for a bare document', () => {
    expect(mediaPoster(item({ kind: 'document' }))).toBeNull()
  })
})

describe('formatBytes', () => {
  it('returns empty for falsy sizes', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(null)).toBe('')
  })
  it('renders KB under 1MB and MB above', () => {
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1)).toBe('1 KB') // floored up to at least 1
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('mediaStructuredData', () => {
  it('emits a VideoObject for a hosted video with a thumbnail and duration', () => {
    const out = mediaStructuredData(
      [item({ kind: 'video', url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg', duration_seconds: 42, caption: 'Demo' })],
      'Widget',
      'A <b>great</b> widget'
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ '@type': 'VideoObject', name: 'Demo', contentUrl: 'https://cdn/v.mp4', duration: 'PT42S' })
    expect(out[0].description).toBe('A great widget')
  })

  it('uses embedUrl for an external video and skips when no thumbnail', () => {
    const out = mediaStructuredData([item({ kind: 'external_video', url: 'https://youtu.be/abc123XYZ' })], 'Widget')
    expect(out[0].embedUrl).toBe('https://www.youtube-nocookie.com/embed/abc123XYZ')

    // A plain video with no thumbnail is skipped.
    expect(mediaStructuredData([item({ kind: 'video', thumbnail_url: null })], 'W')).toEqual([])
  })

  it('emits a 3DModel with optional usdz encoding', () => {
    const out = mediaStructuredData(
      [item({ kind: 'model_3d', url: 'https://cdn/m.glb', metadata: { usdz_url: 'https://cdn/m.usdz' } })],
      'Model'
    )
    expect(out[0]['@type']).toBe('3DModel')
    expect(out[0].encoding).toHaveLength(2)
    expect(out[0].encoding[1].encodingFormat).toBe('model/vnd.usdz+zip')
  })

  it('ignores kinds that are not video or model', () => {
    expect(mediaStructuredData([item({ kind: 'image' })], 'W')).toEqual([])
  })
})
