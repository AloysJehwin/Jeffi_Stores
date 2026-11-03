import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every storefront send/preview route, rendered for real, must leave no registered variable token behind.
// The library checks are in packages/store-core/tests/lib/templates/no-raw-tokens.test.ts.

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStoreIdentity: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  platformBrandName: () => 'Platform',
  currentBrandName: () => 'Platform',
  currentBrandNameAsync: vi.fn(async () => 'Acme Tools'),
  storeBaseUrlAsync: vi.fn(async () => 'https://acme.jeffistores.in'),
  businessBaseUrlAsync: vi.fn(async () => 'https://acme.jeffistores.in/business'),
  campaignMailFromAsync: vi.fn(async () => '"Acme" <campaigns@acme.in>'),
  customerMailFromAsync: vi.fn(async () => '"Acme" <noreply@acme.in>'),
  storeContactLine: vi.fn(async () => ''),
  storeMailTheme: vi.fn(async () => ({})),
  storeAddressLine: vi.fn(async () => ''),
}))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn(async () => ({})) }))
vi.mock('@/lib/shared/customer-links', () => ({
  apiBaseUrl: vi.fn(async () => 'https://acme.jeffistores.in'),
  orderUrl: vi.fn(async () => 'https://acme.jeffistores.in/account/orders/o1'),
}))
vi.mock('@/lib/shared/marketing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared/marketing')>('@/lib/shared/marketing')
  return {
    ...actual,
    canSendMarketing: vi.fn(async () => ({ ok: true })),
    alreadySentForReference: vi.fn(async () => false),
    recordSent: vi.fn(async () => 'sent-1'),
    getCampaign: vi.fn(),
  }
})
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(async () => ({ adminId: 'a', role: 'admin', scopes: [] })),
}))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(() => true) }))
vi.mock('@/lib/email', async () => ({
  sendAdminContactEmail: vi.fn(async () => ({ success: true })),
  adminContactHtml: (await vi.importActual<typeof import('@/lib/email')>('@/lib/email')).adminContactHtml,
}))
vi.mock('@/lib/queries', () => ({ getCustomerById: vi.fn() }))

import { queryMany } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { sendAdminContactEmail } from '@/lib/email'
import { getCustomerById } from '@/lib/queries'
import { IDENTITY, COMPOSED, COMPOSED_SUBJECT, SUPPORT_HOURS_VAR, expectClean, jsonRequest as json } from '../../../../packages/store-core/tests/helpers/template-tokens'
import { POST as customerContact } from '@storefront/app/api/(public)/customers/[id]/contact/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoreIdentity).mockResolvedValue(IDENTITY)
  vi.mocked(queryMany).mockResolvedValue([SUPPORT_HOURS_VAR] as any)
})

describe('customer contact route', () => {
  it('customer contact', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({ email: 'asha@x.in', first_name: 'Asha', last_name: 'R' } as any)
    await customerContact(json({ subject: COMPOSED_SUBJECT, message: 'Hi {customer_first_name} — {{store_name}}' }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    const [, , subject, message] = vi.mocked(sendAdminContactEmail).mock.calls[0]
    expectClean(subject, message)
    expect(message).toBe('Hi Asha — Acme Tools')
  })
})
