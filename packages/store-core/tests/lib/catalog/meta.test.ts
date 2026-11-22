import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: vi.fn(),
  getIntegrationCredential: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: vi.fn((s: string) => `enc:${s}`),
  decryptToken: vi.fn((s: string) => String(s).replace(/^enc:/, '')),
}))

import {
  META_GRAPH_VERSION,
  META_GRAPH,
  META_SOCIAL_SCOPES,
  META_ADS_SCOPES,
  cleanMetaId,
  platformMetaAppIdInvalid,
  platformMetaConfig,
  readOwnMetaApp,
  saveOwnMetaApp,
  deleteOwnMetaApp,
  ownMetaAppsById,
  findMetaConfig,
  getMetaConfig,
  buildOAuthUrl,
  exchangeCodeForToken,
  getLongLivedToken,
  verifyMetaApp,
  getMetaUser,
  tokenScopes,
  listMetaPages,
  getPageInfo,
  publishFacebookPost,
  publishFacebookCarousel,
  publishInstagramImage,
  publishInstagramCarousel,
  publishInstagramReel,
  searchHashtagReach,
  type MetaConfig,
} from '@/lib/catalog/meta'
import {
  controlPlanePool,
  getIntegrationCredential,
  saveIntegrationCredential,
  deleteIntegrationCredential,
} from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'

const ENV = process.env
const CFG: MetaConfig = { appId: '111111', appSecret: 'secret', loginConfigId: null, adsLoginConfigId: null, source: 'platform' }

/** A fetch mock that returns `body` as JSON with the given ok/status. */
function fetchOnce(body: any, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body })
}

beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.META_APP_ID
  delete process.env.META_APP_SECRET
  delete process.env.META_LOGIN_CONFIG_ID
  delete process.env.META_ADS_LOGIN_CONFIG_ID
  vi.clearAllMocks()
})
afterEach(() => {
  process.env = ENV
  vi.unstubAllGlobals()
})

