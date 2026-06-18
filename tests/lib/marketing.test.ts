import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import {
  renderTemplate,
  rewriteLinksForTracking,
  buildUnsubscribeUrl,
  buildTrackingPixelUrl,
  buildClickTrackingUrl,
  wrapWithTracking,
  canSendMarketing,
  alreadySentForReference,
  recordSent,
  attributeConversion,
  getCampaign,
  getAllCampaigns,
  generateCouponForCampaign,
  getAssignedCouponCode,
} from '@/lib/marketing'
import { query, queryOne } from '@/lib/db'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

// ---- Pure functions --------------------------------------------------------

describe('renderTemplate', () => {
  it('substitutes a single placeholder', () => {
    expect(renderTemplate('Hello {name}!', { name: 'Alice' })).toBe('Hello Alice!')
  })

  it('substitutes multiple placeholders', () => {
    expect(renderTemplate('{greeting} {name}', { greeting: 'Hi', name: 'Bob' })).toBe('Hi Bob')
  })

  it('replaces missing placeholders with empty string', () => {
    expect(renderTemplate('Hello {missing}!', {})).toBe('Hello !')
  })

  it('handles numeric values', () => {
    expect(renderTemplate('Order #{num}', { num: 42 })).toBe('Order #42')
  })

  it('returns original string when no placeholders', () => {
    expect(renderTemplate('no placeholders', { x: '1' })).toBe('no placeholders')
  })
})

describe('buildUnsubscribeUrl', () => {
  it('returns a URL containing the token and campaign kind', () => {
    const url = buildUnsubscribeUrl('tok-abc', 'winback_90')
    expect(url).toContain('token=tok-abc')
    expect(url).toContain('campaign=winback_90')
    expect(url).toContain('/api/unsubscribe')
  })
})

describe('buildTrackingPixelUrl', () => {
  it('returns a URL containing the sentId', () => {
    const url = buildTrackingPixelUrl('sent-123')
    expect(url).toContain('id=sent-123')
    expect(url).toContain('/api/email-events/open')
  })
})

describe('buildClickTrackingUrl', () => {
  it('returns a URL with encoded destination', () => {
    const dest = 'https://example.com/products?q=test&page=1'
    const url = buildClickTrackingUrl('sent-456', dest)
    expect(url).toContain('id=sent-456')
    expect(url).toContain(encodeURIComponent(dest))
    expect(url).toContain('/api/email-events/click')
  })
})

describe('rewriteLinksForTracking', () => {
  it('rewrites href links to tracking URLs', () => {
    const html = '<a href="https://example.com/page">Click</a>'
    const result = rewriteLinksForTracking(html, 'sent-789')
    expect(result).not.toContain('href="https://example.com/page"')
    expect(result).toContain('/api/email-events/click')
    expect(result).toContain('sent-789')
  })

  it('rewrites multiple links', () => {
    const html = '<a href="https://a.com">A</a> <a href="https://b.com">B</a>'
    const result = rewriteLinksForTracking(html, 's1')
    const matches = result.match(/api\/email-events\/click/g)
    expect(matches).toHaveLength(2)
  })

  it('does not rewrite non-http links', () => {
    const html = '<a href="mailto:foo@bar.com">Email</a>'
    const result = rewriteLinksForTracking(html, 's1')
    expect(result).toContain('mailto:foo@bar.com')
  })

  it('returns original html when no links', () => {
    const html = '<p>No links here</p>'
    expect(rewriteLinksForTracking(html, 's1')).toBe(html)
  })
})

describe('wrapWithTracking', () => {
  it('appends tracking pixel and unsubscribe footer', () => {
    const result = wrapWithTracking('<p>Hello</p>', 'sent-1', 'https://unsub.com')
    expect(result).toContain('/api/email-events/open')
    expect(result).toContain('https://unsub.com')
    expect(result).toContain('Unsubscribe')
  })

  it('rewrites links within the html', () => {
    const html = '<a href="https://example.com">Link</a>'
    const result = wrapWithTracking(html, 'sent-2', 'https://unsub.com')
    expect(result).toContain('/api/email-events/click')
  })
})

// ---- DB-backed functions ---------------------------------------------------

describe('getCampaign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls queryOne with the campaign kind', async () => {
    mockQueryOne.mockResolvedValue({ kind: 'winback_90', name: 'Winback' } as any)
    const campaign = await getCampaign('winback_90')
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('campaigns'),
      ['winback_90']
    )
    expect(campaign?.kind).toBe('winback_90')
  })

  it('returns null when campaign not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getCampaign('unknown')).toBeNull()
  })
})

