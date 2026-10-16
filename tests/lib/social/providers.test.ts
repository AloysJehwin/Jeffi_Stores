import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gbpProvider, starRating } from '@/lib/social/providers/gbp'
import { youtubeProvider, shortsTitle, shortsDescription } from '@/lib/social/providers/youtube'
import { pinterestProvider, pinMetrics } from '@/lib/social/providers/pinterest'
import { linkedinProvider, escapeLinkedIn } from '@/lib/social/providers/linkedin'
import { xProvider, xText } from '@/lib/social/providers/x'
import { SocialApiError, type SocialAuth } from '@/lib/social/providers/types'

type Route = (url: string, init: RequestInit) => Response | undefined
let routes: Route[] = []
const calls: { url: string; init: RequestInit }[] = []

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const on = (match: string | RegExp, res: (url: string, init: RequestInit) => Response, method?: string) =>
  routes.push((url, init) =>
    (typeof match === 'string' ? url.startsWith(match) : match.test(url)) && (!method || (init.method ?? 'GET') === method)
      ? res(url, init)
      : undefined
  )
const bodyOf = (i: number) => JSON.parse(String(calls[i].init.body))
const formOf = (i: number) => new URLSearchParams(String(calls[i].init.body))
const header = (i: number, name: string) => (calls[i].init.headers as Record<string, string>)[name]

beforeEach(() => {
  routes = []
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      for (const r of routes) {
        const res = r(url, init)
        if (res) return res
      }
      throw new Error(`unrouted ${init.method ?? 'GET'} ${url}`)
    })
  )
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret-google'
  process.env.PINTEREST_APP_ID = 'pid'
  process.env.PINTEREST_APP_SECRET = 'test-secret-pinterest'
  process.env.LINKEDIN_CLIENT_ID = 'lid'
  process.env.LINKEDIN_CLIENT_SECRET = 'test-secret-linkedin'
  process.env.X_CLIENT_ID = 'xid'
  process.env.X_CLIENT_SECRET = 'test-secret-x'
})
afterEach(() => vi.unstubAllGlobals())

const auth = (targetId: string, extra: Partial<SocialAuth> = {}): SocialAuth => ({ accessToken: 'tok', targetId, ...extra })

