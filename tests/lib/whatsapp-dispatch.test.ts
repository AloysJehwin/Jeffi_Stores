import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/marketing', () => ({
  canSendMarketing: vi.fn(),
  alreadySentForReference: vi.fn().mockResolvedValue(false),
  recordSent: vi.fn().mockResolvedValue('sent-1'),
}))
vi.mock('@/lib/shared/whatsapp', () => ({
  sendAbandonedCartWhatsApp: vi.fn(),
  sendBackInStockWhatsApp: vi.fn(),
  sendPromoOfferWhatsApp: vi.fn(),
  sendFeedbackRequestWhatsApp: vi.fn(),
}))
vi.mock('@/lib/shared/sms', () => ({ sendCampaignSMS: vi.fn().mockResolvedValue(true) }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { sendCampaignWhatsApp, campaignSupportsWhatsApp, CAMPAIGN_WA_KINDS } from '@/lib/campaigns/whatsapp-dispatch'
import { queryOne } from '@/lib/shared/db'
import { canSendMarketing, alreadySentForReference, recordSent } from '@/lib/shared/marketing'
import {
  sendAbandonedCartWhatsApp,
  sendBackInStockWhatsApp,
  sendPromoOfferWhatsApp,
  sendFeedbackRequestWhatsApp,
} from '@/lib/shared/whatsapp'
import { sendCampaignSMS } from '@/lib/shared/sms'

const mockQueryOne = vi.mocked(queryOne)
const mockCanSend = vi.mocked(canSendMarketing)
const mockAbandonedCart = vi.mocked(sendAbandonedCartWhatsApp)
const mockBackInStock = vi.mocked(sendBackInStockWhatsApp)
const mockPromoOffer = vi.mocked(sendPromoOfferWhatsApp)
const mockFeedback = vi.mocked(sendFeedbackRequestWhatsApp)
const mockAlreadySent = vi.mocked(alreadySentForReference)
const mockRecordSent = vi.mocked(recordSent)
const mockSendSMS = vi.mocked(sendCampaignSMS)

// Default happy-path setup: phone on file + marketing allowed + not in cooldown + sender succeeds.
function allowAndSend() {
  mockQueryOne.mockResolvedValue({ phone: '+919876543210' } as any)
  mockCanSend.mockResolvedValue({ ok: true } as any)
  mockAlreadySent.mockResolvedValue(false)
  mockRecordSent.mockResolvedValue('sent-1')
  mockAbandonedCart.mockResolvedValue(true)
  mockBackInStock.mockResolvedValue(true)
  mockPromoOffer.mockResolvedValue(true)
  mockFeedback.mockResolvedValue(true)
  mockSendSMS.mockResolvedValue(true)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── campaignSupportsWhatsApp ────────────────────────────────────────────────────

describe('campaignSupportsWhatsApp', () => {
  it('returns true for every supported kind', () => {
    for (const kind of CAMPAIGN_WA_KINDS) {
      expect(campaignSupportsWhatsApp(kind)).toBe(true)
    }
  })

  it('returns false for an unsupported kind', () => {
    expect(campaignSupportsWhatsApp('welcome')).toBe(false)
    expect(campaignSupportsWhatsApp('not_a_real_kind')).toBe(false)
  })
})

// ── sendCampaignWhatsApp — guard rails ──────────────────────────────────────────

describe('sendCampaignWhatsApp guards', () => {
  it('returns unsupported_kind for a kind not in the registry (no DB lookup)', async () => {
    const result = await sendCampaignWhatsApp('welcome', 'user-1', {})
    expect(result).toEqual({ ok: false, reason: 'unsupported_kind' })
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('returns no_phone when the user has no phone number', async () => {
    mockQueryOne.mockResolvedValue({ phone: null } as any)
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'no_phone' })
    expect(mockCanSend).not.toHaveBeenCalled()
  })

  it('returns no_phone when queryOne returns null (no user row)', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'no_phone' })
  })

  it('does not send when marketing is opted out', async () => {
    mockQueryOne.mockResolvedValue({ phone: '+919876543210' } as any)
    mockCanSend.mockResolvedValue({ ok: false, reason: 'opted_out' } as any)
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'opted_out' })
    expect(mockAbandonedCart).not.toHaveBeenCalled()
  })

  it('falls back to opted_out reason when gate gives none', async () => {
    mockQueryOne.mockResolvedValue({ phone: '+919876543210' } as any)
    mockCanSend.mockResolvedValue({ ok: false } as any)
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'opted_out' })
  })

  it('returns error and never throws when a dependency rejects', async () => {
    mockQueryOne.mockRejectedValue(new Error('db down'))
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'error' })
  })
})

