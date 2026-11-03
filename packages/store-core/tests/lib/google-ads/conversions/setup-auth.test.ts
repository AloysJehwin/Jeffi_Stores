import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), getClient: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getIntegrationCredential: vi.fn() }))
vi.mock('@/lib/google-ads/credentials', () => ({
  GOOGLE_ADS_PROVIDER: 'google_ads',
  adsTenantKey: vi.fn(async () => 't1'),
  googleAdsEnvStatus: vi.fn(() => ({ platformCustomerId: null })),
  resolveGoogleAdsCreds: vi.fn(async () => ({ refreshToken: 'rt', customerId: '1234567890', loginCustomerId: '5556667778', connectedVia: 'oauth' })),
}))

import { checkDataManagerSetup } from '@/lib/google-ads/conversions/setup'
import { conversionAuth, dataManagerAccess } from '@/lib/google-ads/conversions/auth'
import { parseDataManagerError } from '@/lib/google-ads/conversions/data-manager'
import { getIntegrationCredential } from '@/lib/tenant-registry'
import { adsTenantKey, googleAdsEnvStatus } from '@/lib/google-ads/credentials'
import type { UploadRunSummary } from '@/lib/google-ads/conversions/types'

const NOW = new Date('2026-10-16T06:00:00Z')
const ACTION = 'customers/1234567890/conversionActions/777'

const db = (row: Record<string, unknown> | null) => ({ query: vi.fn(async () => ({ rows: row ? [row] : [] })) })
const configRow = (o: Record<string, unknown> = {}) => ({
  customer_id: '1234567890',
  conversion_action: ACTION,
  conversion_action_name: 'Purchase (server)',
  conversion_action_owner: '1112223334',
  conversion_action_account: '1234567890',
  ...o,
})

beforeEach(() => vi.clearAllMocks())

describe('checkDataManagerSetup', () => {
  it('sends one made-up purchase with validateOnly to the chosen action', async () => {
    const dm = { ingestEvents: vi.fn(async () => ({ requestId: 'v', fieldWarnings: [{ field: 'f', reason: 'W', description: 'warn' }] })) } as any
    const r = await checkDataManagerSetup({ dm, db: db(configRow()), now: NOW })
    expect(r).toMatchObject({ ok: true, code: null, warnings: [{ description: 'warn' }] })
    const body = dm.ingestEvents.mock.calls[0][0]
    expect(body).toMatchObject({
      validateOnly: true,
      encoding: 'HEX',
      destinations: [
        {
          operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1112223334' },
          loginAccount: { accountType: 'GOOGLE_ADS', accountId: '5556667778' },
          productDestinationId: '777',
        },
      ],
    })
    expect(body.events).toEqual([
      {
        transactionId: `setup-check-${NOW.getTime()}`,
        eventTimestamp: '2026-10-16T05:00:00Z',
        eventSource: 'WEB',
        conversionValue: 1,
        currency: 'INR',
        adIdentifiers: { gclid: 'setup-check' },
      },
    ])
  })

  it('passes when only the made-up click is refused, fails on account or action problems', async () => {
    const eventOnly = parseDataManagerError(
      {
        error: {
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'events.events[0].ad_identifiers', reason: 'INVALID_AD_IDENTIFIER_FOR_ACCOUNT' }] }],
        },
      },
      400
    )
    const dm = { ingestEvents: vi.fn(async () => Promise.reject(eventOnly)) } as any
    expect((await checkDataManagerSetup({ dm, db: db(configRow()), now: NOW })).ok).toBe(true)

    const denied = parseDataManagerError({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }, 403)
    const dm2 = { ingestEvents: vi.fn(async () => Promise.reject(denied)) } as any
    expect(await checkDataManagerSetup({ dm: dm2, db: db(configRow()), now: NOW })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
      message: expect.stringMatching(/Standard or Admin access/),
    })
  })

  it('needs a conversion action for the connected account first', async () => {
    const dm = { ingestEvents: vi.fn() } as any
    expect(await checkDataManagerSetup({ dm, db: db(configRow({ conversion_action: null })), now: NOW })).toMatchObject({ ok: false, code: 'NO_ACTION' })
    expect(await checkDataManagerSetup({ dm, db: db(configRow({ conversion_action_account: '9999999999' })), now: NOW })).toMatchObject({ ok: false })
    expect(dm.ingestEvents).not.toHaveBeenCalled()
  })
})

describe('Data Manager access for the Conversions tab', () => {
  const run = (errorCode: string | null, finishedAt = '2026-10-16T05:00:00Z'): UploadRunSummary => ({
    status: errorCode ? 'error' : 'success',
    uploaded: 0,
    failed: 0,
    retrying: 0,
    skipped: 0,
    enqueued: 0,
    error: null,
    errorCode,
    identifiers: false,
    finishedAt,
  })

  it('reads the grant from the sign-in, older sign-ins lack it, a hand-entered token is unknown', () => {
    expect(dataManagerAccess({ data_manager: true }, 'oauth', null)).toBe('granted')
    expect(dataManagerAccess({ data_manager: false }, 'oauth', null)).toBe('missing')
    expect(dataManagerAccess({}, 'oauth', null)).toBe('missing')
    expect(dataManagerAccess({ data_manager: null }, 'manual', null)).toBe('unknown')
    expect(dataManagerAccess({}, 'manager', null)).toBe('manager')
    expect(dataManagerAccess(null, 'platform', null)).toBe('service_account')
    expect(dataManagerAccess(null, null, null)).toBe('not_connected')
  })

  it('trusts a scope error from the last run unless the sign-in is newer', () => {
    expect(dataManagerAccess({ data_manager: null }, 'manual', run('DATA_MANAGER_SCOPE_MISSING'))).toBe('missing')
    expect(dataManagerAccess({}, 'manager', run('ACCESS_TOKEN_SCOPE_INSUFFICIENT'))).toBe('missing')
    expect(dataManagerAccess({}, 'platform', run('DATA_MANAGER_SCOPE_MISSING'))).toBe('missing')
    expect(dataManagerAccess({ data_manager: true, data_manager_at: '2026-10-16T04:00:00Z' }, 'oauth', run('DATA_MANAGER_SCOPE_MISSING'))).toBe('missing')
    expect(dataManagerAccess({ data_manager: true, data_manager_at: '2026-10-16T05:30:00Z' }, 'oauth', run('DATA_MANAGER_SCOPE_MISSING'))).toBe('granted')
    expect(dataManagerAccess({ data_manager: true }, 'oauth', run('PERMISSION_DENIED'))).toBe('granted')
  })

  it('reads the connection meta without decrypting, and the flagship service account', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValueOnce({ status: 'connected', meta: { customer_id: '1', connected_via: 'oauth', data_manager: true } } as any)
    expect(await conversionAuth(null)).toEqual({ connectedVia: 'oauth', dataManager: 'granted' })
    vi.mocked(getIntegrationCredential).mockResolvedValueOnce(null as any)
    expect(await conversionAuth(null)).toEqual({ connectedVia: null, dataManager: 'not_connected' })
    vi.mocked(adsTenantKey).mockResolvedValueOnce('00000000-0000-0000-0000-000000000000')
    vi.mocked(googleAdsEnvStatus).mockReturnValueOnce({ platformCustomerId: '1234567890' } as any)
    vi.mocked(getIntegrationCredential).mockResolvedValueOnce(null as any)
    expect(await conversionAuth(null)).toEqual({ connectedVia: 'platform', dataManager: 'service_account' })
  })
})
