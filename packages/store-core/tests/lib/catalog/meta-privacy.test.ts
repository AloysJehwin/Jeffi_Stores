import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/catalog/meta', () => ({
  ownMetaAppsById: vi.fn(),
  platformMetaConfig: vi.fn(),
}))
vi.mock('@/lib/meta-ads/client', () => ({ META_ADS_PROVIDER: 'meta_ads' }))
vi.mock('@/lib/social/meta-connect', () => ({ META_PAGE_PICK_PROVIDER: 'meta_page_pick' }))

import {
  signedRequestFrom,
  parseSignedRequest,
  verifyMetaSignedRequest,
  deleteMetaUserData,
  deletionCode,
  readDeletionCode,
} from '@/lib/catalog/meta-privacy'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ownMetaAppsById, platformMetaConfig } from '@/lib/catalog/meta'

const SECRET = 'app-secret-123'
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Build a valid Meta signed_request for a payload object. */
function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest())
  return `${sig}.${p}`
}

const ENV = process.env
beforeEach(() => {
  process.env = { ...ENV, CRON_SECRET: 'cron-secret' }
  vi.clearAllMocks()
})
afterEach(() => {
  process.env = ENV
})

describe('signedRequestFrom', () => {
  it('reads from a JSON body', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_request: 'abc.def' }),
    })
    expect(await signedRequestFrom(req)).toBe('abc.def')
  })
  it('null when the JSON value is missing or not a string', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_request: 123 }),
    })
    expect(await signedRequestFrom(req)).toBeNull()
  })
  it('reads from form data', async () => {
    const fd = new FormData()
    fd.set('signed_request', 'sig.payload')
    const req = new Request('http://x', { method: 'POST', body: fd })
    expect(await signedRequestFrom(req)).toBe('sig.payload')
  })
  it('null on a parse error', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    })
    expect(await signedRequestFrom(req)).toBeNull()
  })
})

describe('parseSignedRequest', () => {
  it('returns the payload for a valid HMAC-SHA256 request', () => {
    const r = parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 42 }), SECRET)
    expect(r).toEqual({ algorithm: 'HMAC-SHA256', user_id: '42' })
  })
  it('null when parts, secret, or signature are missing/wrong', () => {
    expect(parseSignedRequest('onlyonepart', SECRET)).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 1 }), '')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 1 }, 'other'), SECRET)).toBeNull()
  })
  it('null when algorithm is not HMAC-SHA256 or user_id missing', () => {
    expect(parseSignedRequest(sign({ algorithm: 'MD5', user_id: 1 }), SECRET)).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }), SECRET)).toBeNull()
  })
  it('null when the payload is not valid JSON', () => {
    const p = b64url(Buffer.from('{not json'))
    const sig = b64url(crypto.createHmac('sha256', SECRET).update(p).digest())
    expect(parseSignedRequest(`${sig}.${p}`, SECRET)).toBeNull()
  })
})

describe('verifyMetaSignedRequest', () => {
  it('matches the platform app when no appId or the ids agree', async () => {
    vi.mocked(platformMetaConfig).mockReturnValue({ appId: '111', appSecret: SECRET } as any)
    vi.mocked(ownMetaAppsById).mockResolvedValue([])
    const r = await verifyMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 7 }), '111')
    expect(r).toEqual({ userId: '7', source: 'platform', tenantIds: null })
  })
  it('falls through to own apps when the platform secret does not verify', async () => {
    vi.mocked(platformMetaConfig).mockReturnValue(null)
    vi.mocked(ownMetaAppsById).mockResolvedValue([
      { tenantId: 't1', appId: '222', appSecret: SECRET } as any,
      { tenantId: 't2', appId: '222', appSecret: 'other' } as any,
    ])
    const r = await verifyMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 9 }), '222')
    // Only t1's secret verifies and shares the same user id.
    expect(r).toEqual({ userId: '9', source: 'own', tenantIds: ['t1'] })
  })
  it('null when nothing verifies', async () => {
    vi.mocked(platformMetaConfig).mockReturnValue(null)
    vi.mocked(ownMetaAppsById).mockResolvedValue([])
    expect(await verifyMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 1 }), null)).toBeNull()
  })
  it('skips the platform branch when the appId names a different app', async () => {
    vi.mocked(platformMetaConfig).mockReturnValue({ appId: '111', appSecret: SECRET } as any)
    vi.mocked(ownMetaAppsById).mockResolvedValue([])
    // appId '999' != platform '111' → platform branch skipped, no own apps → null
    expect(await verifyMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 1 }), '999')).toBeNull()
  })
})

describe('deleteMetaUserData', () => {
  it('deletes social + creds scoped to tenantIds and sums the row counts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 3 })
    vi.mocked(controlPlanePool).mockReturnValue({ query } as any)
    const n = await deleteMetaUserData('u1', ['t1', 't2'])
    expect(n).toBe(5)
    expect(query.mock.calls[0][0]).toContain('DELETE FROM tenant_social_accounts')
    expect(query.mock.calls[0][0]).toContain('AND tenant_id = ANY($2::uuid[])')
    expect(query.mock.calls[0][1]).toEqual(['u1', ['t1', 't2']])
    expect(query.mock.calls[1][0]).toContain("provider IN ('meta_ads','meta_page_pick')")
  })
  it('no scope clause and single arg when tenantIds is null; handles null rowCount', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: null })
    vi.mocked(controlPlanePool).mockReturnValue({ query } as any)
    const n = await deleteMetaUserData('u1', null)
    expect(n).toBe(0)
    expect(query.mock.calls[0][0]).not.toContain('tenant_id = ANY')
    expect(query.mock.calls[0][1]).toEqual(['u1'])
  })
})

describe('deletion codes', () => {
  it('round-trips a self-verifying code', () => {
    const at = new Date('2024-01-02T03:04:00Z')
    const code = deletionCode(5, at)
    const parsed = readDeletionCode(code)
    expect(parsed?.deleted).toBe(5)
    expect(Math.floor(parsed!.at.getTime() / 1000)).toBe(Math.floor(at.getTime() / 1000))
  })
  it('null on a malformed code or bad signature', () => {
    expect(readDeletionCode('nodot')).toBeNull()
    const good = deletionCode(1)
    const [payload] = good.split('.')
    expect(readDeletionCode(`${payload}.deadbeefdeadbeef`)).toBeNull()
  })
  it('null when the payload is not valid base64url JSON', () => {
    // Build payload+sig where sig matches but payload is not JSON.
    const payload = Buffer.from('not json').toString('base64url')
    const sig = crypto
      .createHmac('sha256', 'cron-secret')
      .update(`meta-deletion:${payload}`)
      .digest('base64url')
      .slice(0, 16)
    expect(readDeletionCode(`${payload}.${sig}`)).toBeNull()
  })
  it('deletionCode throws without CRON_SECRET', () => {
    delete process.env.CRON_SECRET
    expect(() => deletionCode(1)).toThrow(/CRON_SECRET not set/)
  })
})
