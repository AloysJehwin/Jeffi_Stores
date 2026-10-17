/**
 * Tests for src/lib/social/publisher.ts: one claimed scheduled_social_posts row to a live post.
 *
 * Pins:
 *   - the post goes to the provider for its network with the store's credentials
 *   - the link carries UTM tags (source = network, campaign = social_<group or post>)
 *   - captions are fitted to the network (X 280) and Instagram gets the link in the text
 *   - not connected or missing media fails without calling the network
 *   - a failure is retried with backoff and marked failed after the fifth attempt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScheduledSocialPost } from '@/lib/tenant-registry'

const reg = { updateSocialPost: vi.fn().mockResolvedValue(undefined) }
vi.mock('@/lib/tenant-registry', () => reg)

const accounts = { authFor: vi.fn() }
vi.mock('@/lib/social/accounts', () => accounts)

const publish = vi.fn()
vi.mock('@/lib/social/providers', async () => {
  const types = await vi.importActual<any>('@/lib/social/providers/types')
  const limits: Record<string, any> = { facebook: { caption: 63206 }, instagram: { caption: 2200, hashtags: 30 }, x: { caption: 280 }, youtube: { caption: 5000 } }
  const requires: Record<string, any> = { instagram: { image: true }, youtube: { video: true } }
  return {
    ...types,
    networkOf: (p: string) => types.PLATFORM_NETWORK[p],
    providerFor: (n: string) => ({ network: n, label: n, limits: limits[n] ?? { caption: 1000 }, requires: requires[n] ?? {}, publish }),
  }
})

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn().mockResolvedValue({ name: 'Drill', slug: 'drill', description: null }) }))
vi.mock('@/lib/catalog/brand', () => ({ resolveCurrentTenant: vi.fn().mockResolvedValue({ slug: 'acme' }), storeBaseUrlAsync: vi.fn().mockResolvedValue('https://acme.example') }))
vi.mock('@/lib/social/caption', () => ({ generateSocialCaption: vi.fn().mockResolvedValue('AI caption') }))

const { publishScheduledPost, withUtm, composeCaption, retryDelayMs, MAX_ATTEMPTS } = await import('@/lib/social/publisher')

function post(over: Partial<ScheduledSocialPost> = {}): ScheduledSocialPost {
  return {
    id: 'post-1',
    tenant_id: 't-1',
    product_id: 'p-1',
    platform: 'fb',
    caption: 'hi',
    hashtags: '#a #b',
    image_url: 'https://cdn/x.png',
    image_urls: null,
    video_url: null,
    scheduled_at: '2026-08-22T00:00:00Z',
    status: 'publishing',
    posted_id: null,
    last_error: null,
    attempts: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  accounts.authFor.mockResolvedValue({ accessToken: 'tok', targetId: 'page-1' })
  publish.mockResolvedValue({ externalId: 'ext-1', url: 'https://net/ext-1' })
})

describe('withUtm', () => {
  it('tags the link and keeps the existing query', () => {
    const u = new URL(withUtm('https://acme.example/p/drill?ref=1', 'pinterest', 'g1'))
    expect(u.searchParams.get('ref')).toBe('1')
    expect(u.searchParams.get('utm_source')).toBe('pinterest')
    expect(u.searchParams.get('utm_medium')).toBe('social')
    expect(u.searchParams.get('utm_campaign')).toBe('social_g1')
  })
})

describe('composeCaption', () => {
  it('fits X to 280 characters', () => {
    expect(composeCaption('x', 'word '.repeat(100), '#a', null).length).toBeLessThanOrEqual(280)
  })
  it('puts the link in the text for Instagram, where links are not clickable fields', () => {
    expect(composeCaption('instagram', 'hello', null, 'https://l')).toContain('https://l')
    expect(composeCaption('facebook', 'hello', null, 'https://l', false)).not.toContain('https://l')
  })
})

describe('publishScheduledPost', () => {
  it('publishes through the provider and marks the post posted with its permalink', async () => {
    const r = await publishScheduledPost(post({ group_id: 'g1' }))
    expect(r).toEqual({ ok: true, postedId: 'ext-1' })
    expect(accounts.authFor).toHaveBeenCalledWith('t-1', 'facebook')
    const input = publish.mock.calls[0][1]
    expect(new URL(input.link).searchParams.get('utm_campaign')).toBe('social_g1')
    expect(input.imageUrls).toEqual(['https://cdn/x.png'])
    expect(reg.updateSocialPost).toHaveBeenCalledWith('post-1', expect.objectContaining({ status: 'posted', postedId: 'ext-1', permalink: 'https://net/ext-1' }))
  })

  it('fails without calling the network when the store is not connected', async () => {
    accounts.authFor.mockResolvedValue(null)
    const r = await publishScheduledPost(post())
    expect(r.ok).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses a YouTube post with no video', async () => {
    const r = await publishScheduledPost(post({ platform: 'youtube' }))
    expect(r.error).toMatch(/video/)
    expect(publish).not.toHaveBeenCalled()
  })

  it('retries with backoff before the last attempt', async () => {
    publish.mockRejectedValue(new Error('rate limited'))
    await publishScheduledPost(post({ attempts: 2 }))
    const patch = reg.updateSocialPost.mock.calls.at(-1)![1]
    expect(patch.status).toBe('pending')
    expect(patch.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(retryDelayMs(2) - 5000)
  })

  it('marks the post failed after the last attempt', async () => {
    publish.mockRejectedValue(new Error('bad token'))
    await publishScheduledPost(post({ attempts: MAX_ATTEMPTS }))
    expect(reg.updateSocialPost).toHaveBeenLastCalledWith('post-1', { status: 'failed', lastError: 'bad token' })
  })

  it('backs off 5, 10, 20, 40 minutes', () => {
    expect([1, 2, 3, 4].map(n => retryDelayMs(n) / 60_000)).toEqual([5, 10, 20, 40])
  })
})
