import { describe, it, expect, vi, beforeEach } from 'vitest'

const PLATFORM = '00000000-0000-0000-0000-000000000000'

vi.mock('@/lib/import/jobs', () => ({ PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/tenant-registry', () => ({
  UPI_MODES: ['auto', 'off'],
  controlPlanePool: vi.fn(() => ({ query: cpQuery })),
  getTenantUpiId: vi.fn(async () => null),
}))
vi.mock('@/lib/integrations/resolve', () => ({ storedPhonePeCreds: vi.fn(async () => null) }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(async () => ({ upiEnabled: true })) }))
vi.mock('@/lib/payments/upi/phonepe', () => ({ phonePeEnv: (v: unknown) => (v === 'production' ? 'production' : 'sandbox') }))

const cpQuery = vi.fn<(...args: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] as any[] }))

import {
  envPhonePeCreds, storedPhonePeCreds, platformPhonePeCreds, platformSiteSetting, resolveUpiMode,
  invalidateUpiModeCache, merchantUpiVpa, resolveUpiProvider, resolvePhonePeCreds, platformUpiKilled,
  upiStatus, upiAvailable, walletUpiAvailable, activeUpiProvider, isPlatformMerchant,
} from '@/lib/payments/upi/creds'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantUpiId } from '@/lib/tenant-registry'
import { storedPhonePeCreds as storedBlob } from '@/lib/integrations/resolve'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

const ENV = { ...process.env }
beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.PHONEPE_CLIENT_ID
  delete process.env.PHONEPE_CLIENT_SECRET
  delete process.env.ENABLE_UPI
  delete process.env.RAZORPAY_UPI_VPA
  cpQuery.mockResolvedValue({ rows: [] })
  invalidateUpiModeCache()
})

describe('isPlatformMerchant', () => {
  it('is true for null, undefined and the platform id, false for a store', () => {
    expect(isPlatformMerchant(null)).toBe(true)
    expect(isPlatformMerchant(undefined)).toBe(true)
    expect(isPlatformMerchant(PLATFORM)).toBe(true)
    expect(isPlatformMerchant('t1')).toBe(false)
  })
})

describe('envPhonePeCreds', () => {
  it('returns null when client id/secret are missing', () => {
    expect(envPhonePeCreds()).toBeNull()
    process.env.PHONEPE_CLIENT_ID = 'c'
    expect(envPhonePeCreds()).toBeNull() // secret still missing
  })
  it('maps every env var when configured', () => {
    Object.assign(process.env, {
      PHONEPE_CLIENT_ID: 'cid', PHONEPE_CLIENT_SECRET: 'sec', PHONEPE_ENV: 'production',
      PHONEPE_CLIENT_VERSION: '7', PHONEPE_MERCHANT_ID: 'M1', PHONEPE_WEBHOOK_USERNAME: 'u', PHONEPE_WEBHOOK_PASSWORD: 'p',
    })
    expect(envPhonePeCreds()).toEqual({ env: 'production', clientId: 'cid', clientSecret: 'sec', clientVersion: '7', merchantId: 'M1', webhookUsername: 'u', webhookPassword: 'p' })
  })
  it('defaults clientVersion and leaves optionals undefined', () => {
    process.env.PHONEPE_CLIENT_ID = 'cid'
    process.env.PHONEPE_CLIENT_SECRET = 'sec'
    const c = envPhonePeCreds()!
    expect(c.clientVersion).toBe('1')
    expect(c.env).toBe('sandbox')
    expect(c.merchantId).toBeUndefined()
  })
})

describe('storedPhonePeCreds', () => {
  it('returns null for an empty tenant id and when nothing is saved', async () => {
    expect(await storedPhonePeCreds('')).toBeNull()
    expect(await storedPhonePeCreds('t1')).toBeNull()
  })
  it('maps the saved blob through phonePeEnv', async () => {
    vi.mocked(storedBlob).mockResolvedValueOnce({ env: 'production', client_id: 'C', client_secret: 'S', client_version: '2', merchant_id: 'M', webhook_username: 'wu', webhook_password: 'wp' } as any)
    expect(await storedPhonePeCreds('t1')).toEqual({ env: 'production', clientId: 'C', clientSecret: 'S', clientVersion: '2', merchantId: 'M', webhookUsername: 'wu', webhookPassword: 'wp' })
  })
})