describe('constants', () => {
  it('graph version and base url', () => {
    expect(META_GRAPH).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}`)
    expect(META_SOCIAL_SCOPES).toContain('instagram_content_publish')
    expect(META_ADS_SCOPES).toContain('ads_management')
  })
})

describe('cleanMetaId', () => {
  it('accepts a 5–25 digit id, trimming quotes/space', () => {
    expect(cleanMetaId('  "123456"  ')).toBe('123456')
  })
  it('rejects non-numeric, too short, too long, nullish', () => {
    expect(cleanMetaId('abc')).toBeNull()
    expect(cleanMetaId('123')).toBeNull()
    expect(cleanMetaId('1'.repeat(26))).toBeNull()
    expect(cleanMetaId(null)).toBeNull()
  })
})

describe('platformMetaAppIdInvalid', () => {
  it('false when unset, true when set but not an id', () => {
    expect(platformMetaAppIdInvalid()).toBe(false)
    process.env.META_APP_ID = 'not-an-id'
    expect(platformMetaAppIdInvalid()).toBe(true)
    process.env.META_APP_ID = '123456'
    expect(platformMetaAppIdInvalid()).toBe(false)
  })
})

describe('platformMetaConfig', () => {
  it('null when env missing', () => {
    expect(platformMetaConfig()).toBeNull()
  })
  it('builds config from env, parsing login config ids', () => {
    process.env.META_APP_ID = '111111'
    process.env.META_APP_SECRET = '"topsecret"'
    process.env.META_LOGIN_CONFIG_ID = '222222'
    const c = platformMetaConfig()!
    expect(c).toMatchObject({ appId: '111111', appSecret: 'topsecret', loginConfigId: '222222', source: 'platform' })
  })
  it('warns once and returns null for an invalid app id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.META_APP_ID = 'bogus'
    process.env.META_APP_SECRET = 's'
    expect(platformMetaConfig()).toBeNull()
    warn.mockRestore()
  })
})

describe('readOwnMetaApp', () => {
  it('null when no connected credential', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
    expect(await readOwnMetaApp('t1')).toBeNull()
    vi.mocked(getIntegrationCredential).mockResolvedValue({ status: 'pending' } as any)
    expect(await readOwnMetaApp('t1')).toBeNull()
  })
  it('decrypts and validates the stored app', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({
      status: 'connected',
      config_enc: `enc:${JSON.stringify({ appId: '123456', appSecret: 'x', loginConfigId: '789012' })}`,
    } as any)
    const app = await readOwnMetaApp('t1')
    expect(app).toMatchObject({ appId: '123456', appSecret: 'x', loginConfigId: '789012' })
  })
  it('null when the stored json lacks an app id or secret', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({
      status: 'connected',
      config_enc: `enc:${JSON.stringify({ appId: 'bad', appSecret: 'x' })}`,
    } as any)
    expect(await readOwnMetaApp('t1')).toBeNull()
  })
  it('null when decryption/parse throws', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({ status: 'connected', config_enc: 'enc:{bad' } as any)
    expect(await readOwnMetaApp('t1')).toBeNull()
  })
})

describe('saveOwnMetaApp / deleteOwnMetaApp', () => {
  it('encrypts the app and records its meta', async () => {
    await saveOwnMetaApp('t1', { appId: '123456', appSecret: 's', loginConfigId: '789012', adsLoginConfigId: null })
    const arg = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(arg.provider).toBe('meta_app')
    expect(encryptToken).toHaveBeenCalled()
    expect(arg.meta).toEqual({ app_id: '123456', login_config_id: '789012', ads_login_config_id: null })
  })
  it('delete calls through to the registry', async () => {
    await deleteOwnMetaApp('t1')
    expect(deleteIntegrationCredential).toHaveBeenCalledWith('t1', 'meta_app')
  })
})

describe('ownMetaAppsById', () => {
  it('returns decryptable apps with an id+secret, skipping bad rows', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { tenant_id: 't1', config_enc: `enc:${JSON.stringify({ appId: '1', appSecret: 's' })}` },
        { tenant_id: 't2', config_enc: 'enc:{broken' },
        { tenant_id: 't3', config_enc: `enc:${JSON.stringify({ appId: '', appSecret: '' })}` },
      ],
    })
    vi.mocked(controlPlanePool).mockReturnValue({ query } as any)
    const apps = await ownMetaAppsById('999')
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ appId: '1', tenantId: 't1' })
    expect(query.mock.calls[0][1]).toEqual(['meta_app', '999'])
  })
})

describe('findMetaConfig / getMetaConfig', () => {
  it('prefers the store own app', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({
      status: 'connected',
      config_enc: `enc:${JSON.stringify({ appId: '123456', appSecret: 'x' })}`,
    } as any)
    const c = await findMetaConfig('t1')
    expect(c?.source).toBe('own')
  })
  it('source=own returns null when the store has no own app', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
    expect(await findMetaConfig('t1', 'own')).toBeNull()
  })
  it('falls back to the flagship own app, then platform env', async () => {
    // tenant has none; flagship (sentinel id) has one
    vi.mocked(getIntegrationCredential).mockImplementation(async (tid: string) =>
      tid === '00000000-0000-0000-0000-000000000000'
        ? ({ status: 'connected', config_enc: `enc:${JSON.stringify({ appId: '555555', appSecret: 'f' })}` } as any)
        : (null as any)
    )
    const c = await findMetaConfig('t1')
    expect(c).toMatchObject({ appId: '555555', source: 'platform' })
  })
  it('uses env platform config when no flagship app', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
    process.env.META_APP_ID = '111111'
    process.env.META_APP_SECRET = 's'
    const c = await findMetaConfig(null)
    expect(c).toMatchObject({ appId: '111111', source: 'platform' })
  })
  it('getMetaConfig throws when none; own vs platform message', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
    await expect(getMetaConfig('t1', 'own')).rejects.toThrow(/own Meta app is not set up/)
    await expect(getMetaConfig(null)).rejects.toThrow(/set META_APP_ID/)
  })
})

describe('buildOAuthUrl', () => {
  it('uses a scope list when no config id', () => {
    const url = buildOAuthUrl(CFG, 'https://cb', 'st', 'social')
    expect(url).toContain('client_id=111111')
    expect(url).toContain('scope=')
    expect(url).toContain('response_type=code')
  })
  it('uses config_id for a Business-type app and overrides response type', () => {
    const url = buildOAuthUrl({ ...CFG, loginConfigId: '222222' }, 'https://cb', 'st', 'social')
    expect(url).toContain('config_id=222222')
    expect(url).toContain('override_default_response_type=true')
    expect(url).not.toContain('scope=')
  })
  it('picks the ads config id and ads scopes for kind=ads', () => {
    expect(buildOAuthUrl(CFG, 'https://cb', 'st', 'ads')).toContain('ads_read')
    expect(buildOAuthUrl({ ...CFG, adsLoginConfigId: '333333' }, 'https://cb', 'st', 'ads')).toContain('config_id=333333')
  })
})

describe('OAuth token exchange', () => {
  it('exchangeCodeForToken returns the access token', async () => {
    vi.stubGlobal('fetch', fetchOnce({ access_token: 'tok' }))
    expect(await exchangeCodeForToken('code', 'https://cb', CFG)).toBe('tok')
  })
  it('getLongLivedToken returns token + expiry, defaulting when absent', async () => {
    vi.stubGlobal('fetch', fetchOnce({ access_token: 'long' }))
    expect(await getLongLivedToken('short', CFG)).toEqual({ token: 'long', expiresInSec: 60 * 24 * 60 * 60 })
  })
  it('graphGet throws Meta error message on !ok', async () => {
    vi.stubGlobal('fetch', fetchOnce({ error: { message: 'boom' } }, false, 400))
    await expect(exchangeCodeForToken('c', 'cb', CFG)).rejects.toThrow(/Meta GET .* failed \(400\): boom/)
  })
})

describe('verifyMetaApp', () => {
  it('passes when an app token comes back', async () => {
    vi.stubGlobal('fetch', fetchOnce({ access_token: 'app-tok' }))
    await expect(verifyMetaApp('1', 's')).resolves.toBeUndefined()
  })
  it('throws when no token', async () => {
    vi.stubGlobal('fetch', fetchOnce({}))
    await expect(verifyMetaApp('1', 's')).rejects.toThrow(/no app access token/)
  })
})

describe('getMetaUser', () => {
  it('returns id and only granted permissions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'u1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ permission: 'a', status: 'granted' }, { permission: 'b', status: 'declined' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getMetaUser('tok')).toEqual({ id: 'u1', granted: ['a'] })
  })
  it('tolerates a failed permissions fetch (empty grants)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'u1' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'x' } }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getMetaUser('tok')).toEqual({ id: 'u1', granted: [] })
  })
})

describe('tokenScopes', () => {
  it('returns scopes for a valid token', async () => {
    vi.stubGlobal('fetch', fetchOnce({ data: { is_valid: true, scopes: ['x', 'y'] } }))
    expect(await tokenScopes('tok', CFG)).toEqual(['x', 'y'])
  })
  it('null when invalid or on error', async () => {
    vi.stubGlobal('fetch', fetchOnce({ data: { is_valid: false } }))
    expect(await tokenScopes('tok', CFG)).toBeNull()
    vi.stubGlobal('fetch', fetchOnce({ error: { message: 'bad' } }, false, 400))
    expect(await tokenScopes('tok', CFG)).toBeNull()
  })
})

describe('listMetaPages', () => {
  it('maps pages and filters those without id/token', async () => {
    vi.stubGlobal(
      'fetch',
      fetchOnce({
        data: [
          { id: '1', name: 'P', access_token: 'pt', instagram_business_account: { id: 'ig1' } },
          { id: '2' }, // no access token → filtered
        ],
      })
    )
    const pages = await listMetaPages('tok')
    expect(pages).toEqual([{ pageId: '1', pageName: 'P', pageAccessToken: 'pt', igUserId: 'ig1' }])
  })
})

describe('getPageInfo', () => {
  it('returns page id/name and linked ig account', async () => {
    vi.stubGlobal('fetch', fetchOnce({ id: '1', name: 'P', instagram_business_account: { id: 'ig1' } }))
    expect(await getPageInfo('1', 'tok')).toEqual({ pageId: '1', pageName: 'P', igUserId: 'ig1' })
  })
  it('null ig account when absent', async () => {
    vi.stubGlobal('fetch', fetchOnce({ id: '1', name: '' }))
    expect(await getPageInfo('1', 'tok')).toEqual({ pageId: '1', pageName: '', igUserId: null })
  })
})

describe('publishFacebookPost', () => {
  it('photo post when imageUrl given (prefers post_id)', async () => {
    vi.stubGlobal('fetch', fetchOnce({ post_id: 'pp', id: 'mid' }))
    expect(await publishFacebookPost({ pageId: '1', message: 'hi', imageUrl: 'u', accessToken: 't' })).toEqual({ id: 'pp' })
  })
  it('feed post with a link card when no image', async () => {
    const fetchMock = fetchOnce({ id: 'feed1' })
    vi.stubGlobal('fetch', fetchMock)
    const r = await publishFacebookPost({ pageId: '1', message: 'hi', accessToken: 't', link: 'https://l' })
    expect(r).toEqual({ id: 'feed1' })
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('link=')
  })
})

describe('publishFacebookCarousel', () => {
  it('rejects fewer than 2 images', async () => {
    await expect(publishFacebookCarousel({ pageId: '1', message: 'm', imageUrls: ['a'], accessToken: 't' })).rejects.toThrow(
      /at least 2 images/
    )
  })
  it('uploads each photo unpublished then attaches them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm2' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'feed' }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await publishFacebookCarousel({ pageId: '1', message: 'm', imageUrls: ['a', 'b'], accessToken: 't' })
    expect(r).toEqual({ id: 'feed' })
    expect(String(fetchMock.mock.calls[2][1].body)).toContain('attached_media')
  })
})

describe('publishInstagramImage', () => {
  it('creates a container then publishes it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'c1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pub1' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await publishInstagramImage({ igUserId: 'ig', imageUrl: 'u', caption: 'c', accessToken: 't' })).toEqual({
      id: 'pub1',
    })
  })
})

describe('publishInstagramCarousel', () => {
  it('rejects outside 2..10 images', async () => {
    await expect(
      publishInstagramCarousel({ igUserId: 'ig', imageUrls: ['a'], caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/2–10 images/)
    await expect(
      publishInstagramCarousel({ igUserId: 'ig', imageUrls: Array(11).fill('a'), caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/2–10 images/)
  })
  it('creates children then a CAROUSEL parent and publishes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ch1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ch2' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'parent' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pub' }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await publishInstagramCarousel({ igUserId: 'ig', imageUrls: ['a', 'b'], caption: 'c', accessToken: 't' })
    expect(r).toEqual({ id: 'pub' })
    expect(String(fetchMock.mock.calls[2][1].body)).toContain('CAROUSEL')
  })
})

describe('publishInstagramReel', () => {
  it('polls until FINISHED then publishes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'c1' }) }) // create container
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status_code: 'FINISHED' }) }) // poll
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pub' }) }) // publish
    vi.stubGlobal('fetch', fetchMock)
    const r = await publishInstagramReel({ igUserId: 'ig', videoUrl: 'v', caption: 'c', accessToken: 't', coverUrl: 'cov' })
    expect(r).toEqual({ id: 'pub' })
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('REELS')
  })
  it('throws when the container processing errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'c1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status_code: 'ERROR' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      publishInstagramReel({ igUserId: 'ig', videoUrl: 'v', caption: 'c', accessToken: 't' })
    ).rejects.toThrow(/processing failed/)
  })
})

describe('searchHashtagReach', () => {
  it('returns 1 when a hashtag resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: 'h1' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'h1', name: 'tag' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchHashtagReach('ig', '#tag', 't')).toBe(1)
  })
  it('0 when no hashtag id', async () => {
    vi.stubGlobal('fetch', fetchOnce({ data: [] }))
    expect(await searchHashtagReach('ig', 'tag', 't')).toBe(0)
  })
  it('0 on any error', async () => {
    vi.stubGlobal('fetch', fetchOnce({ error: { message: 'x' } }, false, 400))
    expect(await searchHashtagReach('ig', 'tag', 't')).toBe(0)
  })
})
