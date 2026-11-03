import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getTenantSocialAccounts: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ decryptToken: (s: string) => s }))
vi.mock('@/lib/catalog/meta', () => ({ getPageInfo: vi.fn() }))
vi.mock('@/lib/merchant/client', () => ({ merchantApiRequest: vi.fn() }))
vi.mock('@/lib/amazon/client', () => ({ spApiRequest: vi.fn() }))

import { testGoogleAds } from '@/lib/integrations/test-connection'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'

const client = (rows: any[] | Error, login: string | null = null) =>
  ({
    loginCustomerId: login,
    searchStream: vi.fn(async () => {
      if (rows instanceof Error) throw rows
      return rows
    }),
  }) as any

beforeEach(() => vi.clearAllMocks())

describe('testGoogleAds', () => {
  it('reads the customer once without retries', async () => {
    vi.mocked(googleAdsClientFor).mockResolvedValue(
      client([{ customer: { id: '1234567890', descriptiveName: 'Acme', testAccount: true } }], '5554443333')
    )
    expect(await testGoogleAds('t1')).toEqual({
      ok: true,
      message: 'Reached Google Ads account Acme 123-456-7890 (test account) through manager 555-444-3333.',
    })
    expect(googleAdsClientFor).toHaveBeenCalledWith('t1', { retryDelays: [] })
  })

  it("returns Google's explanation on failure", async () => {
    vi.mocked(googleAdsClientFor).mockResolvedValue(client(new Error('The developer token only has test access (DEVELOPER_TOKEN_NOT_APPROVED)')))
    expect(await testGoogleAds('t1')).toEqual({ ok: false, message: 'The developer token only has test access (DEVELOPER_TOKEN_NOT_APPROVED)' })
  })

  it('reports an unconnected store', async () => {
    vi.mocked(googleAdsClientFor).mockRejectedValue(new Error("Integration 'google_ads' is not connected for tenant t1"))
    expect((await testGoogleAds('t1')).ok).toBe(false)
  })
})
