import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn() } }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))

import { db } from '../src/db'
import { poolsForTenant } from '../src/pools'
import { messagingProvider } from '../src/providers/policy'

const store = (settings: Record<string, string>) => {
  const pool = { query: vi.fn(async () => ({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) })) }
  vi.mocked(poolsForTenant).mockResolvedValue({ pool, pools: { tenant: pool, platform: db } } as any)
}

describe('messagingProvider', () => {
  it('takes the tenant row over the platform default, then the store Site Controls choice', async () => {
    const settings = [
      { tenant_id: null, key: 'sms_provider', value: 'aws' },
      { tenant_id: 'a1', key: 'sms_provider', value: 'twilio' },
    ]
    vi.mocked(db.query).mockImplementation((async (_sql: string, [tid]: string[]) =>
      ({ rows: settings.filter(r => !r.tenant_id || r.tenant_id === tid) })) as any)
    store({ feature_whatsapp_provider: 'aws' })
    expect(await messagingProvider('a1', 'sms')).toBe('twilio')
    expect(await messagingProvider('a1', 'whatsapp')).toBe('aws')
    expect(await messagingProvider('a2', 'sms')).toBe('aws')
  })

  it('falls back to Twilio when nothing is set or the lookup fails', async () => {
    vi.mocked(db.query).mockRejectedValue(new Error('control plane down'))
    vi.mocked(poolsForTenant).mockRejectedValue(new Error('no tenant'))
    expect(await messagingProvider('b1', 'sms')).toBe('twilio')
    expect(await messagingProvider('b1', 'whatsapp')).toBe('twilio')
  })
})
