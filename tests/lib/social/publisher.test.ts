/**
 * Tests for src/lib/social/publisher.ts — turning one queued scheduled_social_posts row into a
 * live FB/IG post.
 *
 * Pins the money/correctness behaviours:
 *   - the row is flipped to 'publishing' BEFORE the network call (idempotency: a concurrent
 *     tick won't double-post)
 *   - an FB post dispatches to publishFacebookPost and marks the row 'posted'
 *   - an IG post with no connected IG account fails (never posts to the wrong place)
 *   - a per-tenant token is decrypted before use
 *   - a Jeffi platform post (tenant_id null) uses env META_JEFFI_PAGE_TOKEN, not the tenant table
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ScheduledSocialPost, TenantSocialAccount } from '@/lib/tenant-registry'

// Persistence seam.
const reg = {
  getTenantSocialAccounts: vi.fn(),
  updateSocialPost: vi.fn().mockResolvedValue(undefined),
}
vi.mock('@/lib/tenant-registry', () => reg)

// Meta network seam.
const meta = {
  publishFacebookPost: vi.fn(),
  publishFacebookCarousel: vi.fn(),
  publishInstagramImage: vi.fn(),
  publishInstagramCarousel: vi.fn(),
  publishInstagramReel: vi.fn(),
}
vi.mock('@/lib/meta', () => meta)

// Cipher seam — passthrough so we can assert the encrypted token was decrypted.
const cipher = { decryptToken: vi.fn((s: string) => `dec:${s}`) }
vi.mock('@/lib/crypto/token-cipher', () => cipher)

// DB/caption seams — the fixtures always carry a non-empty caption, so ensureCaption never
// reaches these, but they're mocked anyway to keep the suite hermetic (no real pg.Pool/Ollama).
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/social/caption', () => ({ generateSocialCaption: vi.fn() }))

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
    status: 'pending',
    posted_id: null,
    last_error: null,
    attempts: 0,
    ...over,
  }
}

function account(over: Partial<TenantSocialAccount> = {}): TenantSocialAccount {
  return {
    id: 'acc-1',
    tenant_id: 't-1',
    provider: 'facebook',
    page_id: 'PAGE_1',
    page_name: 'Acme',
    ig_user_id: null,
    access_token_enc: 'ENC_TOK',
    token_expiry: null,
    status: 'active',
    ...over,
  }
}

/** All status values the publisher wrote, in order. */
function statuses() {
  return reg.updateSocialPost.mock.calls.map((c: any[]) => c[1]?.status)
}