describe('Google Business Profile', () => {
  it('maps star ratings', () => {
    expect(starRating('ONE')).toBe(1)
    expect(starRating('FIVE')).toBe(5)
    expect(starRating('STAR_RATING_UNSPECIFIED')).toBeNull()
    expect(starRating(undefined)).toBeNull()
  })

  it('builds the Google authorize URL with offline access and no PKCE (same as the Merchant sign-in)', () => {
    const u = new URL(gbpProvider.oauth!.authorizeUrl('https://a/cb', 'st', 'chal'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('gid')
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('select_account consent')
    expect(u.searchParams.get('code_challenge')).toBeNull()
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('st')
  })

  it('exchanges and refreshes tokens', async () => {
    on('https://oauth2.googleapis.com/token', () => json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }))
    const t = await gbpProvider.oauth!.exchange('code', 'https://a/cb', 'ver')
    expect(t.accessToken).toBe('a1')
    expect(t.refreshToken).toBe('r1')
    expect(Date.parse(t.expiresAt!)).toBeGreaterThan(Date.now())
    const f = formOf(0)
    expect(f.get('grant_type')).toBe('authorization_code')
    expect(f.get('code_verifier')).toBeNull()
    expect(f.get('client_secret')).toBe('test-secret-google')

    routes = []
    on('https://oauth2.googleapis.com/token', () => json({ access_token: 'a2', expires_in: 3600 }))
    const r = await gbpProvider.oauth!.refresh!(auth('x', { refreshToken: 'old' }))
    expect(r.accessToken).toBe('a2')
    expect(r.refreshToken).toBe('old')
    expect(formOf(1).get('grant_type')).toBe('refresh_token')
  })

  it('lists locations across accounts', async () => {
    on('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', () => json({ accounts: [{ name: 'accounts/1' }] }))
    on('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations', () =>
      json({ locations: [{ name: 'locations/9', title: 'Jeffi Store' }] })
    )
    const targets = await gbpProvider.oauth!.listTargets('tok')
    expect(targets).toEqual([{ id: 'accounts/1/locations/9', name: 'Jeffi Store' }])
    expect(calls[1].url).toContain('readMask=name,title')
  })

  it('publishes a local post with photo and SHOP button', async () => {
    on('https://mybusiness.googleapis.com/v4/accounts/1/locations/9/localPosts', () =>
      json({ name: 'accounts/1/locations/9/localPosts/77', searchUrl: 'https://g/p' })
    )
    const res = await gbpProvider.publish(auth('accounts/1/locations/9'), {
      caption: 'Hello',
      link: 'https://shop/x',
      imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
    })
    expect(res).toEqual({ externalId: 'accounts/1/locations/9/localPosts/77', url: 'https://g/p' })
    expect(calls[0].init.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      languageCode: 'en-IN',
      summary: 'Hello',
      topicType: 'STANDARD',
      media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://img/1.jpg' }],
      callToAction: { actionType: 'SHOP', url: 'https://shop/x' },
    })
  })

  it('reads reviews and replies', async () => {
    on('https://mybusiness.googleapis.com/v4/accounts/1/locations/9/reviews', () =>
      json({
        reviews: [
          {
            name: 'accounts/1/locations/9/reviews/r1',
            reviewer: { displayName: 'Asha' },
            starRating: 'FOUR',
            comment: 'Nice',
            createTime: '2026-01-01T00:00:00Z',
            reviewReply: { comment: 'Thanks' },
          },
        ],
      })
    )
    const items = await gbpProvider.inbox!(auth('accounts/1/locations/9'), [])
    expect(items[0]).toMatchObject({ kind: 'review', author: 'Asha', rating: 4, replied: true, postExternalId: null })

    on(/\/reply$/, () => json({}), 'PUT')
    await gbpProvider.reply!(auth('t'), { externalId: 'accounts/1/locations/9/reviews/r1', kind: 'review' }, 'Thank you')
    expect(calls[1].url).toBe('https://mybusiness.googleapis.com/v4/accounts/1/locations/9/reviews/r1/reply')
    expect(bodyOf(1)).toEqual({ comment: 'Thank you' })
  })

  it('turns API errors into SocialApiError', async () => {
    on('https://mybusiness.googleapis.com', () => json({ error: { message: 'Location not verified' } }, 403))
    const p = gbpProvider.publish(auth('accounts/1/locations/9'), { caption: 'x', imageUrls: [] })
    await expect(p).rejects.toBeInstanceOf(SocialApiError)
    await expect(gbpProvider.publish(auth('a'), { caption: 'x', imageUrls: [] })).rejects.toMatchObject({
      network: 'gbp',
      httpStatus: 403,
      message: 'Google Business Profile: Location not verified',
    })
  })
})

describe('YouTube Shorts', () => {
  it('builds titles and descriptions', () => {
    expect(shortsTitle(null, 'First line\nSecond')).toBe('First line #Shorts')
    expect(shortsTitle('x'.repeat(98), '')).toBe('x'.repeat(98))
    expect(shortsTitle('Tagged #shorts', '')).toBe('Tagged #shorts')
    expect(shortsDescription('Cap', 'https://l')).toBe('Cap\n\nhttps://l')
  })

  it('uses the YouTube scopes', () => {
    const u = new URL(youtubeProvider.oauth!.authorizeUrl('https://a/cb', 'st', 'chal'))
    expect(u.searchParams.get('scope')!.split(' ')).toEqual([
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ])
  })

  it('lists channels', async () => {
    on('https://www.googleapis.com/youtube/v3/channels', () => json({ items: [{ id: 'UC1', snippet: { title: 'Jeffi' } }] }))
    expect(await youtubeProvider.oauth!.listTargets('tok')).toEqual([{ id: 'UC1', name: 'Jeffi' }])
  })

  it('uploads with a resumable session', async () => {
    on('https://cdn/v.mp4', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }))
    on('https://www.googleapis.com/upload/youtube/v3/videos', () => new Response(null, { status: 200, headers: { location: 'https://upload/session1' } }))
    on('https://upload/session1', () => json({ id: 'vid1' }), 'PUT')
    const res = await youtubeProvider.publish(auth('UC1'), {
      caption: 'Great drill\nBuy now',
      link: 'https://shop/d',
      imageUrls: [],
      videoUrl: 'https://cdn/v.mp4',
    })
    expect(res).toEqual({ externalId: 'vid1', url: 'https://www.youtube.com/shorts/vid1' })
    expect(calls[1].url).toContain('uploadType=resumable')
    expect(header(1, 'X-Upload-Content-Type')).toBe('video/mp4')
    expect(header(1, 'X-Upload-Content-Length')).toBe('3')
    expect(bodyOf(1)).toEqual({
      snippet: { title: 'Great drill #Shorts', description: 'Great drill\nBuy now\n\nhttps://shop/d', categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    })
    expect(calls[2].init.method).toBe('PUT')
  })

  it('refuses posts without a video', async () => {
    await expect(youtubeProvider.publish(auth('UC1'), { caption: 'x', imageUrls: [] })).rejects.toBeInstanceOf(SocialApiError)
  })

  it('reads statistics and comments, and replies', async () => {
    on('https://www.googleapis.com/youtube/v3/videos', () =>
      json({ items: [{ id: 'v1', statistics: { viewCount: '100', likeCount: '5', commentCount: '2' } }] })
    )
    expect(await youtubeProvider.metrics!(auth('UC1'), ['v1'])).toEqual({ v1: { videoViews: 100, likes: 5, comments: 2 } })

    on('https://www.googleapis.com/youtube/v3/commentThreads', () =>
      json({
        items: [
          {
            snippet: {
              totalReplyCount: 1,
              topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'Ravi', textOriginal: 'Price?', publishedAt: 't' } },
            },
          },
        ],
      })
    )
    const items = await youtubeProvider.inbox!(auth('UC1'), ['v1'])
    expect(items).toEqual([
      { externalId: 'c1', postExternalId: 'v1', kind: 'comment', author: 'Ravi', text: 'Price?', createdAt: 't', replied: true },
    ])

    on('https://www.googleapis.com/youtube/v3/comments', () => json({ id: 'c2' }), 'POST')
    await youtubeProvider.reply!(auth('UC1'), { externalId: 'c1', kind: 'comment' }, 'Rs 999')
    expect(bodyOf(2)).toEqual({ snippet: { parentId: 'c1', textOriginal: 'Rs 999' } })
  })
})

