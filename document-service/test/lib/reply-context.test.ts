import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ REPLY_MAIL_DOMAIN: 'reply.jeffistores.in' }))

vi.mock('@jeffi/tenancy', () => ({
  currentTenant: vi.fn(),
  PLATFORM_TENANT_ID: 'platform',
  query: vi.fn(),
  queryOne: vi.fn(),
}))

import { quotationReply, invoiceReply, recordEmailSend } from '../../src/lib/reply-context.js'
import { currentTenant, query, queryOne } from '@jeffi/tenancy'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(currentTenant).mockReturnValue(null as any)
})

describe('quotationReply', () => {
  it('returns null when no consignee_email', async () => {
    expect(await quotationReply({ id: 'q1', consignee_email: null })).toBeNull()
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('opens a reply context (update path) and builds platform replyTo', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as any) // user lookup
      .mockResolvedValueOnce({ id: 'ctx1', token: 'tok123' } as any) // UPDATE path hit
    const r = await quotationReply({ id: 'q1', consignee_email: 'A@B.com', consignee_phone: '+91 98765-43210' })
    expect(r).toEqual({ contextId: 'ctx1', replyTo: 'reply+tok123@reply.jeffistores.in' })
    // email lowercased in the user lookup args
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['q1', 'A@B.com'])
  })

  it('prefixes replyTo with store slug for a non-platform tenant', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', tenantId: 'tnt-1' } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as any)
      .mockResolvedValueOnce({ id: 'ctx1', token: 'tok123' } as any)
    const r = await quotationReply({ id: 'q1', consignee_email: 'a@b.com' })
    expect(r?.replyTo).toBe('reply+acme.tok123@reply.jeffistores.in')
  })

  it('no slug prefix for the platform tenant', async () => {
    vi.mocked(currentTenant).mockReturnValue({ slug: 'acme', tenantId: 'platform' } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as any)
      .mockResolvedValueOnce({ id: 'ctx1', token: 'tok123' } as any)
    const r = await quotationReply({ id: 'q1', consignee_email: 'a@b.com' })
    expect(r?.replyTo).toBe('reply+tok123@reply.jeffistores.in')
  })

  it('falls through to INSERT path when UPDATE returns null', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any) // user lookup (catch returns null)
      .mockResolvedValueOnce(null as any) // UPDATE: no open context
      .mockResolvedValueOnce({ id: 'ctx2', token: 'ins456' } as any) // INSERT RETURNING
    const r = await quotationReply({ id: 'q1', consignee_email: 'a@b.com' })
    expect(r).toEqual({ contextId: 'ctx2', replyTo: 'reply+ins456@reply.jeffistores.in' })
  })

  it('returns null when both update and insert yield nothing', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any) // user lookup
      .mockResolvedValueOnce(null as any) // UPDATE
      .mockResolvedValueOnce(null as any) // INSERT
    expect(await quotationReply({ id: 'q1', consignee_email: 'a@b.com' })).toBeNull()
  })

  it('returns null when openReplyContext throws (catch branch)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as any) // user lookup ok
      .mockRejectedValueOnce(new Error('db down')) // UPDATE throws
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await quotationReply({ id: 'q1', consignee_email: 'a@b.com' })).toBeNull()
    spy.mockRestore()
  })
})

describe('invoiceReply', () => {
  it('returns null when no email found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any) // order lookup
    expect(await invoiceReply('ord-1')).toBeNull()
  })

  it('opens an invoice_payment reply context when email present', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ user_id: 'u1', email: 'Cust@Mail.com', phone: '9876543210' } as any)
      .mockResolvedValueOnce({ id: 'ctx9', token: 'invtok' } as any) // UPDATE hit
    const r = await invoiceReply('ord-1')
    expect(r).toEqual({ contextId: 'ctx9', replyTo: 'reply+invtok@reply.jeffistores.in' })
  })
})

describe('recordEmailSend', () => {
  it('no-op when providerRef falsy', async () => {
    await recordEmailSend('ctx1', null)
    await recordEmailSend('ctx1', undefined)
    await recordEmailSend('ctx1', '')
    expect(query).not.toHaveBeenCalled()
  })

  it('appends amazonses domain when no @, stripping only a leading angle bracket', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    // domain is appended before the <>-strip, so the trailing > survives the suffix join
    await recordEmailSend('ctx1', '<ABC123>')
    const args = vi.mocked(query).mock.calls[0][1] as any[]
    expect(args).toEqual(['ctx1', 'abc123>@email.amazonses.com'])
  })

  it('strips both brackets and keeps the id when it already contains @', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    await recordEmailSend('ctx1', '<Msg@Example.com>')
    const args = vi.mocked(query).mock.calls[0][1] as any[]
    expect(args).toEqual(['ctx1', 'msg@example.com'])
  })
})
