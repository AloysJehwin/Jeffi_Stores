/**
 * Tests for src/lib/ecom-emails.ts
 *
 * These are the onboarding transactional emails. Two things matter beyond "does
 * it render": the per-tenant sender addresses must be derived correctly (SES has
 * a single domain identity for jeffistores.in, so a malformed local-part silently
 * fails to deliver), and send() must SWALLOW SMTP failures — an email outage must
 * never fail a KYC approval or a provisioning webhook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
  createTransport: vi.fn(() => ({ sendMail })),
}))

const OWNER = { email: 'owner@example.com', name: 'Asha' }
const OWNER_NO_NAME = { email: 'owner@example.com', name: null }

/** The options object passed to the most recent sendMail call. */
function lastMail() {
  return sendMail.mock.calls[sendMail.mock.calls.length - 1][0]
}

describe('ecom-emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMail.mockResolvedValue({ messageId: 'ok' })
  })

  describe('per-tenant sender addresses', () => {
    it('builds the storefront noreply sender', async () => {
      const { tenantNoReplyEmail } = await import('@/lib/ecom-emails')
      expect(tenantNoReplyEmail('acme')).toBe('"acme Store" <noreply-acme@jeffistores.in>')
    })

    it('builds the campaign sender (Pro+)', async () => {
      const { tenantCampaignEmail } = await import('@/lib/ecom-emails')
      expect(tenantCampaignEmail('acme')).toBe('"acme Store" <campaigns-acme@jeffistores.in>')
    })

    it('keeps both senders under the single jeffistores.in SES identity', async () => {
      const { tenantNoReplyEmail, tenantCampaignEmail } = await import('@/lib/ecom-emails')
      expect(tenantNoReplyEmail('x')).toContain('@jeffistores.in>')
      expect(tenantCampaignEmail('x')).toContain('@jeffistores.in>')
    })
  })

  describe('sendKycSubmittedEmail', () => {
    it('emails the applicant and notifies the platform admin', async () => {
      const { sendKycSubmittedEmail } = await import('@/lib/ecom-emails')
      await sendKycSubmittedEmail(OWNER)
      expect(sendMail).toHaveBeenCalledTimes(2)
      const recipients = sendMail.mock.calls.map((c: any[]) => c[0].to)
      expect(recipients[0]).toBe('owner@example.com')
      expect(recipients[1]).toMatch(/@/) // platform admin
      expect(sendMail.mock.calls[1][0].subject).toContain('[KYC]')
    })

    it('falls back to "there" when the owner has no name', async () => {
      const { sendKycSubmittedEmail } = await import('@/lib/ecom-emails')
      await sendKycSubmittedEmail(OWNER_NO_NAME)
      expect(sendMail.mock.calls[0][0].html).toContain('Hi there')
    })
  })

  describe('sendKycApprovedEmail', () => {
    it('includes the checkout link and the future store URL', async () => {
      const { sendKycApprovedEmail } = await import('@/lib/ecom-emails')
      await sendKycApprovedEmail(OWNER, { display_name: 'Acme Ltd', slug: 'acme' }, 'https://rzp.io/checkout/abc')
      const mail = lastMail()
      expect(mail.to).toBe('owner@example.com')
      expect(mail.html).toContain('https://rzp.io/checkout/abc')
      expect(mail.html).toContain('acme.jeffistores.in')
      expect(mail.html).toContain('Acme Ltd')
    })

    it('handles a missing owner name', async () => {
      const { sendKycApprovedEmail } = await import('@/lib/ecom-emails')
      await sendKycApprovedEmail(OWNER_NO_NAME, { display_name: 'Acme', slug: 'acme' }, 'https://x')
      expect(lastMail().html).toContain('Hi there')
    })
  })

  describe('sendKycRejectedEmail', () => {
    it('states the reason and points at support', async () => {
      const { sendKycRejectedEmail } = await import('@/lib/ecom-emails')
      await sendKycRejectedEmail(OWNER, 'GST certificate unreadable')
      const mail = lastMail()
      expect(mail.html).toContain('GST certificate unreadable')
      expect(mail.html).toContain('support@jeffistores.in')
      expect(mail.subject).toMatch(/action required/i)
    })
  })

  describe('sendPaymentConfirmedEmail', () => {
    it('summarises store, plan and billing interval', async () => {
      const { sendPaymentConfirmedEmail } = await import('@/lib/ecom-emails')
      await sendPaymentConfirmedEmail(OWNER, {
        display_name: 'Acme Ltd', slug: 'acme', plan: 'growth', billing_interval: 'monthly',
      })
      const mail = lastMail()
      expect(mail.html).toContain('growth')
      expect(mail.html).toContain('monthly')
      expect(mail.subject).toContain('Acme Ltd')
    })

    it('defaults a null plan to Basic', async () => {
      const { sendPaymentConfirmedEmail } = await import('@/lib/ecom-emails')
      await sendPaymentConfirmedEmail(OWNER, {
        display_name: 'Acme', slug: 'acme', plan: null, billing_interval: 'yearly',
      })
      expect(lastMail().html).toContain('Basic')
    })
  })

  describe('sendStoreLiveEmail', () => {
    it('includes both the storefront and the tenant admin URL', async () => {
      const { sendStoreLiveEmail } = await import('@/lib/ecom-emails')
      await sendStoreLiveEmail(OWNER, { display_name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
      const mail = lastMail()
      expect(mail.html).toContain('https://acme.jeffistores.in')
      expect(mail.html).toContain('https://admin-acme.jeffistores.in')
      expect(mail.html).toContain('owner@example.com') // login reminder
    })

    it('defaults a null plan to Basic', async () => {
      const { sendStoreLiveEmail } = await import('@/lib/ecom-emails')
      await sendStoreLiveEmail(OWNER, { display_name: 'Acme', slug: 'acme', plan: null })
      expect(lastMail().html).toContain('Basic')
    })
  })

  describe('SMTP failures must never break the caller', () => {
    it('swallows a send failure rather than failing the KYC flow', async () => {
      sendMail.mockRejectedValue(new Error('SES throttled'))
      const { sendKycApprovedEmail } = await import('@/lib/ecom-emails')
      await expect(
        sendKycApprovedEmail(OWNER, { display_name: 'Acme', slug: 'acme' }, 'https://x'),
      ).resolves.toBeUndefined()
    })

    it('swallows a send failure in the store-live notification', async () => {
      sendMail.mockRejectedValue(new Error('connection reset'))
      const { sendStoreLiveEmail } = await import('@/lib/ecom-emails')
      await expect(
        sendStoreLiveEmail(OWNER, { display_name: 'Acme', slug: 'acme', plan: 'basic' }),
      ).resolves.toBeUndefined()
    })
  })

  describe('shared shell', () => {
    it('every email renders a complete HTML document from the platform sender', async () => {
      const { sendKycRejectedEmail } = await import('@/lib/ecom-emails')
      await sendKycRejectedEmail(OWNER, 'reason')
      const mail = lastMail()
      expect(mail.html).toMatch(/^<!DOCTYPE html>/)
      expect(mail.html).toContain('Jeffi Commerce')
      expect(mail.from).toContain('Jeffi Commerce')
    })
  })
})