describe('platformPhonePeCreds', () => {
  it('prefers the saved platform blob, else env', async () => {
    vi.mocked(storedBlob).mockResolvedValueOnce({ env: 'sandbox', client_id: 'C' } as any)
    expect((await platformPhonePeCreds())?.clientId).toBe('C')

    vi.mocked(storedBlob).mockResolvedValue(null)
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect((await platformPhonePeCreds())?.clientId).toBe('e')
  })
  it('falls back to env when the stored lookup throws', async () => {
    vi.mocked(storedBlob).mockRejectedValueOnce(new Error('db'))
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect((await platformPhonePeCreds())?.clientId).toBe('e')
  })
})

describe('platformSiteSetting', () => {
  it('reads from the flagship pool and caches the value', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ value: 'shop@ok' }] })
    expect(await platformSiteSetting('upi_vpa')).toBe('shop@ok')
    expect(await platformSiteSetting('upi_vpa')).toBe('shop@ok') // cached, no 2nd query
    expect(cpQuery).toHaveBeenCalledTimes(1)
    expect(cpQuery.mock.calls[0][1]).toEqual(['upi_vpa'])
  })
  it('returns null when the key is absent', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [] })
    expect(await platformSiteSetting('missing')).toBeNull()
  })
})

describe('resolveUpiMode', () => {
  it('is auto for the platform', async () => {
    expect(await resolveUpiMode(PLATFORM)).toBe('auto')
    expect(await resolveUpiMode(null)).toBe('auto')
  })
  it('reads tenants.upi_mode, caches it, returns off when set off', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ upi_mode: 'off' }] })
    expect(await resolveUpiMode('t1')).toBe('off')
    expect(await resolveUpiMode('t1')).toBe('off') // cached
    expect(cpQuery).toHaveBeenCalledTimes(1)
  })
  it('is auto when the row says auto', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ upi_mode: 'auto' }] })
    expect(await resolveUpiMode('t2')).toBe('auto')
  })
  it('is auto when the control plane read throws', async () => {
    cpQuery.mockRejectedValueOnce(new Error('down'))
    expect(await resolveUpiMode('t3')).toBe('auto')
  })
  it('resolves the tenant from context when none is passed', async () => {
    vi.mocked(resolveTenantId).mockResolvedValueOnce(null)
    expect(await resolveUpiMode()).toBe('auto') // null context → platform
  })
})

describe('merchantUpiVpa', () => {
  it('platform: site setting wins, else env', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ value: '  flag@ok  ' }] })
    expect(await merchantUpiVpa(null)).toBe('flag@ok')

    invalidateUpiModeCache()
    cpQuery.mockResolvedValueOnce({ rows: [] })
    process.env.RAZORPAY_UPI_VPA = ' env@ok '
    expect(await merchantUpiVpa(PLATFORM)).toBe('env@ok')
  })
  it('platform: null when neither set and query throws', async () => {
    cpQuery.mockRejectedValueOnce(new Error('x'))
    expect(await merchantUpiVpa(null)).toBeNull()
  })
  it('store: reads the tenant UPI id, trimmed; null on throw', async () => {
    vi.mocked(getTenantUpiId).mockResolvedValueOnce(' s@ok ')
    expect(await merchantUpiVpa('t1')).toBe('s@ok')
    vi.mocked(getTenantUpiId).mockRejectedValueOnce(new Error('x'))
    expect(await merchantUpiVpa('t2')).toBeNull()
  })
})

describe('resolveUpiProvider', () => {
  it('phonepe when creds exist', async () => {
    vi.mocked(storedBlob).mockResolvedValueOnce({ env: 'sandbox', client_id: 'C' } as any)
    expect(await resolveUpiProvider('t1')).toEqual({ provider: 'phonepe', creds: expect.objectContaining({ clientId: 'C' }) })
  })
  it('upg when a UPI id is set but no creds', async () => {
    vi.mocked(getTenantUpiId).mockResolvedValueOnce('s@ok')
    expect(await resolveUpiProvider('t1')).toEqual({ provider: 'upg', vpa: 's@ok' })
  })
  it('none when neither', async () => {
    expect(await resolveUpiProvider('t1')).toEqual({ provider: 'none' })
  })
  it('platform path uses platform creds', async () => {
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect((await resolveUpiProvider(null) as any).provider).toBe('phonepe')
  })
})

