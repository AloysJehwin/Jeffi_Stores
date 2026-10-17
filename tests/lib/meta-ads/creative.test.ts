import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getIntegrationCredential: vi.fn(), saveIntegrationCredential: vi.fn(), deleteIntegrationCredential: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/social/accounts', () => ({ listAccounts: vi.fn(async () => []) }))

import { MetaGraph } from '@/lib/meta-ads/client'
import {
  uploadAdImage,
  createAdCreative,
  createAd,
  setAdCreative,
  objectStorySpec,
  withImage,
  isOwnMediaUrl,
  metaPageForAds,
} from '@/lib/meta-ads/creative'
import { MadsAdSchema, utmLink } from '@/lib/meta-ads/creative-spec'
import { listAccounts } from '@/lib/social/accounts'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i]
  return { url: String(url), body: Object.fromEntries(new URLSearchParams(String(init.body))) }
}
const graph = new MetaGraph('tok')

beforeEach(() => {
  fetchMock.mockReset()
  delete process.env.META_JEFFI_PAGE_ID
  delete process.env.META_JEFFI_IG_USER_ID
})

describe('Meta ad Graph helpers', () => {
  it('uploads image bytes to adimages and returns the hash', async () => {
    fetchMock.mockResolvedValue(json({ images: { 'ad-image.jpg': { hash: 'h123', url: 'x' } } }))
    expect(await uploadAdImage(graph, 'act_9', Buffer.from('img'))).toBe('h123')
    const { url, body } = sent()
    expect(url).toMatch(/graph\.facebook\.com\/v[\d.]+\/act_9\/adimages$/)
    expect(body).toMatchObject({ bytes: Buffer.from('img').toString('base64'), name: 'ad-image.jpg', access_token: 'tok' })
  })

  it('creates a link creative from object_story_spec, with validate_only for the preview', async () => {
    fetchMock.mockResolvedValue(json({ success: true }))
    const spec = objectStorySpec({ pageId: '11', igUserId: '22', imageHash: 'h', link: 'https://s.in/p?utm_source=facebook', message: 'Buy', headline: 'Bolt', description: 'Cheap', cta: 'SHOP_NOW' })
    await createAdCreative(graph, 'act_9', 'C', spec, true)
    const { url, body } = sent()
    expect(url).toMatch(/act_9\/adcreatives$/)
    expect(JSON.parse(body.execution_options)).toEqual(['validate_only'])
    expect(JSON.parse(body.object_story_spec)).toEqual({
      page_id: '11',
      instagram_user_id: '22',
      link_data: {
        image_hash: 'h',
        link: 'https://s.in/p?utm_source=facebook',
        message: 'Buy',
        name: 'Bolt',
        description: 'Cheap',
        call_to_action: { type: 'SHOP_NOW', value: { link: 'https://s.in/p?utm_source=facebook' } },
      },
    })
    fetchMock.mockResolvedValue(json({ id: '777' }))
    expect(await createAdCreative(graph, 'act_9', 'C', spec)).toBe('777')
    expect(sent(1).body.execution_options).toBeUndefined()
  })

  it('omits instagram_user_id and description when absent', () => {
    const spec = objectStorySpec({ pageId: '11', imageHash: 'h', link: 'https://s.in', message: 'm', headline: 'h', cta: 'LEARN_MORE' })
    expect(spec).not.toHaveProperty('instagram_user_id')
    expect(spec.link_data).not.toHaveProperty('description')
  })

  it('creates a paused ad on the ad set and swaps a creative on an existing ad', async () => {
    fetchMock.mockResolvedValue(json({ id: '555' }))
    expect(await createAd(graph, 'act_9', { name: 'A', adsetId: '42', creative: { creative_id: '777' } })).toBe('555')
    const ad = sent()
    expect(ad.url).toMatch(/act_9\/ads$/)
    expect(ad.body).toMatchObject({ name: 'A', adset_id: '42', status: 'PAUSED' })
    expect(JSON.parse(ad.body.creative)).toEqual({ creative_id: '777' })

    fetchMock.mockResolvedValue(json({ success: true }))
    await setAdCreative(graph, '555', { creative_id: '888' }, true)
    const swap = sent(1)
    expect(swap.url).toMatch(/\/555$/)
    expect(JSON.parse(swap.body.creative)).toEqual({ creative_id: '888' })
    expect(JSON.parse(swap.body.execution_options)).toEqual(['validate_only'])
  })

  it('surfaces Meta errors', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'bad', error_user_msg: 'Image too small', code: 100 } }, 400))
    await expect(uploadAdImage(graph, 'act_9', Buffer.from('x'))).rejects.toThrow('Meta: Image too small')
  })
})

