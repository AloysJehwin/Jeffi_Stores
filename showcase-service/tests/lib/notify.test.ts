// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The owner's email about a new enquiry, rendered through the real platform mail (only the sending chokepoint is
// mocked, so nothing leaves): who it goes to, where a reply goes, the call/WhatsApp links and the escaping.

const { getOwnerById, query, sendAuditedMail } = vi.hoisted(() => ({ getOwnerById: vi.fn(), query: vi.fn(), sendAuditedMail: vi.fn() }))

vi.mock('@/lib/tenant-registry/owners', () => ({ getOwnerById }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail }))
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) } }))

import { emailLeadToOwner } from '@showcase/lib/notify'
import type { ShowcaseLead, ShowcaseSiteRow } from '@/lib/showcase/store'

const SITE = { id: 'site-1', slug: 'latte', ownerId: 'owner-1', tenantId: 'tenant-1', business: { name: 'Latte Café' } } as unknown as ShowcaseSiteRow
const LEAD: ShowcaseLead = {
  id: 'lead-1',
  siteId: 'site-1',
  name: 'Priya Sharma',
  phone: '98765 43210',
  email: 'priya@example.com',
  message: 'A cake for Sunday?\nAround 2 kg.',
  createdAt: '2026-11-18T10:00:00.000Z',
  readAt: null,
}

async function mailFor(lead: ShowcaseLead, site = SITE) {
  await emailLeadToOwner(site, lead)
  expect(sendAuditedMail).toHaveBeenCalledOnce()
  return sendAuditedMail.mock.calls[0][0]
}

describe('emailLeadToOwner', () => {
  beforeEach(() => {
    getOwnerById.mockResolvedValue({ id: 'owner-1', email: 'owner@example.com', name: 'Asha' })
    query.mockResolvedValue({ rows: [{ slug: 'latte-ws' }] })
    sendAuditedMail.mockResolvedValue({})
  })

  it('mails the owner, and a reply goes to the visitor', async () => {
    const mail = await mailFor(LEAD)
    expect(mail.to).toBe('owner@example.com')
    expect(mail.replyTo).toBe('priya@example.com')
    // The platform's "you can reply" line would point a reply at the wrong person.
    expect(mail.replyHint).toBe(false)
    expect(mail.subject).toBe('New enquiry from Priya Sharma · Latte Café')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM tenants'), ['tenant-1'])
    const html: string = mail.html
    expect(html).toContain('Hi Asha')
    expect(html).toContain('<strong>site-latte.jeffistores.in</strong>')
    expect(html).toContain('Reply to this email to answer Priya Sharma, or call or WhatsApp them.')
    expect(html).toContain('href="tel:+919876543210"')
    expect(html).toContain('href="https://wa.me/919876543210"')
    expect(html).toContain('href="mailto:priya@example.com"')
    expect(html).toContain('A cake for Sunday?<br>Around 2 kg.')
    expect(html).toContain('18 Nov 2026')
    expect(html).toContain('https://ecom.jeffistores.in/dashboard/showcase/leads?tenant=latte-ws')
    expect(html).not.toContain('Reply to this email or write to')
  })

  it('escapes everything the visitor typed', async () => {
    const mail = await mailFor({ ...LEAD, name: '<script>alert(1)</script>\r\nBcc: x@example.com', message: '<img src=x onerror=alert(1)> & "quotes"' })
    const html: string = mail.html
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Bcc: x@example.com')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;')
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('without an email, says to call or WhatsApp, and a reply comes to the platform', async () => {
    const mail = await mailFor({ ...LEAD, email: null, phone: '+44 20 7946 0958' })
    expect(mail.replyTo).not.toBe('priya@example.com')
    expect(mail.replyTo).toMatch(/@jeffistores\.in$/)
    expect(mail.html).toContain('Priya Sharma left no email: call or WhatsApp them on +44 20 7946 0958.')
    expect(mail.html).toContain('href="tel:+442079460958"')
    expect(mail.html).toContain('href="https://wa.me/442079460958"')
    expect(mail.html).not.toContain('mailto:priya')
  })

  it('gives a local number a call link but no WhatsApp link (no country code to give it)', async () => {
    const mail = await mailFor({ ...LEAD, phone: '2434 5678' })
    expect(mail.html).toContain('href="tel:24345678"')
    expect(mail.html).not.toContain('wa.me')
  })

  it('names the site by its address when the business has no name, and opens the console without a workspace', async () => {
    const mail = await mailFor(LEAD, { ...SITE, tenantId: null, business: { name: '' } } as unknown as ShowcaseSiteRow)
    expect(mail.subject).toBe('New enquiry from Priya Sharma · site-latte.jeffistores.in')
    expect(mail.html).toContain('href="https://ecom.jeffistores.in/dashboard/showcase/leads"')
    expect(query).not.toHaveBeenCalled()
  })

  it('sends nothing when the site has no owner on record', async () => {
    getOwnerById.mockResolvedValueOnce(null)
    await emailLeadToOwner(SITE, LEAD)
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })
})
