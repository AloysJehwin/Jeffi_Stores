/**
 * Tests for src/lib/meta.ts — the fetch-based Meta Graph API client
 * (FB Page + IG Business publishing, OAuth token exchange, hashtag reach).
 *
 * All network is mocked via vi.stubGlobal('fetch', ...). We cover success paths,
 * API-error (!res.ok) paths, and each conditional branch (missing config, missing
 * page/IG, carousel bounds, container polling FINISHED/ERROR/timeout, hashtag misses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A fetch Response stub with .ok/.status/.json().
function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const REAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env.META_APP_ID = 'APP_ID'
  process.env.META_APP_SECRET = 'APP_SECRET'
  delete process.env.META_GRAPH_VERSION
})

afterEach(() => {
  process.env = { ...REAL_ENV }
  vi.unstubAllGlobals()
})

// ── config helpers ─────────────────────────────────────────────────────────

describe('meta config', () => {
  it('getMetaConfig returns credentials when set', async () => {
    const { getMetaConfig } = await import('@/lib/catalog/meta')
    expect(getMetaConfig()).toEqual({ appId: 'APP_ID', appSecret: 'APP_SECRET' })
  })

  it('getMetaConfig throws when appId missing', async () => {
    delete process.env.META_APP_ID
    const { getMetaConfig } = await import('@/lib/catalog/meta')
    expect(() => getMetaConfig()).toThrow(/Meta not configured/)
  })

  it('getMetaConfig throws when appSecret missing', async () => {
    delete process.env.META_APP_SECRET
    const { getMetaConfig } = await import('@/lib/catalog/meta')
    expect(() => getMetaConfig()).toThrow(/Meta not configured/)
  })

  it('isMetaEnabled reflects env presence', async () => {
    const { isMetaEnabled } = await import('@/lib/catalog/meta')
    expect(isMetaEnabled()).toBe(true)
    delete process.env.META_APP_SECRET
    const { isMetaEnabled: again } = await import('@/lib/catalog/meta')
    expect(again()).toBe(false)
  })
})

// ── OAuth ───────────────────────────────────────────────────────────────────

describe('meta OAuth', () => {
  it('buildOAuthUrl embeds appId, redirect, state, scopes', async () => {
    const { buildOAuthUrl } = await import('@/lib/catalog/meta')
    const url = buildOAuthUrl('https://app/cb', 'state123')
    expect(url).toContain('client_id=APP_ID')
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb')
    expect(url).toContain('state=state123')
    expect(url).toContain('instagram_content_publish')
    expect(url).toContain('/dialog/oauth?')
  })

  it('buildOAuthUrl honours META_GRAPH_VERSION override', async () => {
    process.env.META_GRAPH_VERSION = 'v99.0'
    const { buildOAuthUrl } = await import('@/lib/catalog/meta')
    expect(buildOAuthUrl('https://app/cb', 's')).toContain('/v99.0/dialog/oauth')
  })

  it('exchangeCodeForToken returns access_token on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { access_token: 'short_tok' })))
    const { exchangeCodeForToken } = await import('@/lib/catalog/meta')
    await expect(exchangeCodeForToken('code1', 'https://app/cb')).resolves.toBe('short_tok')
  })

  it('exchangeCodeForToken throws on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400, { error: { message: 'bad code' } })))
    const { exchangeCodeForToken } = await import('@/lib/catalog/meta')
    await expect(exchangeCodeForToken('code1', 'https://app/cb')).rejects.toThrow(/bad code/)
  })

  it('exchangeCodeForToken throws with "unknown" when error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, {})))
    const { exchangeCodeForToken } = await import('@/lib/catalog/meta')
    await expect(exchangeCodeForToken('code1', 'https://app/cb')).rejects.toThrow(/unknown/)
  })

  it('exchangeCodeForToken tolerates non-JSON body (json() throws → {})', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json')
        },
      } as unknown as Response)
    )
    const { exchangeCodeForToken } = await import('@/lib/catalog/meta')
    await expect(exchangeCodeForToken('code1', 'https://app/cb')).rejects.toThrow(/502/)
  })

  it('getLongLivedToken returns token + expiresInSec from response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { access_token: 'long_tok', expires_in: 1234 })))
    const { getLongLivedToken } = await import('@/lib/catalog/meta')
    await expect(getLongLivedToken('short')).resolves.toEqual({ token: 'long_tok', expiresInSec: 1234 })
  })

  it('getLongLivedToken defaults expiresInSec when expires_in absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { access_token: 'long_tok' })))
    const { getLongLivedToken } = await import('@/lib/catalog/meta')
    const r = await getLongLivedToken('short')
    expect(r.token).toBe('long_tok')
    expect(r.expiresInSec).toBe(60 * 24 * 60 * 60)
  })
})

// ── page + IG resolution ─────────────────────────────────────────────────────

describe('getPageAndIgAccounts', () => {
  it('returns the first page with its IG business account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        res(200, {
          data: [{ id: 'P1', name: 'Acme', access_token: 'page_tok', instagram_business_account: { id: 'IG1' } }],
        })
      )
    )
    const { getPageAndIgAccounts } = await import('@/lib/catalog/meta')
    await expect(getPageAndIgAccounts('user_tok')).resolves.toEqual({
      pageId: 'P1',
      pageName: 'Acme',
      pageAccessToken: 'page_tok',
      igUserId: 'IG1',
    })
  })

  it('returns igUserId null when no IG connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        res(200, {
          data: [{ id: 'P1', name: 'Acme', access_token: 'page_tok' }],
        })
      )
    )
    const { getPageAndIgAccounts } = await import('@/lib/catalog/meta')
    const r = await getPageAndIgAccounts('user_tok')
    expect(r.igUserId).toBeNull()
  })

  it('throws when no page found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { data: [] })))
    const { getPageAndIgAccounts } = await import('@/lib/catalog/meta')
    await expect(getPageAndIgAccounts('user_tok')).rejects.toThrow(/No Facebook Page/)
  })

  it('throws when data is entirely absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {})))
    const { getPageAndIgAccounts } = await import('@/lib/catalog/meta')
    await expect(getPageAndIgAccounts('user_tok')).rejects.toThrow(/No Facebook Page/)
  })
})

// ── Facebook publishing ───────────────────────────────────────────────────────

describe('publishFacebookPost', () => {
  it('posts a photo when imageUrl is given (uses post_id)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { post_id: 'PG_1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishFacebookPost } = await import('@/lib/catalog/meta')
    const r = await publishFacebookPost({
      pageId: 'P1',
      message: 'hi',
      imageUrl: 'https://cdn/x.png',
      accessToken: 't',
    })
    expect(r).toEqual({ id: 'PG_1' })
    expect(fetchMock.mock.calls[0][0]).toContain('/P1/photos')
  })

  it('photo post falls back to id when post_id absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { id: 'ID_1' })))
    const { publishFacebookPost } = await import('@/lib/catalog/meta')
    const r = await publishFacebookPost({
      pageId: 'P1',
      message: 'hi',
      imageUrl: 'https://cdn/x.png',
      accessToken: 't',
    })
    expect(r).toEqual({ id: 'ID_1' })
  })

  it('posts to feed when no imageUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { id: 'FEED_1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishFacebookPost } = await import('@/lib/catalog/meta')
    const r = await publishFacebookPost({ pageId: 'P1', message: 'hi', accessToken: 't' })
    expect(r).toEqual({ id: 'FEED_1' })
    expect(fetchMock.mock.calls[0][0]).toContain('/P1/feed')
  })

  it('throws on FB post API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(403, { error: { message: 'no perm' } })))
    const { publishFacebookPost } = await import('@/lib/catalog/meta')
    await expect(publishFacebookPost({ pageId: 'P1', message: 'hi', accessToken: 't' })).rejects.toThrow(/no perm/)
  })
})

// ── Instagram single image ─────────────────────────────────────────────────────

describe('publishInstagramImage', () => {
  it('creates container then publishes it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CONT_1' })) // media create
      .mockResolvedValueOnce(res(200, { id: 'PUB_1' })) // media_publish
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramImage } = await import('@/lib/catalog/meta')
    const r = await publishInstagramImage({
      igUserId: 'IG1',
      imageUrl: 'https://cdn/x.png',
      caption: 'c',
      accessToken: 't',
    })
    expect(r).toEqual({ id: 'PUB_1' })
    expect(fetchMock.mock.calls[0][0]).toContain('/IG1/media')
    expect(fetchMock.mock.calls[1][0]).toContain('/IG1/media_publish')
  })

  it('propagates error from container create', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400, { error: { message: 'bad image' } })))
    const { publishInstagramImage } = await import('@/lib/catalog/meta')
    await expect(
      publishInstagramImage({ igUserId: 'IG1', imageUrl: 'x', caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/bad image/)
  })
})

// ── Instagram carousel ─────────────────────────────────────────────────────────

describe('publishInstagramCarousel', () => {
  it('rejects fewer than 2 images', async () => {
    const { publishInstagramCarousel } = await import('@/lib/catalog/meta')
    await expect(
      publishInstagramCarousel({ igUserId: 'IG1', imageUrls: ['a'], caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/2–10 images/)
  })

  it('rejects more than 10 images', async () => {
    const { publishInstagramCarousel } = await import('@/lib/catalog/meta')
    const urls = Array.from({ length: 11 }, (_, i) => `u${i}`)
    await expect(
      publishInstagramCarousel({ igUserId: 'IG1', imageUrls: urls, caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/2–10 images/)
  })

  it('creates child containers, a parent, then publishes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CHILD_1' }))
      .mockResolvedValueOnce(res(200, { id: 'CHILD_2' }))
      .mockResolvedValueOnce(res(200, { id: 'PARENT_1' }))
      .mockResolvedValueOnce(res(200, { id: 'PUB_1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramCarousel } = await import('@/lib/catalog/meta')
    const r = await publishInstagramCarousel({
      igUserId: 'IG1',
      imageUrls: ['https://a', 'https://b'],
      caption: 'c',
      accessToken: 't',
    })
    expect(r).toEqual({ id: 'PUB_1' })
    // parent create body carries the joined children ids
    expect(fetchMock.mock.calls[2][1].body).toContain('CHILD_1%2CCHILD_2')
  })
})

// ── Instagram Reel (async container polling) ────────────────────────────────────

describe('publishInstagramReel', () => {
  it('creates a REELS container, waits FINISHED, publishes (with cover)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CONT_R' })) // media create
      .mockResolvedValueOnce(res(200, { status_code: 'FINISHED' })) // poll
      .mockResolvedValueOnce(res(200, { id: 'PUB_R' })) // publish
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramReel } = await import('@/lib/catalog/meta')
    const r = await publishInstagramReel({
      igUserId: 'IG1',
      videoUrl: 'https://v.mp4',
      caption: 'c',
      accessToken: 't',
      coverUrl: 'https://cover.png',
    })
    expect(r).toEqual({ id: 'PUB_R' })
    expect(fetchMock.mock.calls[0][1].body).toContain('cover_url')
  })

  it('works without a cover url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CONT_R' }))
      .mockResolvedValueOnce(res(200, { status_code: 'FINISHED' }))
      .mockResolvedValueOnce(res(200, { id: 'PUB_R' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramReel } = await import('@/lib/catalog/meta')
    const r = await publishInstagramReel({ igUserId: 'IG1', videoUrl: 'https://v.mp4', caption: 'c', accessToken: 't' })
    expect(r).toEqual({ id: 'PUB_R' })
    expect(fetchMock.mock.calls[0][1].body).not.toContain('cover_url')
  })

  it('throws when container reaches ERROR', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CONT_R' }))
      .mockResolvedValueOnce(res(200, { status_code: 'ERROR' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramReel } = await import('@/lib/catalog/meta')
    await expect(
      publishInstagramReel({ igUserId: 'IG1', videoUrl: 'v', caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/ERROR/)
  })

  it('times out when container never reaches FINISHED', async () => {
    vi.useFakeTimers()
    // Container create then always-IN_PROGRESS polls.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { id: 'CONT_R' }))
      .mockResolvedValue(res(200, { status_code: 'IN_PROGRESS' }))
    vi.stubGlobal('fetch', fetchMock)
    const { publishInstagramReel } = await import('@/lib/catalog/meta')
    const p = publishInstagramReel({ igUserId: 'IG1', videoUrl: 'v', caption: 'c', accessToken: 't' })
    const assertion = expect(p).rejects.toThrow(/did not reach FINISHED/)
    await vi.runAllTimersAsync()
    await assertion
    vi.useRealTimers()
  })
})

// ── Hashtag reach ────────────────────────────────────────────────────────────

describe('searchHashtagReach', () => {
  it('returns 1 when hashtag resolves to an id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { data: [{ id: 'HT1' }] })) // search
      .mockResolvedValueOnce(res(200, { id: 'HT1', name: 'bolts' })) // info
    vi.stubGlobal('fetch', fetchMock)
    const { searchHashtagReach } = await import('@/lib/catalog/meta')
    await expect(searchHashtagReach('IG1', '#bolts', 't')).resolves.toBe(1)
  })

  it('returns 0 when search finds no hashtag id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { data: [] })))
    const { searchHashtagReach } = await import('@/lib/catalog/meta')
    await expect(searchHashtagReach('IG1', 'bolts', 't')).resolves.toBe(0)
  })

  it('returns 0 when info has no id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { data: [{ id: 'HT1' }] }))
      .mockResolvedValueOnce(res(200, { name: 'bolts' })) // no id
    vi.stubGlobal('fetch', fetchMock)
    const { searchHashtagReach } = await import('@/lib/catalog/meta')
    await expect(searchHashtagReach('IG1', 'bolts', 't')).resolves.toBe(0)
  })

  it('returns 0 (degrades) when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, { error: { message: 'boom' } })))
    const { searchHashtagReach } = await import('@/lib/catalog/meta')
    await expect(searchHashtagReach('IG1', 'bolts', 't')).resolves.toBe(0)
  })
})