describe('Pinterest', () => {
  it('builds the authorize URL', () => {
    const u = new URL(pinterestProvider.oauth!.authorizeUrl('https://a/cb', 'st', 'chal'))
    expect(u.origin + u.pathname).toBe('https://www.pinterest.com/oauth/')
    expect(u.searchParams.get('scope')).toBe('boards:read,pins:read,pins:write,user_accounts:read')
    expect(u.searchParams.get('client_id')).toBe('pid')
    expect(u.searchParams.get('code_challenge')).toBeNull()
  })

  it('exchanges with Basic auth and refreshes', async () => {
    on('https://api.pinterest.com/v5/oauth/token', () => json({ access_token: 'pa', refresh_token: 'pr', expires_in: 60 }))
    const t = await pinterestProvider.oauth!.exchange('c', 'https://a/cb', '')
    expect(t).toMatchObject({ accessToken: 'pa', refreshToken: 'pr' })
    expect(header(0, 'Authorization')).toBe(`Basic ${Buffer.from('pid:test-secret-pinterest').toString('base64')}`)
    expect(formOf(0).get('grant_type')).toBe('authorization_code')
    const r = await pinterestProvider.oauth!.refresh!(auth('b', { refreshToken: 'old' }))
    expect(r.accessToken).toBe('pa')
    expect(formOf(1).get('refresh_token')).toBe('old')
  })

  it('creates an image pin', async () => {
    on('https://api.pinterest.com/v5/pins', () => json({ id: '555' }), 'POST')
    const res = await pinterestProvider.publish(auth('board1'), {
      caption: 'Steel hammer\nTough',
      link: 'https://shop/h',
      imageUrls: ['https://img/h.jpg'],
    })
    expect(res).toEqual({ externalId: '555', url: 'https://www.pinterest.com/pin/555/' })
    expect(bodyOf(0)).toMatchObject({
      board_id: 'board1',
      title: 'Steel hammer',
      description: 'Steel hammer\nTough',
      link: 'https://shop/h',
      media_source: { source_type: 'image_url', url: 'https://img/h.jpg' },
    })
  })

  it('sums analytics', async () => {
    expect(
      pinMetrics({ daily_metrics: [{ metrics: { IMPRESSION: 3, SAVE: 1, PIN_CLICK: 1 } }, { metrics: { IMPRESSION: 2, OUTBOUND_CLICK: 4 } }] })
    ).toEqual({ impressions: 5, saves: 1, clicks: 5 })
    on('https://api.pinterest.com/v5/pins/555/analytics', () =>
      json({ all: { summary_metrics: { IMPRESSION: 10, SAVE: 2, PIN_CLICK: 3, OUTBOUND_CLICK: 1 } } })
    )
    expect(await pinterestProvider.metrics!(auth('b'), ['555'])).toEqual({ '555': { impressions: 10, saves: 2, clicks: 4 } })
    expect(calls[0].url).toContain('metric_types=IMPRESSION%2CSAVE%2CPIN_CLICK%2COUTBOUND_CLICK')
  })

  it('raises SocialApiError with the API message', async () => {
    on('https://api.pinterest.com', () => json({ code: 1, message: 'Board not found' }, 404))
    await expect(pinterestProvider.publish(auth('b'), { caption: 'x', imageUrls: ['https://i'] })).rejects.toMatchObject({
      network: 'pinterest',
      httpStatus: 404,
      message: 'Pinterest: Board not found',
    })
  })
})

