import { describe, it, expect } from 'vitest'
import { byPeriod, classifyFailure, groupFailures, resolveListTab } from '@/lib/overviews/marketing'
import { couponAttention, toState, toTotals } from '@/lib/overviews/coupons'
import { customerAttention, toCustomerState, toCustomerTotals } from '@/lib/overviews/customers'
import { programAttention, toLoyaltyTotals, toReferralTotals } from '@/lib/overviews/customer-programs'
import { campaignAttention, toCampaignRow, toCampaignStats } from '@/lib/overviews/campaigns'
import {
  channelMatrix,
  messagingAttention,
  toMessagingState,
  toMessagingTotals,
} from '@/lib/overviews/marketing-messaging'
import { reviewFormAttention, toFormRow, toReviewFormState, toReviewFormTotals } from '@/lib/overviews/review-forms'

describe('resolveListTab', () => {
  const keys = ['search', 'page', 'is_active']
  it('defaults to the overview', () => {
    expect(resolveListTab({}, keys)).toBe('overview')
    expect(resolveListTab({ from: '2026-10-01', to: '2026-10-10' }, keys)).toBe('overview')
  })
  it('keeps old list links on the list', () => {
    expect(resolveListTab({ page: '2' }, keys)).toBe('list')
    expect(resolveListTab({ is_active: 'true' }, keys)).toBe('list')
    expect(resolveListTab({ search: '' }, keys)).toBe('overview')
  })
  it('honours an explicit tab', () => {
    expect(resolveListTab({ tab: 'list' }, keys)).toBe('list')
    expect(resolveListTab({ tab: 'overview', page: '3' }, keys)).toBe('overview')
  })
})

describe('classifyFailure', () => {
  it('names the WhatsApp marketing cap from the code or the messaging-service text', () => {
    expect(classifyFailure('Twilio error 63049').key).toBe('63049')
    const c = classifyFailure(
      "Meta held back this marketing message — WhatsApp caps marketing messages to people who haven't chatted (63049)"
    )
    expect(c).toEqual({ key: '63049', label: 'WhatsApp marketing cap (Meta) (63049)' })
  })
  it('groups common provider failures', () => {
    expect(classifyFailure('getaddrinfo ENOTFOUND api.twilio.com').key).toBe('unreachable')
    expect(classifyFailure('timeout of 30000ms exceeded').key).toBe('unreachable')
    expect(classifyFailure('Error: Message failed: 454 Throttling failure: Maximum sending rate exceeded.').key).toBe(
      'rate_limit'
    )
    expect(classifyFailure('SES_SMTP_USER / SES_SMTP_PASSWORD not set').key).toBe('not_configured')
    expect(classifyFailure('Not delivered (21610)').key).toBe('21610')
    expect(classifyFailure('Not delivered (63019)').label).toContain('63019')
    expect(classifyFailure(null).key).toBe('unknown')
    expect(classifyFailure('stopped for some reason').key).toBe('other')
  })
  it('sums rows into reasons, largest first', () => {
    const g = groupFailures([
      { error: 'timeout of 30000ms exceeded', n: '25', channel: 'whatsapp' },
      { error: 'getaddrinfo ENOTFOUND x', n: '30', channel: 'sms' },
      { error: 'error 63049', n: '2', channel: 'whatsapp' },
    ])
    expect(g[0]).toEqual({
      key: 'unreachable',
      label: 'Provider unreachable',
      count: 55,
      channels: ['sms', 'whatsapp'],
    })
    expect(g[1].key).toBe('63049')
  })
})

describe('byPeriod', () => {
  it('splits current and previous rows', () => {
    const r = byPeriod(
      [
        { period: 'prev', redemptions: '2' },
        { period: 'cur', redemptions: '5' },
      ],
      toTotals
    )
    expect(r.current.redemptions).toBe(5)
    expect(r.previous.redemptions).toBe(2)
    expect(byPeriod([], toTotals).current.redemptions).toBe(0)
  })
})

describe('coupons', () => {
  it('derives rates', () => {
    const t = toTotals({
      redemptions: 10,
      discount: '200',
      coupon_revenue: '800',
      coupon_orders: 4,
      all_orders: 16,
      all_revenue: '3200',
    })
    expect(t.discount_rate).toBeCloseTo(0.2)
    expect(t.order_share).toBeCloseTo(0.25)
    expect(t.revenue_share).toBeCloseTo(0.25)
    expect(toTotals(undefined).discount_rate).toBeNull()
  })
  it('flags exhausted, expiring and heavy discounting', () => {
    const items = couponAttention(
      toState({ exhausted: 1, expiring: 2, unused: 0 }),
      toTotals({ redemptions: 10, discount: '500', coupon_revenue: '1000' })
    )
    expect(items.map(i => i.key)).toEqual(['exhausted', 'expiring', 'discount_rate'])
    expect(couponAttention(toState({}), toTotals({}))).toEqual([])
  })
})

describe('customers', () => {
  it('computes repeat rate and guest share', () => {
    const t = toCustomerTotals({ active_buyers: 4, repeat_buyers: 1, account_orders: 6, guest_orders: 2 })
    expect(t.repeat_rate).toBe(0.25)
    expect(t.guest_share).toBe(0.25)
  })
  it('flags flagged accounts, leads, guest-heavy periods and signup drops', () => {
    const cur = toCustomerTotals({ new_accounts: 3, account_orders: 4, guest_orders: 8 })
    const prev = toCustomerTotals({ new_accounts: 20 })
    const keys = customerAttention(toCustomerState({ flagged: 2, new_no_order: 5 }), cur, prev).map(i => i.key)
    expect(keys).toEqual(['flagged', 'new_no_order', 'guests', 'signups_drop'])
  })
})

