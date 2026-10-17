import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(), resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))
const sa = vi.hoisted(() => ({ load: () => ({ client_email: 'sa@jeffi.iam.gserviceaccount.com', private_key: 'pk' }) as any }))
vi.mock('@/lib/shared/google-credentials', () => ({ loadGoogleServiceAccount: () => sa.load() }))

import { resolveGoogleAdsCreds, saveAdsConfig, googleAdsEnvStatus, adsTenantKey } from '@/lib/google-ads/credentials'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const row = (cfg: object) => ({ status: 'connected', config_enc: `enc:${JSON.stringify(cfg)}`, meta: {} }) as any

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.GOOGLE_ADS_CUSTOMER_ID
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  delete process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN
  vi.mocked(getIntegrationCredential).mockResolvedValue(null)
})

describe('adsTenantKey', () => {
  it('uses the tenant, else the platform sentinel', async () => {
    vi.mocked(resolveTenantId).mockResolvedValueOnce('t1')
    expect(await adsTenantKey()).toBe('t1')
    vi.mocked(resolveTenantId).mockResolvedValueOnce(null)
    expect(await adsTenantKey()).toBe(PLATFORM)
  })
})

describe('resolveGoogleAdsCreds', () => {
  it('reads a tenant connection', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(
      row({ connected_via: 'oauth', oauth_refresh_token: 'rt', customer_id: '1234567890', login_customer_id: '5554443333' })
    )
    expect(await resolveGoogleAdsCreds('t1')).toEqual({
      refreshToken: 'rt',
      customerId: '1234567890',
      loginCustomerId: '5554443333',
      connectedVia: 'oauth',
    })
  })

  it('never falls back to the platform account for a tenant', async () => {
    process.env.GOOGLE_ADS_CUSTOMER_ID = '1112223333'
    await expect(resolveGoogleAdsCreds('t1')).rejects.toBeInstanceOf(IntegrationNotConnectedError)
  })

  it('treats a sign-in with no account picked as not connected', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(row({ connected_via: 'oauth', oauth_refresh_token: 'rt' }))
    await expect(resolveGoogleAdsCreds('t1')).rejects.toBeInstanceOf(IntegrationNotConnectedError)
  })

  it('uses the platform service account on the flagship when nothing is stored', async () => {
    process.env.GOOGLE_ADS_CUSTOMER_ID = '111-222-3333'
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '555-444-3333'
    expect(await resolveGoogleAdsCreds(PLATFORM)).toEqual({
      serviceAccount: { clientEmail: 'sa@jeffi.iam.gserviceaccount.com', privateKey: 'pk' },
      customerId: '1112223333',
      loginCustomerId: '5554443333',
      connectedVia: 'platform',
    })
  })

  it('treats the flagship as not connected when this environment has no service-account key', async () => {
    process.env.GOOGLE_ADS_CUSTOMER_ID = '1112223333'
    const real = sa.load
    sa.load = () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open 'jeffi-stores-76e9ecaecdd6.json'"), { code: 'ENOENT' })
    }
    try {
      await expect(resolveGoogleAdsCreds(PLATFORM)).rejects.toBeInstanceOf(IntegrationNotConnectedError)
    } finally {
      sa.load = real
    }
  })

  it('prefers a stored flagship connection over the platform account', async () => {
    process.env.GOOGLE_ADS_CUSTOMER_ID = '1112223333'
    vi.mocked(getIntegrationCredential).mockResolvedValue(row({ connected_via: 'manual', oauth_refresh_token: 'rt', customer_id: '1234567890' }))
    expect((await resolveGoogleAdsCreds(PLATFORM)).connectedVia).toBe('manual')
  })

  it('uses the Jeffi manager token for managed accounts', async () => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '5554443333'
    process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN = 'mgr-rt'
    vi.mocked(getIntegrationCredential).mockResolvedValue(row({ connected_via: 'manager', customer_id: '1234567890' }))
    expect(await resolveGoogleAdsCreds('t1')).toEqual({
      refreshToken: 'mgr-rt',
      customerId: '1234567890',
      loginCustomerId: '5554443333',
      connectedVia: 'manager',
    })
  })
})

describe('saveAdsConfig', () => {
  it('stores its own google_ads row with digits-only ids and no secret in meta', async () => {
    await saveAdsConfig('t1', { connected_via: 'oauth', oauth_refresh_token: 'rt', customer_id: '123-456-7890', login_customer_id: '123-456-7890' })
    const c = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(c.provider).toBe('google_ads')
    expect(JSON.parse(c.configEnc.replace(/^enc:/, ''))).toEqual({ connected_via: 'oauth', oauth_refresh_token: 'rt', customer_id: '1234567890' })
    expect(JSON.stringify(c.meta)).not.toContain('rt"')
    expect(c.meta).toMatchObject({ customer_id: '1234567890', login_customer_id: null, needs_customer: false })
  })
})

describe('googleAdsEnvStatus', () => {
  it('lists what is missing', () => {
    expect(googleAdsEnvStatus({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' })).toMatchObject({
      developerToken: false,
      oauthClient: true,
      ready: false,
      missing: ['GOOGLE_ADS_DEVELOPER_TOKEN'],
      managerId: null,
    })
  })
})
