import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  saveIntegrationCredential: vi.fn(),
  listIntegrationCredentials: vi.fn(async () => []),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: (s: string) => `enc:${s}` }))
vi.mock('@/lib/integrations/test-connection', () => ({
  testGoogleMerchant: vi.fn(async () => ({ ok: true, message: 'Reached Merchant Center account Acme (5550001).' })),
  testAmazonSeller: vi.fn(async () => ({ ok: false, message: 'Amazon LWA auth failed: invalid_grant' })),
  testMeta: vi.fn(async () => ({ ok: true, message: 'Reached Facebook Page Acme.' })),
}))

import { POST, DELETE } from '@/app/api/(admin)/admin/integrations/route'
import { POST as TEST } from '@/app/api/(admin)/admin/integrations/test/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { testMeta, testAmazonSeller } from '@/lib/integrations/test-connection'

const req = (method: string, body: unknown, path = '/api/admin/integrations') =>
  new NextRequest(`https://admin-acme.jeffistores.in${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const SA = JSON.stringify({
  type: 'service_account',
  client_email: 'sync@acme.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
})
const AMAZON = {
  client_id: 'amzn1.application-oa2-client.abc123',
  client_secret: 'amzn1.oa2-cs.v1.secret',
  refresh_token: 'Atzr|IwEB',
  seller_id: 'A1B2C3D4E5F6G7',
}
const savedConfig = () =>
  JSON.parse(vi.mocked(saveIntegrationCredential).mock.calls[0][0].configEnc.replace(/^enc:/, ''))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't-acme' } as any)
})

describe('manual Google Merchant credentials', () => {
  it('stores the service account, merchant id and optional data source encrypted, marked manual', async () => {
    const res = await POST(
      req('POST', {
        provider: 'google_merchant',
        config: { service_account_json: SA, merchant_id: ' 5550001 ', data_source: '777' },
      })
    )
    expect(res.status).toBe(200)
    expect(savedConfig()).toEqual({
      client_email: 'sync@acme.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      merchant_id: '5550001',
      data_source: '777',
    })
    const call = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(call.tenantId).toBe('t-acme')
    expect(call.meta).toEqual({
      merchant_id: '5550001',
      client_email: 'sync@acme.iam.gserviceaccount.com',
      connected_via: 'manual',
    })
  })

  it.each([
    [{ service_account_json: SA, merchant_id: 'acme' }, /numeric/],
    [{ service_account_json: '{not json', merchant_id: '5550001' }, /Invalid service account JSON/],
    [
      { service_account_json: '{"client_email":"x@gmail.com","private_key":"k"}', merchant_id: '5550001' },
      /not a Google service account/,
    ],
    [{ service_account_json: '{}', merchant_id: '5550001' }, /client_email and private_key/],
  ])('rejects bad input %#', async (config, msg) => {
    const res = await POST(req('POST', { provider: 'google_merchant', config }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })
})

describe('manual Amazon credentials', () => {
  it('stores trimmed LWA creds with the India marketplace by default', async () => {
    const res = await POST(
      req('POST', { provider: 'amazon_seller', config: { ...AMAZON, seller_id: ' A1B2C3D4E5F6G7 ' } })
    )
    expect(res.status).toBe(200)
    expect(savedConfig()).toEqual({ ...AMAZON, marketplace_id: 'A21TJRUUN4KGV' })
    expect(vi.mocked(saveIntegrationCredential).mock.calls[0][0].meta).toMatchObject({ connected_via: 'manual' })
  })

  it.each([
    [{ ...AMAZON, client_id: 'abc' }, /amzn1\.application-oa2-client/],
    [{ ...AMAZON, refresh_token: 'xyz' }, /Atzr\|/],
    [{ ...AMAZON, seller_id: 'my store' }, /Merchant Token/],
    [{ ...AMAZON, marketplace_id: 'in' }, /Marketplace ID/],
    [{ ...AMAZON, client_secret: '' }, /client_secret is required/],
  ])('rejects bad input %#', async (config, msg) => {
    const res = await POST(req('POST', { provider: 'amazon_seller', config }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })
})

describe('disconnect and auth', () => {
  it('deletes only the current tenant credential', async () => {
    const res = await DELETE(req('DELETE', { provider: 'amazon_seller' }))
    expect(res.status).toBe(200)
    expect(deleteIntegrationCredential).toHaveBeenCalledWith('t-acme', 'amazon_seller')
  })

  it('returns the scope refusal untouched', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await POST(req('POST', { provider: 'amazon_seller', config: AMAZON }))).status).toBe(403)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/integrations/test', () => {
  it('runs the provider check and returns its result', async () => {
    const res = await TEST(req('POST', { provider: 'amazon_seller' }, '/api/admin/integrations/test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, message: 'Amazon LWA auth failed: invalid_grant' })
    expect(testAmazonSeller).toHaveBeenCalled()
  })

  it('checks Meta for the current tenant with the campaigns scope', async () => {
    await TEST(req('POST', { provider: 'meta' }, '/api/admin/integrations/test'))
    expect(testMeta).toHaveBeenCalledWith('t-acme')
    expect(vi.mocked(requireAdminScope).mock.calls[0][1]).toBe('campaigns:write')
  })

  it('400s an unknown provider, and tests the flagship like a store', async () => {
    expect((await TEST(req('POST', { provider: 'x' }, '/api/admin/integrations/test'))).status).toBe(400)
    vi.mocked(resolveTenant).mockResolvedValue(null)
    expect((await TEST(req('POST', { provider: 'meta' }, '/api/admin/integrations/test'))).status).toBe(200)
  })
})