describe('creative inputs', () => {
  it('tags the link with UTM for the ad set', () => {
    const u = new URL(utmLink('https://shop.in/products/bolt?ref=1', '42'))
    expect(Object.fromEntries(u.searchParams)).toEqual({ ref: '1', utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'meta_42' })
  })

  it('enforces text limits and https', () => {
    const base = { action: 'create', adsetId: '42', name: 'A', imageUrl: 'https://b.s3.amazonaws.com/x.png', link: 'https://s.in', message: 'm', headline: 'h', cta: 'SHOP_NOW' }
    expect(MadsAdSchema.safeParse(base).success).toBe(true)
    expect(MadsAdSchema.safeParse({ ...base, headline: 'x'.repeat(41) }).success).toBe(false)
    expect(MadsAdSchema.safeParse({ ...base, description: 'x'.repeat(31) }).success).toBe(false)
    expect(MadsAdSchema.safeParse({ ...base, message: 'x'.repeat(2201) }).success).toBe(false)
    expect(MadsAdSchema.safeParse({ ...base, link: 'http://s.in' }).success).toBe(false)
    expect(MadsAdSchema.safeParse({ ...base, cta: 'DOWNLOAD_NOW' }).success).toBe(false)
  })

  it('only fetches our own media', () => {
    process.env.CLOUDFRONT_URL = 'https://d1.cloudfront.net'
    expect(isOwnMediaUrl('https://d1.cloudfront.net/a.png')).toBe(true)
    expect(isOwnMediaUrl('https://store-bucket.s3.ap-south-1.amazonaws.com/a.png')).toBe(true)
    expect(isOwnMediaUrl('https://evil.com/a.png')).toBe(false)
    expect(isOwnMediaUrl('http://store-bucket.s3.ap-south-1.amazonaws.com/a.png')).toBe(false)
    expect(isOwnMediaUrl('https://169.254.169.254/latest')).toBe(false)
  })

  it('replaces only the image of an existing link creative', () => {
    const spec = { page_id: '1', link_data: { link: 'https://s.in', message: 'm', picture: 'old', image_hash: 'old' } }
    expect(withImage(spec, 'new')).toEqual({ page_id: '1', link_data: { link: 'https://s.in', message: 'm', image_hash: 'new' } })
  })

  it('takes the Page from the Facebook connection and the Instagram account from its row', async () => {
    vi.mocked(listAccounts).mockResolvedValue([
      { provider: 'facebook', page_id: '11', page_name: 'Jeffi', ig_user_id: null } as any,
      { provider: 'instagram', page_id: '11', page_name: 'Jeffi', ig_user_id: '22' } as any,
    ])
    expect(await metaPageForAds()).toEqual({ pageId: '11', pageName: 'Jeffi', igUserId: '22' })
    vi.mocked(listAccounts).mockResolvedValue([])
    expect(await metaPageForAds()).toBeNull()
    process.env.META_JEFFI_PAGE_ID = '99'
    expect(await metaPageForAds()).toEqual({ pageId: '99', pageName: null, igUserId: null })
  })
})