describe('customer programs', () => {
  it('computes the redeem and signup rates', () => {
    expect(toLoyaltyTotals({ issued: 1000, redeemed: 250 }).redeem_rate).toBe(0.25)
    expect(toReferralTotals({ invites: 10, signups: 3 }).signup_rate).toBeCloseTo(0.3)
  })
  it('warns when loyalty is off with points outstanding', () => {
    const facts = {
      loyaltyOn: false,
      referralsOn: true,
      liability: 100,
      outstandingPoints: 500,
      redeemableMembers: 0,
      minRedeemPoints: 100,
      staleJoined: 2,
      qualifyDays: 30,
    }
    const items = programAttention(
      facts,
      toLoyaltyTotals({ issued: 100, reversed: 60 }),
      toReferralTotals({ rejected: 1 })
    )
    expect(items.map(i => i.key)).toEqual(['loyalty_off', 'stale_joined', 'rejected', 'reversals'])
  })
  it('nudges redeemable members when nobody redeemed', () => {
    const facts = {
      loyaltyOn: true,
      referralsOn: true,
      liability: 0,
      outstandingPoints: 0,
      redeemableMembers: 4,
      minRedeemPoints: 100,
      staleJoined: 0,
      qualifyDays: 30,
    }
    expect(programAttention(facts, toLoyaltyTotals({}), toReferralTotals({})).map(i => i.key)).toEqual(['redeemable'])
  })
})

describe('campaigns', () => {
  it('measures email rates over delivered emails', () => {
    const s = toCampaignStats({
      sends: 110,
      emails: 100,
      delivered_emails: 90,
      opened: 45,
      clicked: 9,
      converted: 11,
      bounced: 10,
      unsubscribed: 3,
    })
    expect(s.open_rate).toBe(0.5)
    expect(s.click_rate).toBe(0.1)
    expect(s.conversion_rate).toBe(0.1)
    expect(s.bounce_rate).toBe(0.1)
  })
  it('flags the WhatsApp cap, failures, bad campaigns and idle ones', () => {
    const row = toCampaignRow({
      kind: 'winback_90',
      name: 'Win-back',
      enabled: true,
      emails: 100,
      delivered_emails: 90,
      bounced: 10,
      unsubscribed: 5,
    })
    const items = campaignAttention(
      [row],
      [{ kind: 'restock', name: 'Back in Stock', last_run_at: null }],
      [
        { key: '63049', label: 'cap', count: 3 },
        { key: 'unreachable', label: 'Provider unreachable', count: 4 },
      ]
    )
    expect(items.map(i => i.key)).toEqual(['wa_cap', 'failed', 'unsub_winback_90', 'bounce_winback_90', 'idle'])
    expect(items.find(i => i.key === 'idle')?.href).toBe('/admin/campaigns/restock')
  })
})

describe('marketing messaging', () => {
  it('adds both sources into totals', () => {
    const t = toMessagingTotals({ broadcast_messages: 40, broadcast_failed: 2, logged_messages: 60, logged_failed: 8 })
    expect(t.messages).toBe(100)
    expect(t.failed).toBe(10)
    expect(t.failure_rate).toBe(0.1)
  })
  it('pivots channel rows', () => {
    const m = channelMatrix([
      { channel: 'whatsapp', outcome: 'failed', n: 2, spend: 0 },
      { channel: 'whatsapp', outcome: 'delivered', n: 5, spend: '1.5' },
      { channel: 'email', outcome: 'sent', n: 3, spend: 0 },
    ])
    expect(m[0]).toEqual({ channel: 'whatsapp', sent: 0, delivered: 5, failed: 2, spend: 1.5, total: 7 })
  })
  it('names the 63049 cap and a high failure rate', () => {
    const items = messagingAttention(
      toMessagingTotals({ broadcast_messages: 20, broadcast_failed: 5 }),
      toMessagingState({ stuck: 1, overdue: 1, drafts: 0 }),
      [
        { key: '63049', label: 'cap', count: 3 },
        { key: 'unreachable', label: 'Provider unreachable', count: 2 },
      ]
    )
    expect(items.map(i => i.key)).toEqual(['stuck', 'overdue', 'wa_cap', 'failure_rate'])
    expect(items[3].sub).toContain('Provider unreachable')
  })
})

describe('review forms', () => {
  it('computes conversion and approval', () => {
    const t = toReviewFormTotals({ submissions: 5, requests: 50, approved: 3, rejected: 1 })
    expect(t.conversion).toBe(0.1)
    expect(t.approval_rate).toBe(0.75)
  })
  it('points pending reviews at the busiest form', () => {
    const now = Date.parse('2026-10-16T00:00:00Z')
    const forms = [
      toFormRow({ id: 'f1', is_active: true, submissions: 2, pending: 1 }),
      toFormRow({ id: 'f2', is_active: true, submissions: 0, pending: 0 }),
    ]
    const items = reviewFormAttention(
      toReviewFormState({ active: 2, pending: 1, no_coupon: 1, oldest_pending: '2026-10-10T00:00:00Z' }),
      forms,
      now
    )
    expect(items.map(i => i.key)).toEqual(['pending', 'no_coupon', 'idle'])
    expect(items[0]).toMatchObject({ severity: 'warning', href: '/admin/review-forms/f1/submissions' })
  })
})