describe('social/publisher — publishScheduledPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reg.updateSocialPost.mockResolvedValue(undefined)
    cipher.decryptToken.mockImplementation((s: string) => `dec:${s}`)
    delete process.env.META_JEFFI_PAGE_TOKEN
    delete process.env.META_JEFFI_PAGE_ID
    delete process.env.META_JEFFI_IG_USER_ID
  })

  afterEach(() => {
    delete process.env.META_JEFFI_PAGE_TOKEN
    delete process.env.META_JEFFI_PAGE_ID
    delete process.env.META_JEFFI_IG_USER_ID
  })

  it('flips the row to publishing BEFORE the network call (idempotency)', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account()])
    meta.publishFacebookPost.mockImplementation(async () => {
      // At the moment of the network call the row must already be 'publishing'.
      expect(statuses()).toEqual(['publishing'])
      return { id: 'fb_1' }
    })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    await publishScheduledPost(post())
    expect(reg.updateSocialPost.mock.calls[0]).toEqual([
      'post-1',
      { status: 'publishing', bumpAttempts: true },
    ])
  })

  it('publishes an FB post and marks the row posted', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account()])
    meta.publishFacebookPost.mockResolvedValue({ id: 'fb_123' })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post())
    expect(meta.publishFacebookPost).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ ok: true, postedId: 'fb_123' })
    expect(reg.updateSocialPost).toHaveBeenLastCalledWith('post-1', {
      status: 'posted',
      postedId: 'fb_123',
    })
    expect(statuses()).toEqual(['publishing', 'posted'])
  })

  it('decrypts the tenant token before publishing', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account({ access_token_enc: 'ENC_TOK' })])
    meta.publishFacebookPost.mockResolvedValue({ id: 'fb_1' })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    await publishScheduledPost(post())
    expect(cipher.decryptToken).toHaveBeenCalledWith('ENC_TOK')
    expect(meta.publishFacebookPost).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'dec:ENC_TOK', pageId: 'PAGE_1' }),
    )
  })

  it('fails an IG post when no IG account is connected', async () => {
    // An instagram-provider row exists but carries no ig_user_id, so creds resolve
    // yet the IG target is missing — the publisher must reject before calling Meta.
    reg.getTenantSocialAccounts.mockResolvedValue([
      account({ provider: 'instagram', ig_user_id: null }),
    ])
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post({ platform: 'ig' }))
    expect(r.ok).toBe(false)
    expect(meta.publishInstagramImage).not.toHaveBeenCalled()
    expect(reg.updateSocialPost).toHaveBeenLastCalledWith('post-1', {
      status: 'failed',
      lastError: expect.stringMatching(/Instagram/),
    })
    expect(statuses()).toEqual(['publishing', 'failed'])
  })

  it('fails (not throws) when the tenant has no connected account at all', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([])
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post())
    expect(r.ok).toBe(false)
    expect(statuses()).toEqual(['publishing', 'failed'])
  })

  it('uses env META_JEFFI_PAGE_TOKEN for a Jeffi platform post (tenant_id null)', async () => {
    process.env.META_JEFFI_PAGE_TOKEN = 'JEFFI_TOK'
    process.env.META_JEFFI_PAGE_ID = 'JEFFI_PAGE'
    meta.publishFacebookPost.mockResolvedValue({ id: 'fb_j' })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post({ tenant_id: null }))
    expect(r.ok).toBe(true)
    // Jeffi creds come from env, never the tenant table.
    expect(reg.getTenantSocialAccounts).not.toHaveBeenCalled()
    expect(cipher.decryptToken).not.toHaveBeenCalled()
    expect(meta.publishFacebookPost).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'JEFFI_TOK', pageId: 'JEFFI_PAGE' }),
    )
  })

  it('fails a Jeffi platform post when META_JEFFI_PAGE_TOKEN is unset', async () => {
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post({ tenant_id: null }))
    expect(r.ok).toBe(false)
    expect(meta.publishFacebookPost).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['publishing', 'failed'])
  })

  it('dispatches to publishFacebookCarousel when image_urls has extra images', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account()])
    meta.publishFacebookCarousel.mockResolvedValue({ id: 'fb_carousel' })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post({ image_urls: ['https://cdn/y.png'] }))
    expect(r).toEqual({ ok: true, postedId: 'fb_carousel' })
    expect(meta.publishFacebookCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrls: ['https://cdn/x.png', 'https://cdn/y.png'] }),
    )
    expect(meta.publishFacebookPost).not.toHaveBeenCalled()
  })

  it('dispatches to publishInstagramCarousel when image_urls has extra images', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account({ provider: 'instagram', ig_user_id: 'IG_1' })])
    meta.publishInstagramCarousel.mockResolvedValue({ id: 'ig_carousel' })
    const { publishScheduledPost } = await import('@/lib/social/publisher')
    const r = await publishScheduledPost(post({ platform: 'ig', image_urls: ['https://cdn/y.png'] }))
    expect(r).toEqual({ ok: true, postedId: 'ig_carousel' })
    expect(meta.publishInstagramCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrls: ['https://cdn/x.png', 'https://cdn/y.png'], igUserId: 'IG_1' }),
    )
    expect(meta.publishInstagramImage).not.toHaveBeenCalled()
  })

  it('generates a caption from the linked product when the post caption is blank', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account()])
    meta.publishFacebookPost.mockResolvedValue({ id: 'fb_1' })
    const dbMod = await import('@/lib/db')
    const captionMod = await import('@/lib/social/caption')
    vi.mocked(dbMod.queryOne).mockResolvedValue({ name: 'Widget', description: 'A fine widget' })
    vi.mocked(captionMod.generateSocialCaption).mockResolvedValue('Introducing the Widget!')

    const { publishScheduledPost } = await import('@/lib/social/publisher')
    await publishScheduledPost(post({ caption: '' }))

    expect(captionMod.generateSocialCaption).toHaveBeenCalledWith({ productName: 'Widget', productDescription: 'A fine widget' })
    expect(meta.publishFacebookPost).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Introducing the Widget!') }),
    )
    // Persisted back to the row so a retry doesn't regenerate a different caption.
    expect(reg.updateSocialPost).toHaveBeenCalledWith('post-1', { caption: 'Introducing the Widget!' })
  })

  it('does not call AI generation when the post already has a caption', async () => {
    reg.getTenantSocialAccounts.mockResolvedValue([account()])
    meta.publishFacebookPost.mockResolvedValue({ id: 'fb_1' })
    const captionMod = await import('@/lib/social/caption')

    const { publishScheduledPost } = await import('@/lib/social/publisher')
    await publishScheduledPost(post({ caption: 'Already written' }))

    expect(captionMod.generateSocialCaption).not.toHaveBeenCalled()
    expect(meta.publishFacebookPost).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Already written') }),
    )
  })
})
