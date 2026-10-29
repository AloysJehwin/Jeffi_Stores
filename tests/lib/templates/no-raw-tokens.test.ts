import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Every send/preview path, rendered for real, must leave no registered variable token behind.

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
}))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn(async () => ({})) }))
vi.mock('@/lib/shared/customer-links', () => ({ apiBaseUrl: vi.fn(async () => 'https://acme.jeffistores.in') }))
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
vi.mock('@/lib/email', () => ({ sendAdminContactEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/queries', () => ({ getCustomerById: vi.fn() }))

import { query, queryMany, queryOne } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { getCampaign } from '@/lib/shared/marketing'
import { sendAdminContactEmail } from '@/lib/email'
import { getCustomerById } from '@/lib/queries'
import { BUILTIN_TEMPLATES } from '@/lib/campaigns/default-templates'
import { baseLayout, renderCampaignEmail, sendCampaign } from '@/lib/shared/email-campaigns'
import {
  renderCampaignTemplate,
  sendCampaignEmail,
  sendCampaignEmailRendered,
  sendTestCampaignEmail,
} from '@/lib/shared/automation-emails'
import { renderTemplate, resolveTemplateVariables, BUILTIN_VARIABLE_KEYS } from '@/lib/templates/variables'
import { POST as mailerPreview } from '@/app/api/(admin)/admin/mailer/preview/route'
import { POST as orderMail } from '@/app/api/(admin)/admin/orders/[id]/send-customer-mail/route'
import { POST as orderMailPreview } from '@/app/api/(admin)/admin/orders/[id]/send-customer-mail/preview/route'
import { POST as customerContact } from '@/app/api/(public)/customers/[id]/contact/route'

const IDENTITY = { name: 'Acme Tools', email: 'hi@acme.in', phone: '+91 90000 11111', web: 'acme.in', logoUrl: '', emailAccent: '' }

// Any token (either syntax, any case) whose key is registered.
function registeredLeaks(s: string | undefined): string[] {
  if (!s) return []
  const keys = [...BUILTIN_VARIABLE_KEYS, 'support_hours']
  return [...s.matchAll(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi)]
    .map(m => m[1].toLowerCase())
    .filter(k => keys.includes(k))
}
function expectClean(...parts: Array<string | undefined>) {
  for (const p of parts) expect(registeredLeaks(p)).toEqual([])
}

// What the composer can produce: both syntaxes, the old styled chip, &nbsp; padding and a custom var.
const COMPOSED =
  '<p>Hi {customer_first_name}, {{ store_name }} here.</p>' +
  '<p><span style="font-family:ui-monospace,monospace;border:1px solid #a78bfa;">{store_web}</span>&nbsp;' +
  '{{&nbsp;store_phone&nbsp;}} {Store_Email} {support_hours} {date} {current_year}</p>'
const COMPOSED_SUBJECT = '{customer_first_name}, news from {{store_name}}'

const SCENARIO_SAMPLE: Record<string, string | number> = {
  firstName: 'Asha',
  itemCount: 2,
  itemsHtml: '<table><tr><td>Item</td></tr></table>',
  productCard: '<div>Card</div>',
  productName: 'Drill',
  couponCode: 'SAVE10',
  discountPercent: 10,
  ctaUrl: 'https://acme.in/products',
  tier: 'Gold',
  points: 250,
  pointsWorth: 250,
  rewardPoints: 100,
  shareUrl: 'https://acme.in/r/X',
  orderNumber: 'ORD-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoreIdentity).mockResolvedValue(IDENTITY)
  vi.mocked(queryMany).mockResolvedValue([
    { id: 'c1', key: 'support_hours', label: 'Hours', description: '', value: '9-6', is_enabled: true },
  ] as any)
})

const lastMail = () => vi.mocked(sendAuditedMail).mock.calls.at(-1)![0]

describe('built-in campaign templates (regression)', () => {
  it.each(Object.keys(BUILTIN_TEMPLATES))('%s renders with no raw token', async kind => {
    const t = BUILTIN_TEMPLATES[kind]
    const registered = await resolveTemplateVariables({ recipient: { email: 'a@b.in', first_name: 'Asha' } })
    const subject = renderCampaignTemplate(t.subject, SCENARIO_SAMPLE, registered, false)
    const body = renderCampaignTemplate(t.body, SCENARIO_SAMPLE, registered, true)
    const html = renderTemplate(baseLayout(subject, body, 'https://acme.in'), registered, { escape: true })
    expectClean(subject, html)
    // Scenario tokens collapse too: nothing token-shaped is left in subject or body.
    expect(subject).not.toMatch(/\{\{?\s*\w+\s*\}?\}/)
    expect(body).not.toMatch(/\{\{?\s*\w+\s*\}?\}/)
    expect(html).toContain('Acme Tools')
  })

  const DATA: Record<string, Record<string, string>> = {
    review_request: {
      firstName: 'Asha',
      itemsJson: JSON.stringify([{ name: 'Drill', imageUrl: null, starLinks: ['https://x?token=t&rating=5'] }]),
    },
    review_form_share: { formUrl: 'https://f', formTitle: 'Review {store_name}' },
    promotion: { headline: 'Sale at {{store_name}}', body: COMPOSED, ctaUrl: 'https://x' },
    event: { eventName: '{store_name} meetup', eventDetails: COMPOSED },
    announcement: { headline: 'Hi {customer_first_name}', body: COMPOSED },
    custom: { htmlBody: COMPOSED },
  }
  it.each(Object.keys(DATA))('renderCampaignEmail(%s) leaves no raw token in subject/html/amp', async key => {
    const vars = await resolveTemplateVariables({ recipient: { email: 'a@b.in', first_name: 'Asha' } })
    const out = renderCampaignEmail(
      key,
      { ...DATA[key], subject: COMPOSED_SUBJECT },
      'Asha',
      'https://acme.in',
      vars.store_name,
      vars
    )
    expectClean(out.subject, out.html, out.ampHtml)
    expect(out.html).not.toContain('#a78bfa')
    expect(out.subject).toBe('Asha, news from Acme Tools')
  })

  it('custom full-document bodies are substituted too', async () => {
    const vars = await resolveTemplateVariables({ recipient: { email: 'a@b.in' } })
    const out = renderCampaignEmail(
      'custom',
      { htmlBody: `<!DOCTYPE html><html><body>${COMPOSED}</body></html>` },
      undefined,
      undefined,
      undefined,
      vars
    )
    expectClean(out.html)
  })
})

describe('automation send paths', () => {
  const user = {
    id: 'u1',
    email: 'asha@x.in',
    first_name: 'Asha',
    last_name: 'R',
    unsubscribe_token: 't',
    baseUrl: 'https://acme.jeffistores.in',
  }
  const campaign = {
    kind: 'winback_90',
    subject_template: COMPOSED_SUBJECT,
    body_template: COMPOSED,
    discount_percent: 0,
    coupon_id: null,
  } as any

  it('sendCampaignEmail fills composer tokens in subject and html', async () => {
    const r = await sendCampaignEmail({ campaign, user, referenceId: null, vars: { firstName: 'Asha' } })
    expect(r.ok).toBe(true)
    const m = lastMail()
    expectClean(m.subject, m.html)
    expect(m.subject).toBe('Asha, news from Acme Tools')
    expect(m.html).toContain('9-6')
    expect(m.html).toContain('acme.jeffistores.in')
    expect(m.html).not.toContain('#a78bfa')
  })

  it('sendCampaignEmailRendered fills subject, html and amp (review_request)', async () => {
    const vars = undefined
    const out = renderCampaignEmail(
      'review_request',
      {
        firstName: 'Asha',
        subject: COMPOSED_SUBJECT,
        itemsJson: JSON.stringify([{ name: 'D', imageUrl: null, starLinks: [] }]),
      },
      'Asha',
      'https://acme.in',
      undefined,
      vars
    )
    await sendCampaignEmailRendered({
      campaign,
      user,
      referenceId: 'o1',
      subject: out.subject,
      html: out.html,
      ampHtml: out.ampHtml,
    })
    const m = lastMail()
    expectClean(m.subject, m.html, m.amp)
    expect(m.amp).toContain('Acme Tools')
  })

  it('sendTestCampaignEmail fills every token', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign)
    await sendTestCampaignEmail('winback_90' as any, 'admin@acme.in')
    const m = lastMail()
    expectClean(m.subject, m.html)
  })
})

