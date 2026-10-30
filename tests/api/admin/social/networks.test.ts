import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/import/jobs', () => ({ PLATFORM_TENANT_ID: 'platform' }))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${Buffer.from(s).toString('base64')}`,
  decryptToken: (s: string) => Buffer.from(s.slice(4), 'base64').toString(),
}))

import { POST as manualPOST } from '@controller/app/api/(admin)/admin/social/networks/[network]/manual/route'
import { POST as pickPOST, GET as pickGET } from '@controller/app/api/(admin)/admin/social/networks/[network]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { providerFor } from '@/lib/social/providers'
import { listConnections } from '@/lib/social/data'

const ctx = (network: string) => ({ params: Promise.resolve({ network }) })
const req = (url: string, body?: unknown) =>
  new NextRequest(`https://admin-acme.jeffistores.in${url}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
const manual = (network: string, body: unknown) => manualPOST(req(`/api/admin/social/networks/${network}/manual`, body), ctx(network))
const decode = (enc: string) => JSON.parse(Buffer.from(enc.slice(4), 'base64').toString())
const insertArgs = () => query.mock.calls.find(c => String(c[0]).startsWith('INSERT'))?.[1] as unknown[] | undefined

const SECRETS = ['tok-secret-1', 'refresh-secret-2', 'client-secret-3']

beforeEach(() => {
  vi.restoreAllMocks()
  query.mockReset().mockResolvedValue({ rows: [] })
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret'
  delete process.env.PINTEREST_APP_ID
  delete process.env.PINTEREST_APP_SECRET
})

describe('manual credentials', () => {
  it('checks the target, then saves the token set encrypted with the own app in extra', async () => {
    vi.spyOn(providerFor('pinterest').oauth!, 'listTargets').mockResolvedValue([{ id: 'b1', name: 'Tools' }])
    const res = await manual('pinterest', {
      accessToken: SECRETS[0],
      refreshToken: SECRETS[1],
      clientId: 'my-app',
      clientSecret: SECRETS[2],
      targetId: 'b1',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, target: { id: 'b1', name: 'Tools' } })
    const args = insertArgs()!
    expect(args.slice(0, 4)).toEqual(['t-acme', 'pinterest', 'b1', 'Tools'])
    expect(args[6]).toBe('connected')
    const enc = String(args[4])
    for (const s of SECRETS) expect(enc).not.toContain(s)
    expect(decode(enc)).toMatchObject({
      accessToken: SECRETS[0],
      refreshToken: SECRETS[1],
      extra: { via: 'manual', clientId: 'my-app', clientSecret: SECRETS[2] },
    })
    // Own app, so a refresh is possible: the token is renewed within the hour.
    expect(Date.parse(String(args[5]))).toBeGreaterThan(Date.now())
  })

  it('keys the flagship to the platform tenant', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    vi.spyOn(providerFor('x').oauth!, 'listTargets').mockResolvedValue([{ id: '42', name: '@jeffi' }])
    expect((await manual('x', { accessToken: 'a', targetId: '42' })).status).toBe(200)
    expect(insertArgs()![0]).toBe('platform')
  })

  it('needs the client id and secret together', async () => {
    const res = await manual('linkedin', { accessToken: 'a', targetId: 'urn:li:organization:1', clientId: 'only-id' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/both/)
    expect(query).not.toHaveBeenCalled()
  })

  it('requires the access token and the target id', async () => {
    expect((await manual('gbp', { targetId: 'accounts/1/locations/2' })).status).toBe(400)
    expect((await manual('gbp', { accessToken: 'a' })).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('saves with a warning when listing fails, with the Business Profile quota hint', async () => {
    vi.spyOn(providerFor('gbp').oauth!, 'listTargets').mockRejectedValue(
      new Error("Google Business Profile: Quota exceeded for quota metric 'Requests'")
    )
    const res = await manual('gbp', { accessToken: SECRETS[0], targetId: 'accounts/1/locations/2', targetName: 'Jeffi' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warning).toMatch(/Quota exceeded/)
    expect(body.warning).toMatch(/developers.google.com\/my-business\/content\/prereqs/)
    expect(JSON.stringify(body)).not.toContain(SECRETS[0])
    expect(insertArgs()!.slice(2, 4)).toEqual(['accounts/1/locations/2', 'Jeffi'])
    expect(insertArgs()![6]).toBe('connected')
  })

  it('rejects a target the token cannot reach when listing works', async () => {
    vi.spyOn(providerFor('youtube').oauth!, 'listTargets').mockResolvedValue([{ id: 'UC1', name: 'Jeffi' }])
    const res = await manual('youtube', { accessToken: 'a', targetId: 'UC9' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/UC9 is not reachable.*Jeffi \(UC1\)/)
    expect(query).not.toHaveBeenCalled()
  })

  it('warns that a refresh token without any app cannot be used, and sets no expiry', async () => {
    vi.spyOn(providerFor('pinterest').oauth!, 'listTargets').mockResolvedValue([{ id: 'b1', name: 'Tools' }])
    const body = await (await manual('pinterest', { accessToken: 'a', refreshToken: 'r', targetId: 'b1' })).json()
    expect(body.warning).toMatch(/cannot be refreshed/)
    expect(insertArgs()![5]).toBeNull()
  })

  it('is not offered for Facebook or Instagram', async () => {
    expect((await manual('facebook', { accessToken: 'a', targetId: '1' })).status).toBe(404)
  })

  it('lists the connection as manual without any secret', async () => {
    const tokens = { accessToken: SECRETS[0], refreshToken: SECRETS[1], extra: { via: 'manual', clientId: 'my-app', clientSecret: SECRETS[2] } }
    query.mockResolvedValue({
      rows: [
        {
          provider: 'pinterest',
          page_id: 'b1',
          page_name: 'Tools',
          ig_user_id: null,
          access_token_enc: `enc:${Buffer.from(JSON.stringify(tokens)).toString('base64')}`,
          token_expiry: null,
          status: 'connected',
        },
      ],
    })
    const list = await listConnections('t-acme')
    const pin = list.find(n => n.network === 'pinterest')!
    expect(pin).toMatchObject({ status: 'connected', via: 'manual', ownApp: true, target: 'Tools' })
    const out = JSON.stringify(list)
    for (const s of [...SECRETS, 'my-app']) expect(out).not.toContain(s)
  })
})

describe('target picker', () => {
  const pending = () =>
    query.mockResolvedValue({
      rows: [{ provider: 'gbp', page_id: null, page_name: null, ig_user_id: null, access_token_enc: `enc:${Buffer.from(JSON.stringify({ accessToken: 'tok' })).toString('base64')}`, token_expiry: null, status: 'pending' }],
    })
  const pick = (body: unknown) => pickPOST(req('/api/admin/social/networks/gbp', body), ctx('gbp'))
  const update = () => query.mock.calls.find(c => String(c[0]).startsWith('UPDATE'))?.[1]

  it('shows the listing error with the quota hint', async () => {
    pending()
    vi.spyOn(providerFor('gbp').oauth!, 'listTargets').mockRejectedValue(new Error('Google Business Profile: HTTP 429'))
    const res = await pickGET(req('/api/admin/social/networks/gbp'), ctx('gbp'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/429/)
    expect(body.hint).toMatch(/not approved Business Profile API access/)
  })

  it('accepts a typed id when listing fails', async () => {
    pending()
    vi.spyOn(providerFor('gbp').oauth!, 'listTargets').mockRejectedValue(new Error('quota'))
    const res = await pick({ id: 'accounts/1/locations/2', name: 'Jeffi' })
    expect(res.status).toBe(200)
    expect(update()).toEqual(['t-acme', 'gbp', 'accounts/1/locations/2', 'Jeffi'])
  })

  it('keeps the check when listing works', async () => {
    pending()
    vi.spyOn(providerFor('gbp').oauth!, 'listTargets').mockResolvedValue([{ id: 'accounts/1/locations/2', name: 'Jeffi' }])
    expect((await pick({ id: 'accounts/9/locations/9' })).status).toBe(400)
    expect(update()).toBeUndefined()
    expect((await pick({ id: 'accounts/1/locations/2' })).status).toBe(200)
    expect(update()).toEqual(['t-acme', 'gbp', 'accounts/1/locations/2', 'Jeffi'])
  })
})
