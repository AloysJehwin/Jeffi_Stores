import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))
vi.mock('@/lib/email/shared', () => ({ getAdminNotificationEmails: vi.fn(async () => 'owner@acme.example') }))
vi.mock('@/lib/catalog/brand', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/catalog/brand')>()),
  businessBaseUrlAsync: vi.fn(async () => 'https://acme.business.jeffistores.in'),
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin-acme.jeffistores.in'),
  customerMailFromAsync: vi.fn(async () => '"Acme" <noreply@acme.example>'),
  currentBrandNameAsync: vi.fn(async () => 'Acme'),
  storeContactLine: vi.fn(async () => ''),
}))

import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { sendBusinessAccountApprovedEmail, sendRfqConvertedToQuotationEmail, sendRfqSubmittedEmail } from '@/lib/shared/email-business'

const mail = vi.mocked(sendAuditedMail)

describe('business email links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mail.mockResolvedValue({ messageId: 'm' } as any)
  })

  it("links the RFQ's own page for the buyer and in admin, and tells this store's admins", async () => {
    await sendRfqSubmittedEmail('buyer@x.example', 'Asha', 'RFQ-9', 'rfq-uuid-9')
    const buyer = mail.mock.calls.find(c => c[0].to === 'buyer@x.example')![0]
    const admin = mail.mock.calls.find(c => c[0].to !== 'buyer@x.example')![0]
    expect(buyer.html).toContain('href="https://acme.business.jeffistores.in/quotes/rfq-uuid-9"')
    expect(buyer.html).not.toContain('/rfqs"')
    expect(admin.to).toBe('owner@acme.example')
    expect(admin.html).toContain('href="https://admin-acme.jeffistores.in/business/rfqs/rfq-uuid-9"')
    expect(admin.html).not.toContain('admin.jeffistores.in/admin')
  })

  it("sends a newly approved account to its own store's portal sign-in", async () => {
    await sendBusinessAccountApprovedEmail('buyer@x.example', 'Asha', 'Asha Traders')
    expect(mail.mock.calls[0][0].html).toContain('href="https://acme.business.jeffistores.in/signin"')
  })

  it("doesn't hand a tenant's buyer the platform's phone number", async () => {
    await sendRfqConvertedToQuotationEmail('b@x.example', 'Asha', 'RFQ-9', 'Q-1', 1000, 'https://quotation-acme.jeffistores.in/t')
    expect(mail.mock.calls[0][0].html).not.toContain('96853')
  })
})