describe('admin mailer (sendCampaign)', () => {
  it('fills tokens per recipient in subject and html', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'e1',
      title: 't',
      template_key: 'custom',
      subject: COMPOSED_SUBJECT,
      template_data: { htmlBody: COMPOSED },
      audience_type: 'all',
      audience_filter: {},
      status: 'draft',
    } as any)
    vi.mocked(queryMany).mockImplementation(async (sql: string) =>
      /template_variables/.test(sql)
        ? ([{ id: 'c1', key: 'support_hours', label: 'H', description: '', value: '9-6', is_enabled: true }] as any)
        : ([{ user_id: 'u1', email: 'asha@x.in', first_name: 'Asha', last_name: 'R' }] as any)
    )
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    const r = await sendCampaign('e1', { batchDelay: 0 })
    expect(r.sent).toBe(1)
    const m = lastMail()
    expectClean(m.subject, m.html)
    expect(m.html).toContain('Hi Asha')
  })
})

describe('admin routes', () => {
  const json = (body: unknown) =>
    new NextRequest('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const ORDER = {
    id: 'o1',
    order_number: 'ORD-9',
    customer_name: 'Asha R',
    customer_email: 'asha@x.in',
    users: { email: 'asha@x.in', first_name: 'Asha', last_name: 'R' },
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
