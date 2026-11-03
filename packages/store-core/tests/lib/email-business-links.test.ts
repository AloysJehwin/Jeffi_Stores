import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate: vi.fn() }))
vi.mock('@/lib/email/shared', () => ({ getAdminNotificationEmails: vi.fn(async () => 'owner@acme.example') }))
vi.mock('@/lib/catalog/brand', () => ({
  businessBaseUrlAsync: vi.fn(async () => 'https://acme.business.jeffistores.in'),
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin-acme.jeffistores.in'),
}))

import { sendByTemplate } from '@/lib/shared/send-by-template'
import { sendBusinessAccountApprovedEmail, sendRfqConvertedToQuotationEmail, sendRfqSubmittedEmail } from '@/lib/shared/email-business'

const mail = vi.mocked(sendByTemplate)

describe('business email links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mail.mockResolvedValue({ id: 'm', status: 'sent' })
  })

  it("links the RFQ's own page for the buyer and in admin, and tells this store's admins", async () => {
    await sendRfqSubmittedEmail('buyer@x.example', 'Asha', 'RFQ-9', 'rfq-uuid-9')
    const buyer = mail.mock.calls.find(c => c[0].to === 'buyer@x.example')![0]
    const admin = mail.mock.calls.find(c => c[0].to !== 'buyer@x.example')![0]
    expect(buyer.variables?.rfq_url).toBe('https://acme.business.jeffistores.in/quotes/rfq-uuid-9')
    expect(admin.to).toBe('owner@acme.example')
    expect(admin.variables?.rfq_url).toBe('https://admin-acme.jeffistores.in/business/rfqs/rfq-uuid-9')
  })

  it("sends a newly approved account to its own store's portal sign-in", async () => {
    await sendBusinessAccountApprovedEmail('buyer@x.example', 'Asha', 'Asha Traders')
    expect(mail.mock.calls[0][0].variables?.signin_url).toBe('https://acme.business.jeffistores.in/signin')
  })

  it("hands the buyer the quotation link it was given, nothing else", async () => {
    await sendRfqConvertedToQuotationEmail('b@x.example', 'Asha', 'RFQ-9', 'Q-1', 1000, 'https://quotation-acme.jeffistores.in/t')
    const { variables } = mail.mock.calls[0][0]
    expect(variables?.quotation_url).toBe('https://quotation-acme.jeffistores.in/t')
    expect(JSON.stringify(variables)).not.toContain('96853')
  })
})