// ── sendCampaignWhatsApp — happy paths per kind family ──────────────────────────

describe('sendCampaignWhatsApp dispatch by kind', () => {
  beforeEach(() => allowAndSend())

  it('abandoned_cart → sendAbandonedCartWhatsApp with entity', async () => {
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: '2 bolts' })
    expect(result).toEqual({ ok: true, reason: undefined })
    expect(mockAbandonedCart).toHaveBeenCalledWith({
      phone: '+919876543210',
      items: '2 bolts',
      entity: { entityType: 'campaign', entityId: 'abandoned_cart' },
    })
  })

  it('abandoned_checkout → sendAbandonedCartWhatsApp', async () => {
    await sendCampaignWhatsApp('abandoned_checkout', 'user-1', { items: 'cart' })
    expect(mockAbandonedCart).toHaveBeenCalledWith(
      expect.objectContaining({ entity: { entityType: 'campaign', entityId: 'abandoned_checkout' } })
    )
  })

  it('restock → sendBackInStockWhatsApp with entity', async () => {
    const result = await sendCampaignWhatsApp('restock', 'user-1', { product: 'M6 Washer' })
    expect(result).toEqual({ ok: true, reason: undefined })
    expect(mockBackInStock).toHaveBeenCalledWith({
      phone: '+919876543210',
      product: 'M6 Washer',
      entity: { entityType: 'campaign', entityId: 'restock' },
    })
  })

  it('winback_90 → sendPromoOfferWhatsApp with entity', async () => {
    const result = await sendCampaignWhatsApp('winback_90', 'user-1', {
      headline: 'We miss you',
      code: 'WB10',
      discount: '10',
    })
    expect(result).toEqual({ ok: true, reason: undefined })
    expect(mockPromoOffer).toHaveBeenCalledWith({
      phone: '+919876543210',
      headline: 'We miss you',
      code: 'WB10',
      discount: '10',
      entity: { entityType: 'campaign', entityId: 'winback_90' },
    })
  })

  it('price_drop → sendPromoOfferWhatsApp with defaulted vars', async () => {
    await sendCampaignWhatsApp('price_drop', 'user-1', {})
    expect(mockPromoOffer).toHaveBeenCalledWith({
      phone: '+919876543210',
      headline: 'A special offer for you',
      code: '',
      discount: '',
      entity: { entityType: 'campaign', entityId: 'price_drop' },
    })
  })

  it('review_request → sendFeedbackRequestWhatsApp with entity', async () => {
    const result = await sendCampaignWhatsApp('review_request', 'user-1', {
      orderNumber: 'ORD-1',
      url: 'https://jeffistores.in/feedback/1',
    })
    expect(result).toEqual({ ok: true, reason: undefined })
    expect(mockFeedback).toHaveBeenCalledWith({
      phone: '+919876543210',
      orderNumber: 'ORD-1',
      url: 'https://jeffistores.in/feedback/1',
      entity: { entityType: 'campaign', entityId: 'review_request' },
    })
  })
})

// ── sendCampaignWhatsApp — missing required vars → send_failed ───────────────────