describe('LinkedIn', () => {
  it('escapes reserved characters but keeps hashtags', () => {
    expect(escapeLinkedIn('Sale (50%) @home #tools # *bold* a_b')).toBe('Sale \\(50%\\) \\@home #tools \\# \\*bold\\* a\\_b')
  })

  it('builds the authorize URL', () => {
    const u = new URL(linkedinProvider.oauth!.authorizeUrl('https://a/cb', 'st', 'chal'))
    expect(u.origin + u.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization')
    expect(u.searchParams.get('scope')).toBe('r_organization_social w_organization_social rw_organization_admin')
  })

  it('exchanges tokens', async () => {
    on('https://www.linkedin.com/oauth/v2/accessToken', () => json({ access_token: 'la', expires_in: 5184000, refresh_token: 'lr' }))
    const t = await linkedinProvider.oauth!.exchange('c', 'https://a/cb', '')
    expect(t).toMatchObject({ accessToken: 'la', refreshToken: 'lr' })
    expect(formOf(0).get('client_secret')).toBe('test-secret-linkedin')
  })

  it('lists admin organisations with names', async () => {
    on('https://api.linkedin.com/rest/organizationAcls', () =>
      json({ elements: [{ organization: 'urn:li:organization:1' }, { organization: 'urn:li:organization:2' }] })
    )
    on('https://api.linkedin.com/rest/organizations/1', () => json({ localizedName: 'Jeffi' }))
    on('https://api.linkedin.com/rest/organizations/2', () => json({ message: 'no' }, 403))
    expect(await linkedinProvider.oauth!.listTargets('tok')).toEqual([
      { id: 'urn:li:organization:1', name: 'Jeffi' },
      { id: 'urn:li:organization:2', name: 'urn:li:organization:2' },
    ])
    expect(header(0, 'X-Restli-Protocol-Version')).toBe('2.0.0')
    expect(header(0, 'LinkedIn-Version')).toBeTruthy()
  })

  it('uploads an image and posts', async () => {
    on('https://api.linkedin.com/rest/images', () =>
      json({ value: { uploadUrl: 'https://up/li', image: 'urn:li:image:9' } })
    )
    on('https://img/a.jpg', () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }))
    on('https://up/li', () => new Response(null, { status: 201 }), 'PUT')
    on('https://api.linkedin.com/rest/posts', () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } }))
    const res = await linkedinProvider.publish(auth('urn:li:organization:1'), {
      caption: 'New #drill (cordless)',
      title: 'Drill',
      imageUrls: ['https://img/a.jpg'],
    })
    expect(res).toEqual({ externalId: 'urn:li:share:7', url: 'https://www.linkedin.com/feed/update/urn:li:share:7/' })
    expect(bodyOf(0)).toEqual({ initializeUploadRequest: { owner: 'urn:li:organization:1' } })
    const post = bodyOf(3)
    expect(post).toMatchObject({
      author: 'urn:li:organization:1',
      commentary: 'New #drill \\(cordless\\)',
      visibility: 'PUBLIC',
      lifecycleState: 'PUBLISHED',
      content: { media: { id: 'urn:li:image:9', title: 'Drill' } },
    })
  })

  it('posts an article when there is only a link', async () => {
    on('https://api.linkedin.com/rest/posts', () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:8' } }))
    await linkedinProvider.publish(auth('urn:li:organization:1'), { caption: 'Hi', link: 'https://shop', imageUrls: [] })
    expect(bodyOf(0).content).toEqual({ article: { source: 'https://shop', title: 'Shop now' } })
  })

  it('reads social actions and maps errors', async () => {
    on('https://api.linkedin.com/rest/socialActions/', () =>
      json({ likesSummary: { totalLikes: 4 }, commentsSummary: { aggregatedTotalComments: 2 } })
    )
    expect(await linkedinProvider.metrics!(auth('o'), ['urn:li:share:7'])).toEqual({ 'urn:li:share:7': { likes: 4, comments: 2 } })
    expect(calls[0].url).toBe('https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7')

    routes = []
    on('https://api.linkedin.com', () => json({ message: 'Not enough permissions', status: 403 }, 403))
    await expect(linkedinProvider.publish(auth('o'), { caption: 'x', imageUrls: [] })).rejects.toMatchObject({
      network: 'linkedin',
      message: 'LinkedIn: Not enough permissions',
    })
  })
})

