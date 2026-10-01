import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/marketing', () => ({ canSendMarketing: vi.fn() }))
vi.mock('@/lib/shared/whatsapp', () => ({
  sendAbandonedCartWhatsApp: vi.fn(),
  sendBackInStockWhatsApp: vi.fn(),
  sendPromoOfferWhatsApp: vi.fn(),
  sendFeedbackRequestWhatsApp: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { sendCampaignWhatsApp, campaignSupportsWhatsApp, CAMPAIGN_WA_KINDS } from '@/lib/campaigns/whatsapp-dispatch'
import { queryOne } from '@/lib/shared/db'
import { canSendMarketing } from '@/lib/shared/marketing'
import {
  sendAbandonedCartWhatsApp,
  sendBackInStockWhatsApp,
  sendPromoOfferWhatsApp,
  sendFeedbackRequestWhatsApp,
} from '@/lib/shared/whatsapp'

const mockQueryOne = vi.mocked(queryOne)
const mockCanSend = vi.mocked(canSendMarketing)
const mockAbandonedCart = vi.mocked(sendAbandonedCartWhatsApp)
const mockBackInStock = vi.mocked(sendBackInStockWhatsApp)
const mockPromoOffer = vi.mocked(sendPromoOfferWhatsApp)
const mockFeedback = vi.mocked(sendFeedbackRequestWhatsApp)

// Default happy-path setup: phone on file + marketing allowed + sender succeeds.
function allowAndSend() {
  mockQueryOne.mockResolvedValue({ phone: '+919876543210' } as any)
  mockCanSend.mockResolvedValue({ ok: true } as any)
  mockAbandonedCart.mockResolvedValue(true)
  mockBackInStock.mockResolvedValue(true)
  mockPromoOffer.mockResolvedValue(true)
  mockFeedback.mockResolvedValue(true)
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
})
