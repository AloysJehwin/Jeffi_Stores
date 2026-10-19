import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the messages table + mocked wallet/providers.
const rows = new Map<string, any>()
vi.mock('../src/db.js', () => ({
  db: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO messages')) {
        const [id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, reference, metadata] = params
        rows.set(id, { id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, charged_inr: 0, status: 'queued', provider: null, provider_ref: null, error: null, reference, metadata, created_at: new Date(), updated_at: new Date() })
      } else if (sql.startsWith('UPDATE messages SET status=\'sent\'')) {
        Object.assign(rows.get(params[0]), { status: 'sent', provider: params[1], provider_ref: params[2], charged_inr: params[3] })
      } else if (sql.startsWith('UPDATE messages SET status=')) {
        Object.assign(rows.get(params[0]), { status: sql.includes("'skipped'") ? 'skipped' : 'failed', error: params[1], charged_inr: 0 })
      }
      return { rows: [], rowCount: 1 }
    }),
  },
  q: vi.fn(async () => []),
  one: vi.fn(async (sql: string, params: any[]) => (sql.startsWith('SELECT * FROM messages') ? rows.get(params[0]) : undefined)),
}))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn().mockResolvedValue({ pools: {} }) }))
vi.mock('../src/templates-v2.js', () => ({ findBySlugWithDefaults: vi.fn().mockResolvedValue(null), PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('../src/providers/email.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../src/providers/twilio.js', () => ({ sendSms: vi.fn(), sendWhatsApp: vi.fn() }))

import { sendMessage, SendError } from '../src/send'
import { findBySlugWithDefaults } from '../src/templates-v2'
import * as wallet from '@jeffi/wallet'
import { sendEmail } from '../src/providers/email'
import { sendSms } from '../src/providers/twilio'

// Shaped like FullTemplate — the subset resolveTemplate reads.
const v2 = (subject: string | null, body: string, provider_ref: string | null = null) => ({
  family: { tenant_id: 't1' },
  template: { id: 'tpl1' },
  variant: { id: 'v1', provider_ref, meta_category: null },
  version: { subject, body, blocks: null, layout: 'store' as const },
})

const ctx = { tenantId: 't1', tenantSlug: 'acme', apiKeyId: 'k1' }

describe('sendMessage', () => {
  beforeEach(() => {
    rows.clear()
    vi.mocked(wallet.debit).mockReset().mockResolvedValue({ ok: true, charged: true, balance: 100 } as any)
    vi.mocked(wallet.trueUp).mockReset()
    vi.mocked(sendEmail).mockReset().mockResolvedValue('ses-1')
    vi.mocked(sendSms).mockReset().mockResolvedValue('SM1')
    vi.mocked(findBySlugWithDefaults).mockReset().mockResolvedValue(null)
  })

  it('renders a template, debits the wallet at public price and sends', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(v2('Hi {{name}}', '<p>Code {{code}}</p>') as any)
    const m = await sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'system/otp', variables: { name: 'Ann', code: '1234' } } as any)
    expect(m.status).toBe('sent')
    expect(m.subject).toBe('Hi Ann')
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: 'a@b.com', subject: 'Hi Ann', from: 'acme@jeffistores.in' })
    const debit = vi.mocked(wallet.debit).mock.calls[0][0]
    expect(debit).toMatchObject({ tenantId: 't1', category: 'email', externalRef: `pub:${m.id}` })
    expect(debit.amountInr).toBeCloseTo(0.05 * 1.4, 5)
    expect(m.charged_inr).toBeCloseTo(0.07, 5)
  })

  it('charges cost price for internal (platform) sends', async () => {
    await sendMessage({ ...ctx, internal: true }, { channel: 'sms', to: '+919999999999', body: 'hello' } as any)
    expect(vi.mocked(wallet.debit).mock.calls[0][0].amountInr).toBe(7)
  })

  it('422s when template variables are missing', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(v2('S', 'Code {{code}}') as any)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'x' } as any)).rejects.toMatchObject({ status: 422, code: 'missing_variables' })
  })

  it('404s on an unknown template, 422 on email without subject', async () => {
    vi.mocked(findBySlugWithDefaults).mockResolvedValue(null)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', template: 'nope' } as any)).rejects.toBeInstanceOf(SendError)
    await expect(sendMessage(ctx, { channel: 'email', to: 'a@b.com', body: 'x' } as any)).rejects.toMatchObject({ code: 'subject_required' })
  })

  it('402s and marks the row skipped when the wallet is short', async () => {
    vi.mocked(wallet.debit).mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 1, needed: 6 } as any)
    await expect(sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'x' } as any)).rejects.toMatchObject({ status: 402, code: 'insufficient_balance' })
    expect([...rows.values()][0].status).toBe('skipped')
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('refunds (keeping the P2 processing fee) and marks failed when the provider throws', async () => {
    vi.mocked(sendSms).mockRejectedValue(new Error('twilio down'))
    const m = await sendMessage(ctx, { channel: 'sms', to: '+919999999999', body: 'x' } as any)
    expect(m.status).toBe('failed')
    expect(m.error).toBe('twilio down')
    expect(vi.mocked(wallet.trueUp).mock.calls[0][0]).toMatchObject({ tenantId: 't1', amountInr: 0.5, externalRef: `pub:${m.id}` })
  })
})
