import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn() } }))

import { db } from '../src/db'
import { tenantSender, invalidateTenantSenders, SenderError } from '../src/providers/senders'
import { encryptToken } from '../src/cipher'

const KEY = 'a'.repeat(64)

describe('tenantSender', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset()
    invalidateTenantSenders()
    process.env.SOCIAL_TOKEN_ENC_KEY = KEY
  })
  afterEach(() => delete process.env.SOCIAL_TOKEN_ENC_KEY)

  const row = (audience: string, sender: string, provider = 'twilio', config: any = { account_sid: 'ACx' }) =>
    ({ audience, provider, sender, config_enc: encryptToken(JSON.stringify(config)) })

  it('returns null for an empty tenant id without querying', async () => {
    expect(await tenantSender('', 'sms')).toBeNull()
    expect(db.query).not.toHaveBeenCalled()
  })

  it('decrypts the matching row and classifies its audience', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [row('admin', '+15550000002')] } as any)
    const s = await tenantSender('t1', 'whatsapp', 'admin')
    expect(s).toMatchObject({ tenantId: 't1', channel: 'whatsapp', provider: 'twilio', sender: '+15550000002', audience: 'admin' })
    expect(s!.config).toEqual({ account_sid: 'ACx' })
  })

  it('caches within the TTL — a second call does not hit the DB', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [row('customer', '+1')] } as any)
    await tenantSender('t2', 'sms')
    await tenantSender('t2', 'sms')
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('invalidateTenantSenders(tenant) drops just that tenant; no arg clears all', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [row('customer', '+1')] } as any)
    await tenantSender('t3', 'sms')
    invalidateTenantSenders('t3')
    await tenantSender('t3', 'sms')
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('returns null (uncached) when the lookup fails or the row is absent', async () => {
    vi.mocked(db.query).mockRejectedValueOnce(new Error('no table'))
    expect(await tenantSender('t4', 'sms')).toBeNull()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    expect(await tenantSender('t5', 'sms')).toBeNull()
  })

  it('ignores an unknown provider row', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ ...row('customer', '+1'), provider: 'sendgrid' }] } as any)
    expect(await tenantSender('t6', 'sms')).toBeNull()
  })

  it('throws SenderError when the credentials cannot be decrypted (rather than using another number)', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ audience: 'customer', provider: 'twilio', sender: '+1', config_enc: 'garbage' }] } as any)
    await expect(tenantSender('t7', 'sms')).rejects.toBeInstanceOf(SenderError)
  })
})
