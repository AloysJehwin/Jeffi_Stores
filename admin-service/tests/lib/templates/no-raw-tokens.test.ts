import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every admin send/preview route, rendered for real, must leave no registered variable token behind.
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

import { queryMany, queryOne } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { sendAdminContactEmail } from '@/lib/email'
import { IDENTITY, COMPOSED, COMPOSED_SUBJECT, SUPPORT_HOURS_VAR, expectClean, jsonRequest as json } from '../../../../packages/store-core/tests/helpers/template-tokens'
import { POST as mailerPreview } from '@admin/app/api/(admin)/admin/mailer/preview/route'
import { POST as orderMail } from '@admin/app/api/(admin)/admin/orders/[id]/send-customer-mail/route'
import { POST as orderMailPreview } from '@admin/app/api/(admin)/admin/orders/[id]/send-customer-mail/preview/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoreIdentity).mockResolvedValue(IDENTITY)
  vi.mocked(queryMany).mockResolvedValue([SUPPORT_HOURS_VAR] as any)
})

describe('admin routes', () => {
  const ORDER = {
    id: 'o1',
    order_number: 'ORD-9',
    status: 'processing',
    payment_status: 'paid',
    created_at: '2026-10-01',
    total_amount: '1200',
    customer_name: 'Asha R',
    customer_email: 'asha@x.in',
    u_email: 'asha@x.in',
    u_first: 'Asha',
    u_last: 'R',
  }

  it('mailer preview', async () => {
    const res = await mailerPreview(
      json({ template_key: 'custom', template_data: { htmlBody: COMPOSED }, subject: COMPOSED_SUBJECT })
    )
    const { html } = await res.json()
    expectClean(html)
    expect(html).toContain('Acme Tools')
  })

  it('order customer mail send', async () => {
    vi.mocked(queryOne).mockResolvedValue(ORDER as any)
    await orderMail(json({ subject: COMPOSED_SUBJECT + ' {order_number}', body: COMPOSED, isHtml: true }), {
      params: Promise.resolve({ id: 'o1' }),
    })
    const [, , subject, body] = vi.mocked(sendAdminContactEmail).mock.calls[0]
    expectClean(subject, body)
    expect(subject).toContain('ORD-9')
    expect(body).not.toContain('#a78bfa')
  })

  it('order customer mail preview', async () => {
    vi.mocked(queryOne).mockResolvedValue(ORDER as any)
    const res = await orderMailPreview(json({ subject: 's', body: COMPOSED }), {
      params: Promise.resolve({ id: 'o1' }),
    })
    expectClean((await res.json()).html)
  })
})
