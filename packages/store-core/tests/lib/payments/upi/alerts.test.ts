import { describe, it, expect, vi, beforeEach } from 'vitest'

const parsed = { from: { value: [{ address: 'alerts@HDFCBANK.net' }] }, subject: 'Credit', text: 'credited', messageId: '<m1>' } as any
const simpleParser = vi.fn<(...args: any[]) => any>(async () => parsed)
const authenticate = vi.fn<(...args: any[]) => any>(async () => ({ dkim: { results: [{ signingDomain: 'hdfcbank.net', status: { result: 'pass' } }] }, arc: null }))

vi.mock('mailparser', () => ({ simpleParser: (r: any) => simpleParser(r) }))
vi.mock('mailauth', () => ({ authenticate: (r: any, o: any) => authenticate(r, o) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: vi.fn(() => null) }))
vi.mock('@/lib/payments/upi/alert-parse', () => ({
  alertFingerprint: vi.fn(() => 'FP'),
  bankDomainOf: vi.fn((d: string | null) => d),
  parseBankAlert: vi.fn(() => ({ kind: 'credit', amountPaise: 5000, utr: 'U', senderVpa: 'a@ybl' })),
  parseGmailForwardingConfirmation: vi.fn(() => null),
  trustBankMail: vi.fn(() => ({ trusted: true, bankDomain: 'hdfcbank.net', via: 'dkim' })),
}))
vi.mock('@/lib/payments/upi/creds', () => ({ merchantUpiVpa: vi.fn(async () => 'SHOP@ok') }))
vi.mock('@/lib/payments/upi/intents', () => ({ platformDb: { query: vi.fn(), platform: true }, storeDb: { query: vi.fn() } }))
vi.mock('@/lib/payments/upi/settle', () => ({ matchObservation: vi.fn(async () => null) }))
vi.mock('@/lib/payments/upi/upg', () => ({ insertObservation: vi.fn(async () => ({ id: 'o1', trusted: true })) }))

import { handleUpgAlertEmail } from '@/lib/payments/upi/alerts'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { parseBankAlert, parseGmailForwardingConfirmation, trustBankMail } from '@/lib/payments/upi/alert-parse'
import { merchantUpiVpa } from '@/lib/payments/upi/creds'
import { matchObservation } from '@/lib/payments/upi/settle'
import { insertObservation } from '@/lib/payments/upi/upg'
import { platformDb, storeDb } from '@/lib/payments/upi/intents'

const input = { raw: Buffer.from('raw'), sesMessageId: 'ses1' }

beforeEach(() => {
  vi.clearAllMocks()
  simpleParser.mockResolvedValue(parsed)
  authenticate.mockResolvedValue({ dkim: { results: [{ signingDomain: 'hdfcbank.net', status: { result: 'pass' } }] }, arc: null } as any)
  vi.mocked(getCurrentTenant).mockReturnValue(null)
  vi.mocked(parseGmailForwardingConfirmation).mockReturnValue(null)
  vi.mocked(parseBankAlert).mockReturnValue({ kind: 'credit', amountPaise: 5000, utr: 'U', senderVpa: 'a@ybl' } as any)
  vi.mocked(trustBankMail).mockReturnValue({ trusted: true, bankDomain: 'hdfcbank.net', via: 'dkim' } as any)
  vi.mocked(merchantUpiVpa).mockResolvedValue('SHOP@ok')
  vi.mocked(insertObservation).mockResolvedValue({ id: 'o1', trusted: true } as any)
  vi.mocked(matchObservation).mockResolvedValue(null)
})

describe('handleUpgAlertEmail', () => {
  it('records a Gmail forwarding confirmation and returns early', async () => {
    vi.mocked(parseGmailForwardingConfirmation).mockReturnValue({ code: 'C', link: null } as any)
    expect(await handleUpgAlertEmail(input)).toBe('gmail_confirmation')
    const [obs, db] = vi.mocked(insertObservation).mock.calls[0]
    expect(obs).toMatchObject({ kind: 'gmail_forwarding', fingerprint: 'gmail:ses1', trusted: false })
    expect(db).toBe(platformDb) // no tenant → platform db
    expect(parseBankAlert).not.toHaveBeenCalled()
  })

  it('ignores a non-credit alert', async () => {
    vi.mocked(parseBankAlert).mockReturnValue({ kind: 'ignored', amountPaise: null } as any)
    expect(await handleUpgAlertEmail(input)).toBe('ignored')
    expect(insertObservation).not.toHaveBeenCalled()
  })

  it('ignores when the merchant has no UPI id', async () => {
    vi.mocked(merchantUpiVpa).mockResolvedValue(null)
    expect(await handleUpgAlertEmail(input)).toBe('ignored')
  })

  it('duplicate when insertObservation returns null', async () => {
    vi.mocked(insertObservation).mockResolvedValue(null)
    expect(await handleUpgAlertEmail(input)).toBe('duplicate')
  })

  it('untrusted when the observation is not trusted', async () => {
    vi.mocked(insertObservation).mockResolvedValue({ id: 'o1', trusted: false } as any)
    expect(await handleUpgAlertEmail(input)).toBe('untrusted')
    expect(matchObservation).not.toHaveBeenCalled()
  })

  it('observed when a trusted credit does not match an intent', async () => {
    vi.mocked(matchObservation).mockResolvedValue(null)
    expect(await handleUpgAlertEmail(input)).toBe('observed')
    // lowercased vpa recorded on the observation
    expect(vi.mocked(insertObservation).mock.calls[0][0]).toMatchObject({ receivingVpa: 'shop@ok', trusted: true })
  })

  it('matched when it completes an intent; uses the store db + store ctx', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ tenantId: 'T1', slug: 'acme' } as any)
    vi.mocked(matchObservation).mockResolvedValue({ id: 'i1', status: 'completed' } as any)
    expect(await handleUpgAlertEmail(input)).toBe('matched')
    const [, matchCtx] = vi.mocked(matchObservation).mock.calls[0]
    expect((matchCtx as any).store).toEqual({ tenantId: 'T1', slug: 'acme' })
    expect((matchCtx as any).db).toBe(storeDb)
  })

  it('still records when the DKIM auth check throws (left untrusted path)', async () => {
    authenticate.mockRejectedValueOnce(new Error('dns'))
    vi.mocked(trustBankMail).mockReturnValue({ trusted: false, bankDomain: null, via: null } as any)
    vi.mocked(insertObservation).mockResolvedValue({ id: 'o1', trusted: false } as any)
    expect(await handleUpgAlertEmail(input)).toBe('untrusted')
    // authFacts caught the error and passed empty dkim/arc to trustBankMail
    expect(trustBankMail).toHaveBeenCalledWith(expect.objectContaining({ dkim: [], arc: null }))
  })

  it('parses ARC facts when present', async () => {
    authenticate.mockResolvedValueOnce({
      dkim: { results: [] },
      arc: { status: { result: 'pass' }, signature: { signingDomain: 'arc.google' }, authenticationResults: { dkim: [{ header: { d: 'hdfc.net' }, result: 'pass' }] } },
    } as any)
    await handleUpgAlertEmail(input)
    const facts = vi.mocked(trustBankMail).mock.calls[0][0]
    expect(facts.arc).toMatchObject({ result: 'pass', sealDomain: 'arc.google' })
    expect(facts.arc!.dkim[0]).toEqual({ domain: 'hdfc.net', result: 'pass' })
  })
})
