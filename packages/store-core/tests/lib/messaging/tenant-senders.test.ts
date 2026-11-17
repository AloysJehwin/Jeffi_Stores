import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { getTenantSender, listTenantSenders, saveTenantSender, maskSenderConfig, invalidateTenantSenders } from '@/lib/messaging/tenant-senders'

const T = '11111111-1111-1111-1111-111111111111'

describe('tenant-senders', () => {
  beforeEach(() => {
    process.env.SOCIAL_TOKEN_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    query.mockReset()
    invalidateTenantSenders()
  })
  afterEach(() => { delete process.env.SOCIAL_TOKEN_ENC_KEY })

  it('masks secrets and keeps the last 4 of ids', () => {
    expect(maskSenderConfig({ account_sid: 'AC1234567890', auth_token: 'secret', region: 'ap-south-1' }))
      .toEqual({ account_sid_last4: '…7890', has_auth_token: true, region: 'ap-south-1' })
  })

  it('encrypts on save and round-trips through getTenantSender', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // the number isn't another store's or audience's
    query.mockResolvedValueOnce({ rows: [{ created_by: 'admin@x', created_at: new Date(), updated_at: new Date() }] })
    const saved = await saveTenantSender({ tenantId: T, channel: 'sms', provider: 'twilio', sender: ' JEFFIS ', config: { account_sid: 'AC1234567890', auth_token: 'secret', api_key_sid: '' }, createdBy: 'admin@x' })
    expect(saved).toMatchObject({ channel: 'sms', audience: 'customer', provider: 'twilio', sender: 'JEFFIS', status: 'active', meta: { account_sid_last4: '…7890', has_auth_token: true } })
    const params = query.mock.calls[1][1]
    const enc = params[6] as string
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc).not.toContain('secret')
    expect(params[7]).not.toContain('secret')

    query.mockResolvedValueOnce({ rows: [{ audience: 'customer', provider: 'twilio', sender: 'JEFFIS', config_enc: enc, meta: {} }] })
    expect(await getTenantSender(T, 'sms')).toMatchObject({ channel: 'sms', audience: 'customer', provider: 'twilio', sender: 'JEFFIS', config: { account_sid: 'AC1234567890', auth_token: 'secret' } })
  })

  it('refuses a number already serving another store or audience', async () => {
    query.mockResolvedValueOnce({ rows: [{ tenant_id: 'other', audience: 'customer' }] })
    await expect(saveTenantSender({ tenantId: T, channel: 'whatsapp', audience: 'admin', provider: 'twilio', sender: '+911234567890', config: { account_sid: 'AC1', auth_token: 't' } })).rejects.toThrow(/already assigned/)
  })

  it('keeps the ecom audience to the flagship', async () => {
    await expect(saveTenantSender({ tenantId: T, channel: 'whatsapp', audience: 'ecom', provider: 'twilio', sender: '+911234567890', config: { account_sid: 'AC1', auth_token: 't' } })).rejects.toThrow(/not available/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects incomplete credentials', async () => {
    await expect(saveTenantSender({ tenantId: T, channel: 'whatsapp', provider: 'aws', sender: '+91220', config: { region: 'ap-south-1', access_key_id: 'AK', secret_access_key: 's' } })).rejects.toThrow(/phone number id/)
    expect(query).not.toHaveBeenCalled()
  })

  it('tolerates a missing table; the flagship with no row falls back to its env', async () => {
    query.mockRejectedValue(new Error('relation "tenant_messaging_senders" does not exist'))
    expect(await getTenantSender(T, 'whatsapp')).toBeNull()
    expect(await listTenantSenders(T)).toEqual([])
    query.mockReset()
    query.mockResolvedValueOnce({ rows: [] })
    expect(await getTenantSender('00000000-0000-0000-0000-000000000000', 'sms', 'admin')).toBeNull()
  })
})