describe('X', () => {
  it('fits text with the link weighted as 23', () => {
    expect(xText('Hello', 'https://example.com/a/very/long/path')).toBe('Hello https://example.com/a/very/long/path')
    const t = xText('word '.repeat(100), 'https://l')
    expect(t.endsWith(' https://l')).toBe(true)
    expect(t.length - 'https://l'.length + 23).toBeLessThanOrEqual(280)
    expect(xText('a'.repeat(300)).length).toBe(280)
  })

  it('builds the PKCE authorize URL', () => {
    const u = new URL(xProvider.oauth!.authorizeUrl('https://a/cb', 'st', 'chal'))
    expect(u.origin + u.pathname).toBe('https://x.com/i/oauth2/authorize')
    expect(u.searchParams.get('scope')).toBe('tweet.read tweet.write users.read media.write offline.access')
    expect(u.searchParams.get('code_challenge')).toBe('chal')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('exchanges and rotates refresh tokens', async () => {
    on('https://api.x.com/2/oauth2/token', () => json({ access_token: 'xa', refresh_token: 'xr2', expires_in: 7200 }))
    const t = await xProvider.oauth!.exchange('c', 'https://a/cb', 'ver')
    expect(t.accessToken).toBe('xa')
    expect(formOf(0).get('code_verifier')).toBe('ver')
    expect(header(0, 'Authorization')).toBe(`Basic ${Buffer.from('xid:test-secret-x').toString('base64')}`)
    const r = await xProvider.oauth!.refresh!(auth('u', { refreshToken: 'xr1' }))
    expect(r.refreshToken).toBe('xr2')
  })

  it('lists the signed-in user', async () => {
    on('https://api.x.com/2/users/me', () => json({ data: { id: '42', username: 'jeffi' } }))
    expect(await xProvider.oauth!.listTargets('tok')).toEqual([{ id: '42', name: '@jeffi' }])
  })

  it('uploads media and posts', async () => {
    on('https://img/x.png', () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }))
    on('https://api.x.com/2/media/upload', () => json({ data: { id: 'm1' } }))
    on('https://api.x.com/2/tweets', () => json({ data: { id: 't1', text: '' } }), 'POST')
    const res = await xProvider.publish(auth('42'), { caption: 'Deal', link: 'https://s', imageUrls: ['https://img/x.png'] })
    expect(res).toEqual({ externalId: 't1', url: 'https://x.com/i/web/status/t1' })
    const form = calls[1].init.body as FormData
    expect(form.get('media_category')).toBe('tweet_image')
    expect(form.get('media')).toBeInstanceOf(Blob)
    expect(bodyOf(2)).toEqual({ text: 'Deal https://s', media: { media_ids: ['m1'] } })
  })

  it('reads public metrics and maps errors', async () => {
    on('https://api.x.com/2/tweets?ids=', () =>
      json({
        data: [
          { id: 't1', public_metrics: { like_count: 3, retweet_count: 1, quote_count: 1, reply_count: 2, impression_count: 90 } },
        ],
      })
    )
    expect(await xProvider.metrics!(auth('42'), ['t1'])).toEqual({ t1: { likes: 3, shares: 2, comments: 2, impressions: 90 } })

    routes = []
    on('https://api.x.com', () => json({ title: 'Forbidden', detail: 'You are not permitted to perform this action.' }, 403))
    await expect(xProvider.publish(auth('42'), { caption: 'x', imageUrls: [] })).rejects.toMatchObject({
      network: 'x',
      httpStatus: 403,
      message: 'X: You are not permitted to perform this action.',
    })
  })
})