describe('getAllCampaigns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows from query', async () => {
    mockQuery.mockResolvedValue({ rows: [{ kind: 'abandoned_cart' }], rowCount: 1 } as any)
    const campaigns = await getAllCampaigns()
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].kind).toBe('abandoned_cart')
  })
})

describe('canSendMarketing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns not_found when user does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('user_not_found')
  })

  it('returns no_email when user has no email', async () => {
    mockQueryOne.mockResolvedValueOnce({ email: null, is_active: true, marketing_opt_out: false })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_email')
  })

  it('returns opted_out when user has opted out', async () => {
    mockQueryOne.mockResolvedValueOnce({ email: 'u@e.com', is_active: true, marketing_opt_out: true })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('opted_out')
  })

  it('returns inactive_user when user is not active', async () => {
    mockQueryOne.mockResolvedValueOnce({ email: 'u@e.com', is_active: false, marketing_opt_out: false })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('inactive_user')
  })

  it('returns campaign_not_found when campaign missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ email: 'u@e.com', is_active: true, marketing_opt_out: false })
      .mockResolvedValueOnce(null) // getCampaign → queryOne
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('campaign_not_found')
  })

  it('returns campaign_disabled when campaign is disabled', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ email: 'u@e.com', is_active: true, marketing_opt_out: false })
      .mockResolvedValueOnce({ kind: 'winback_90', enabled: false })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('campaign_disabled')
  })

  it('returns frequency_cap when already sent recently', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ email: 'u@e.com', is_active: true, marketing_opt_out: false })
      .mockResolvedValueOnce({ kind: 'winback_90', enabled: true })
      .mockResolvedValueOnce({ cnt: '1' })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('frequency_cap')
  })

  it('returns ok:true when all checks pass', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ email: 'u@e.com', is_active: true, marketing_opt_out: false })
      .mockResolvedValueOnce({ kind: 'winback_90', enabled: true })
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await canSendMarketing('user-1', 'winback_90')
    expect(r.ok).toBe(true)
  })
})

describe('alreadySentForReference', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when a matching row exists', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sent-1' })
    expect(await alreadySentForReference('winback_90', 'user-1', 'ref-1')).toBe(true)
  })

  it('returns false when no matching row', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await alreadySentForReference('winback_90', 'user-1', 'ref-1')).toBe(false)
  })
})

describe('recordSent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the inserted id on success', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'sent-abc' }], rowCount: 1 } as any)
    const id = await recordSent({ campaignKind: 'winback_90', userId: 'user-1' })
    expect(id).toBe('sent-abc')
  })

  it('returns null on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('db error'))
    const id = await recordSent({ campaignKind: 'winback_90', userId: 'user-1' })
    expect(id).toBeNull()
  })
})

describe('attributeConversion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs UPDATE query and resolves', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await expect(attributeConversion('user-1', 'order-1')).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('email_campaigns_sent'),
      ['user-1', 'order-1']
    )
  })

  it('does not throw on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('db error'))
    await expect(attributeConversion('user-1', 'order-1')).resolves.toBeUndefined()
  })
})

describe('getAssignedCouponCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns coupon data when found', async () => {
    mockQueryOne.mockResolvedValue({ code: 'SAVE10', discountValue: 10, discountType: 'percentage' })
    const result = await getAssignedCouponCode('coupon-1')
    expect(result?.code).toBe('SAVE10')
  })

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getAssignedCouponCode('missing')).toBeNull()
  })
})

describe('generateCouponForCampaign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reuses existing active campaign coupon', async () => {
    mockQueryOne.mockResolvedValue({ id: 'coupon-existing', code: 'BACK-EXIST' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const code = await generateCouponForCampaign({
      campaignKind: 'winback_90',
      discountPercent: 10,
      expiresInDays: 30,
    })
    expect(code).toBe('BACK-EXIST')
  })

  it('creates a new coupon when none exists', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'new-coupon' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    const code = await generateCouponForCampaign({
      campaignKind: 'winback_90',
      discountPercent: 15,
      expiresInDays: 7,
    })
    expect(typeof code).toBe('string')
    expect(code).toMatch(/^BACK-/)
  })

  it('uses OFFER prefix for non-winback campaigns', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'new-coupon' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    const code = await generateCouponForCampaign({
      campaignKind: 'abandoned_cart',
      discountPercent: 5,
      expiresInDays: 3,
    })
    expect(code).toMatch(/^OFFER-/)
  })

  it('returns null on DB insert error', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQuery.mockRejectedValue(new Error('db error'))
    const code = await generateCouponForCampaign({
      campaignKind: 'post_purchase',
      discountPercent: 5,
      expiresInDays: 7,
    })
    expect(code).toBeNull()
  })
})