describe('sendCampaignWhatsApp missing vars', () => {
  beforeEach(() => {
    mockQueryOne.mockResolvedValue({ phone: '+919876543210' } as any)
    mockCanSend.mockResolvedValue({ ok: true } as any)
  })

  it('abandoned_cart with no items → send_failed (no sender called)', async () => {
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', {})
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
    expect(mockAbandonedCart).not.toHaveBeenCalled()
  })

  it('restock with no product → send_failed', async () => {
    const result = await sendCampaignWhatsApp('restock', 'user-1', {})
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
    expect(mockBackInStock).not.toHaveBeenCalled()
  })

  it('review_request without orderNumber/url → send_failed', async () => {
    const result = await sendCampaignWhatsApp('review_request', 'user-1', { orderNumber: 'ORD-1' })
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
    expect(mockFeedback).not.toHaveBeenCalled()
  })

  it('send_failed when the sender itself returns false', async () => {
    mockAbandonedCart.mockResolvedValue(false)
    const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
  })

  // #campaign over-send: a per-user cooldown dedup stops the resend storm (55k msgs for ~155 carts).
  describe('cooldown dedup', () => {
    it('refuses to resend when already sent within the window', async () => {
      allowAndSend()
      mockAlreadySent.mockResolvedValue(true)
      const result = await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' }, 1)
      expect(result).toEqual({ ok: false, reason: 'cooldown' })
      expect(mockAbandonedCart).not.toHaveBeenCalled() // never dispatched
      expect(mockSendSMS).not.toHaveBeenCalled()
    })

    it('records the send BEFORE dispatching (crash cannot cause a resend storm)', async () => {
      allowAndSend()
      await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' }, 1)
      expect(mockRecordSent).toHaveBeenCalledWith(
        expect.objectContaining({ campaignKind: 'abandoned_cart', userId: 'user-1', referenceId: 'wa:abandoned_cart' })
      )
    })

    it('defaults to a 1-day window when no cooldown is passed (never unbounded)', async () => {
      allowAndSend()
      await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt' })
      // alreadySentForReference called with a positive window, not undefined/0.
      const call = mockAlreadySent.mock.calls.at(-1)!
      expect(call[3]).toBe(1)
    })
  })

  // #campaign SMS+WhatsApp together: a mobile target gets BOTH channels under one dedup.
  it('also sends an SMS alongside WhatsApp (both channels on one send)', async () => {
    allowAndSend()
    await sendCampaignWhatsApp('abandoned_cart', 'user-1', { items: 'Bolt, Nut' }, 1)
    expect(mockAbandonedCart).toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+919876543210', kind: 'abandoned_cart', userId: 'user-1' })
    )
  })
})

// Every kind advertised as WhatsApp-capable must actually dispatch (loyalty_points_reminder used to
// fall through to `default` and always fail).
describe('every supported kind dispatches', () => {
  const VARS = { items: 'Bolt', product: 'Bolt', headline: 'Hi', code: 'C1', discount: '5', orderNumber: 'O1', url: 'https://x' }
  for (const kind of CAMPAIGN_WA_KINDS) {
    it(`${kind} sends`, async () => {
      allowAndSend()
      const result = await sendCampaignWhatsApp(kind, 'user-1', VARS)
      expect(result).toEqual({ ok: true, reason: undefined })
      expect(mockSendSMS).toHaveBeenCalled()
    })
  }

  it('loyalty_points_reminder → sendPromoOfferWhatsApp', async () => {
    allowAndSend()
    await sendCampaignWhatsApp('loyalty_points_reminder', 'user-1', { headline: 'You have 500 points', code: '' })
    expect(mockPromoOffer).toHaveBeenCalledWith(
      expect.objectContaining({ headline: 'You have 500 points', entity: { entityType: 'campaign', entityId: 'loyalty_points_reminder' } })
    )
  })
})

describe('campaign SMS copy', () => {
  it('formats a bare percent discount as "N% off"', async () => {
    allowAndSend()
    await sendCampaignWhatsApp('winback_90', 'user-1', { headline: 'We miss you!', code: 'BACK-1', discount: '10' })
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ body: 'We miss you! — use code BACK-1 for 10% off.' }))
  })

  it('keeps a discount that is already worded', async () => {
    allowAndSend()
    await sendCampaignWhatsApp('winback_90', 'user-1', { headline: 'Hi', code: 'C', discount: '₹100 off' })
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ body: 'Hi — use code C for ₹100 off.' }))
  })
})

describe('var cleanup', () => {
  it('trims product names before WhatsApp and SMS', async () => {
    allowAndSend()
    await sendCampaignWhatsApp('replenishment', 'user-1', { items: 'Earthing Rod ' })
    expect(mockAbandonedCart).toHaveBeenCalledWith(expect.objectContaining({ items: 'Earthing Rod' }))
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ body: 'Running low on Earthing Rod? Reorder in a tap.' }))
  })
})
