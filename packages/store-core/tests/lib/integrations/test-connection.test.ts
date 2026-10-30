import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/integrations/resolve', () => ({ resolveGoogleMerchantCreds: vi.fn(), resolveAmazonCreds: vi.fn() }))
vi.mock('@/lib/merchant/client', () => ({ merchantApiRequest: vi.fn() }))
vi.mock('@/lib/amazon/client', () => ({ spApiRequest: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getTenantSocialAccounts: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ decryptToken: (s: string) => s.replace(/^enc:/, '') }))
vi.mock('@/lib/catalog/meta', () => ({ getPageInfo: vi.fn() }))

import { testGoogleMerchant, testAmazonSeller, testMeta } from '@/lib/integrations/test-connection'
import { resolveGoogleMerchantCreds, resolveAmazonCreds } from '@/lib/integrations/resolve'
import { merchantApiRequest } from '@/lib/merchant/client'
import { spApiRequest } from '@/lib/amazon/client'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'
import { getPageInfo } from '@/lib/catalog/meta'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveGoogleMerchantCreds).mockResolvedValue({ clientEmail: '', privateKey: '', merchantId: '5550001' })
  vi.mocked(resolveAmazonCreds).mockResolvedValue({
    clientId: 'c',
    clientSecret: 's',
    refreshToken: 'r',
    sellerId: 'A1',
    marketplaceId: 'A21TJRUUN4KGV',
  })
})

describe('testGoogleMerchant', () => {
  it('reads the Merchant Center account once without retries', async () => {
    vi.mocked(merchantApiRequest).mockResolvedValue({ accountName: 'Acme' })
    expect(await testGoogleMerchant()).toEqual({ ok: true, message: 'Reached Merchant Center account Acme (5550001).' })
    expect(merchantApiRequest).toHaveBeenCalledWith('GET', '/accounts/v1/accounts/5550001', { delays: [] })
  })

  it("returns Google's reason on failure", async () => {
    vi.mocked(merchantApiRequest).mockRejectedValue(new Error('HTTP 403: The caller does not have permission'))
    expect(await testGoogleMerchant()).toEqual({ ok: false, message: 'HTTP 403: The caller does not have permission' })
  })

  it('reports an unconnected tenant', async () => {
    vi.mocked(resolveGoogleMerchantCreds).mockRejectedValue(new Error("Integration 'google_merchant' is not connected"))
    expect((await testGoogleMerchant()).ok).toBe(false)
    expect(merchantApiRequest).not.toHaveBeenCalled()
  })
})

describe('testAmazonSeller', () => {
  it('checks marketplace participations', async () => {
    vi.mocked(spApiRequest).mockResolvedValue({ payload: [{ marketplace: { id: 'A21TJRUUN4KGV' } }] })
    expect(await testAmazonSeller()).toEqual({ ok: true, message: 'Reached Amazon seller A1 on A21TJRUUN4KGV.' })
    expect(spApiRequest).toHaveBeenCalledWith('GET', '/sellers/v1/marketplaceParticipations')
  })

  it('flags a seller outside the configured marketplace', async () => {
    vi.mocked(spApiRequest).mockResolvedValue({ payload: [{ marketplace: { id: 'ATVPDKIKX0DER' } }] })
    const r = await testAmazonSeller()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/does not participate in marketplace A21TJRUUN4KGV/)
  })
})

describe('testMeta', () => {
  it('reads the stored Page with its token', async () => {
    vi.mocked(getTenantSocialAccounts).mockResolvedValue([
      { provider: 'facebook', page_id: '111', access_token_enc: 'enc:ptok' },
      { provider: 'instagram', page_id: '111', ig_user_id: '222', access_token_enc: 'enc:ptok' },
    ] as any)
    vi.mocked(getPageInfo).mockResolvedValue({ pageId: '111', pageName: 'Acme', igUserId: '222' })
    expect(await testMeta('t-acme')).toEqual({ ok: true, message: 'Reached Facebook Page Acme. Instagram linked.' })
    expect(getPageInfo).toHaveBeenCalledWith('111', 'ptok')
  })

  it('reports not connected without calling Meta', async () => {
    vi.mocked(getTenantSocialAccounts).mockResolvedValue([])
    expect(await testMeta('t-acme')).toEqual({ ok: false, message: 'Meta is not connected.' })
    expect(getPageInfo).not.toHaveBeenCalled()
  })
})