describe('resolvePhonePeCreds', () => {
  it('returns creds or throws when none', async () => {
    vi.mocked(storedBlob).mockResolvedValueOnce({ env: 'sandbox', client_id: 'C' } as any)
    expect((await resolvePhonePeCreds('t1')).clientId).toBe('C')
    await expect(resolvePhonePeCreds('t2')).rejects.toThrow('PhonePe is not configured')
  })
  it('resolves the tenant from context when omitted', async () => {
    vi.mocked(resolveTenantId).mockResolvedValueOnce(null)
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect((await resolvePhonePeCreds()).clientId).toBe('e')
  })
})

describe('platformUpiKilled', () => {
  it('is true only for explicit off values', () => {
    for (const v of ['false', '0', 'off', 'no', 'OFF']) {
      process.env.ENABLE_UPI = v
      expect(platformUpiKilled()).toBe(true)
    }
    process.env.ENABLE_UPI = 'true'
    expect(platformUpiKilled()).toBe(false)
    delete process.env.ENABLE_UPI
    expect(platformUpiKilled()).toBe(false)
  })
})

describe('upiStatus / upiAvailable', () => {
  beforeEach(() => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    vi.mocked(getFeatureFlags).mockResolvedValue({ upiEnabled: true } as any)
    vi.mocked(getTenantUpiId).mockResolvedValue(null)
  })
  it('killed by the env kill switch', async () => {
    process.env.ENABLE_UPI = 'off'
    const s = await upiStatus(null)
    expect(s).toMatchObject({ killed: true, reason: expect.stringContaining('whole platform') })
  })
  it('killed when Site Controls flag is off', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ upiEnabled: false } as any)
    const s = await upiStatus(null)
    expect(s.killed).toBe(true)
    expect(s.reason).toContain('Site Controls')
  })
  it('killed when the platform set upi_mode off for the store', async () => {
    vi.mocked(getTenantUpiId).mockResolvedValue('s@ok') // so provider is upg not none
    cpQuery.mockResolvedValue({ rows: [{ upi_mode: 'off' }] })
    const s = await upiStatus('t1')
    expect(s.killed).toBe(true)
    expect(s.reason).toContain('switched UPI off')
  })
  it('not killed when everything is on; upiAvailable mirrors it', async () => {
    vi.mocked(getTenantUpiId).mockResolvedValue('s@ok')
    expect(await upiStatus('t1')).toMatchObject({ provider: 'upg', killed: false })
    expect(await upiAvailable('t1')).toBe(true)
  })
  it('upiAvailable false when provider is none', async () => {
    expect(await upiAvailable('t1')).toBe(false) // no creds, no vpa
  })
  it('tenantId undefined resolves to the current tenant', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    const s = await upiStatus()
    expect(s.provider).toBe('none')
  })
})

describe('platform flag read from flagship for a store request', () => {
  it('reads feature_upi_enabled from the flagship when the platform is asked inside a store', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue('t1') // current = store
    cpQuery.mockImplementation(async (sql: string) => {
      if (/feature_upi_enabled/.test(sql) || /site_settings/.test(sql)) return { rows: [{ value: 'true' }] }
      return { rows: [] }
    })
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    const s = await upiStatus(null) // asking about the platform from a store request
    expect(s.killed).toBe(false)
  })
  it('falls back to ENABLE_UPI env when the flagship setting is absent', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue('t1')
    cpQuery.mockResolvedValue({ rows: [] }) // no feature_upi_enabled
    process.env.ENABLE_UPI = 'true'
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect((await upiStatus(null)).killed).toBe(false)
  })
})

describe('walletUpiAvailable / activeUpiProvider', () => {
  beforeEach(() => vi.mocked(resolveTenantId).mockResolvedValue(null))
  it('wallet available follows the platform status', async () => {
    process.env.PHONEPE_CLIENT_ID = 'e'
    process.env.PHONEPE_CLIENT_SECRET = 's'
    expect(await walletUpiAvailable()).toBe(true)
  })
  it('activeUpiProvider returns the provider when live, none when killed', async () => {
    vi.mocked(getTenantUpiId).mockResolvedValue('s@ok')
    expect(await activeUpiProvider('t1')).toBe('upg')
    process.env.ENABLE_UPI = 'off'
    expect(await activeUpiProvider('t1')).toBe('none')
  })
})
