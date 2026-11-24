import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const query = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))

import { getSmsDltConfig, invalidateSmsDltConfig } from '@/lib/providers/sms-dlt'

const T = '11111111-1111-1111-1111-111111111111'
const rows = (r: { tenant_id: string | null; key: string; value: unknown }[]) => query.mockResolvedValue({ rows: r })

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSmsDltConfig()
  resolveTenantId.mockResolvedValue(T)
  vi.stubEnv('AWS_SMS_DLT_ENTITY_ID', '')
  vi.stubEnv('AWS_SMS_DLT_SENDER_IDS', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('getSmsDltConfig', () => {
  it('takes the store override, then the platform default, per id', async () => {
    rows([
      { tenant_id: null, key: 'sms_dlt_entity_id', value: '1201159000000000001' },
      { tenant_id: T, key: 'sms_dlt_entity_id', value: '1201159000000000002' },
      { tenant_id: null, key: 'sms_dlt_sender_ids', value: ['JEFFIS'] },
    ])
    expect(await getSmsDltConfig()).toEqual({
      entityId: '1201159000000000002',
      senderIds: ['JEFFIS'],
      source: { entityId: 'tenant', senderIds: 'platform' },
    })
    expect(query.mock.calls[0][1]).toEqual([T])
  })

  it('falls back to the env, and reads the platform default for null', async () => {
    rows([{ tenant_id: null, key: 'sms_dlt_entity_id', value: 'not-digits' }])
    vi.stubEnv('AWS_SMS_DLT_ENTITY_ID', '1201159000000000009')
    vi.stubEnv('AWS_SMS_DLT_SENDER_IDS', 'jeffis, jfshop')
    const c = await getSmsDltConfig(null)
    expect(c).toEqual({ entityId: '1201159000000000009', senderIds: ['JEFFIS', 'JFSHOP'], source: { entityId: 'env', senderIds: 'env' } })
    expect(query.mock.calls[0][1]).toEqual([null])
  })

  it('caches for 30 seconds unless fresh, and is env-only when the control plane is down', async () => {
    rows([])
    await getSmsDltConfig(null)
    await getSmsDltConfig(null)
    expect(query).toHaveBeenCalledTimes(1)
    await getSmsDltConfig(null, { fresh: true })
    expect(query).toHaveBeenCalledTimes(2)
    invalidateSmsDltConfig()
    query.mockRejectedValue(new Error('down'))
    expect(await getSmsDltConfig(null)).toEqual({ entityId: null, senderIds: [], source: { entityId: 'none', senderIds: 'none' } })
  })
})
