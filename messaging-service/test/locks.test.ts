import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn() }, q: vi.fn(), one: vi.fn() }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn().mockRejectedValue(new Error('no store')) }))
vi.mock('../src/templates-v2.js', () => ({ PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('../src/providers/email.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../src/providers/twilio.js', () => ({ sendSms: vi.fn(), sendWhatsApp: vi.fn(), normalizePhone: (s: string) => s }))
vi.mock('../src/providers/policy.js', () => ({ messagingProvider: vi.fn() }))

import { db } from '../src/db'
import { channelLocks, assertChannelOn } from '../src/send'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const row = (r: any) => vi.mocked(db.query).mockResolvedValueOnce({ rows: r ? [r] : [] } as any)
const future = new Date(Date.now() + 86_400_000)

describe('channelLocks', () => {
  it('never locks the platform tenant and does not query for it', async () => {
    expect(await channelLocks(PLATFORM)).toEqual({})
    expect(db.query).not.toHaveBeenCalled()
  })

  it('locks both channels without an add-on, and after it lapses', async () => {
    row({ messaging_addon: 'none', messaging_addon_until: null, senders: [] })
    expect(await channelLocks('t-none')).toEqual({ sms: 'addon', whatsapp: 'addon' })
    row({ messaging_addon: 'both', messaging_addon_until: new Date(Date.now() - 1000), senders: ['sms', 'whatsapp'] })
    expect(await channelLocks('t-lapsed')).toEqual({ sms: 'addon', whatsapp: 'addon' })
  })

  it('a covered channel waits for its number; an uncovered one needs the add-on', async () => {
    row({ messaging_addon: 'sms', messaging_addon_until: future, senders: [] })
    expect(await channelLocks('t-sms')).toEqual({ sms: 'number', whatsapp: 'addon' })
    row({ messaging_addon: 'both', messaging_addon_until: future, senders: ['whatsapp'] })
    expect(await channelLocks('t-both')).toEqual({ sms: 'number' })
  })

  it('is not locked when the columns are missing or the tenant row is absent', async () => {
    vi.mocked(db.query).mockRejectedValueOnce(new Error('column t.messaging_addon does not exist'))
    expect(await channelLocks('t-old')).toEqual({})
    row(null)
    expect(await channelLocks('t-ghost')).toEqual({})
  })

  it('assertChannelOn refuses a locked channel with 409 channel_locked, except email and the API space', async () => {
    row({ messaging_addon: 'whatsapp', messaging_addon_until: future, senders: [] })
    await expect(assertChannelOn('t-wa', 'sms')).rejects.toMatchObject({ status: 409, code: 'channel_locked', message: expect.stringContaining('add-on') })
    await expect(assertChannelOn('t-wa', 'whatsapp')).rejects.toMatchObject({ code: 'channel_locked', message: expect.stringContaining('number to be assigned') })
    await expect(assertChannelOn('t-wa', 'email')).resolves.toBeUndefined()
    await expect(assertChannelOn('t-wa', 'sms', 'api')).resolves.toBeUndefined()
  })
})
