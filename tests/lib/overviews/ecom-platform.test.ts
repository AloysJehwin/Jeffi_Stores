import { describe, it, expect } from 'vitest'
import {
  buildAttention,
  monthlyValue,
  mrrChurnRate,
  mrrMovement,
  nextRenewal,
  storageUse,
  walletMix,
} from '@/lib/overviews/ecom-platform'
import { productOf } from '@/lib/overviews/ecom-customers'
import { driftFrom } from '@/lib/overviews/ecom-instances'
import { healthOf, probeState } from '@/lib/overviews/ecom-store-status'

describe('MRR maths', () => {
  it('counts monthly plans at price and yearly at ten months over twelve', () => {
    expect(monthlyValue(7999, 'monthly')).toBe(7999)
    expect(monthlyValue(1200, 'yearly')).toBe(1000)
    expect(monthlyValue(0, 'monthly')).toBe(0)
  })

  it('nets new against churned MRR', () => {
    expect(mrrMovement(10998, 2999)).toEqual({ new_mrr: 10998, churned_mrr: 2999, net_new_mrr: 7999 })
    expect(mrrMovement(0, 4999).net_new_mrr).toBe(-4999)
  })

  it('takes MRR churn against MRR at the start of the period', () => {
    // start = 10000 + 2000 - 4000 = 8000
    expect(mrrChurnRate(10000, 4000, 2000)).toBe(0.25)
    expect(mrrChurnRate(7999, 10998, 2999)).toBeNull()
  })

  it('puts the next renewal one interval after the last charge', () => {
    expect(nextRenewal('2026-09-20T05:00:00Z', 'monthly')).toBe('2026-10-20')
    expect(nextRenewal('2025-10-20T05:00:00Z', 'yearly')).toBe('2026-10-20')
  })
})

describe('storage and wallet', () => {
  it('has no share without a quota', () => {
    expect(storageUse(8, 10)).toBe(0.8)
    expect(storageUse(8, 0)).toBeNull()
  })

  it('splits wallet movements into top-ups and usage revenue', () => {
    const m = walletMix([
      { category: 'recharge', entry_type: 'recharge', amount: 2100, n: 2 },
      { category: 'sms', entry_type: 'debit', amount: -110.6 },
      { category: 'whatsapp', entry_type: 'debit', amount: -21.8 },
      { category: 'document', entry_type: 'debit', amount: -33.46 },
      { category: 'shipping_forward', entry_type: 'debit', amount: -68.94 },
      { category: 'shipping_cancel_credit', entry_type: 'adjustment', amount: 100 },
      { category: null, entry_type: 'debit', amount: -5 },
    ])
    expect(m).toEqual({ topups: 2100, topup_count: 2, messaging: 132.4, documents: 33.46, shipping: -31.06, other: 5 })
  })
})

describe('attention', () => {
  it('groups by kind, keeps the page area and links a single store', () => {
    const items = buildAttention(
      [
        { kind: 'storage_near_quota', id: 's1', name: 'Beta' },
        { kind: 'failed_payment', id: 'a', name: 'Alpha' },
        { kind: 'failed_payment', id: 'b', name: 'Bravo' },
        { kind: 'wallet_low', id: 'c', name: 'Charlie' },
      ],
      'customers'
    )
    expect(items.map(i => i.key)).toEqual(['failed_payment', 'storage_near_quota'])
    expect(items[0]).toMatchObject({ severity: 'critical', sub: 'Alpha, Bravo', href: '/admin/ecom/billing?tab=list' })
    expect(items[1].href).toBe('/admin/ecom/instances/s1/view')
  })

  it('summarises long lists', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map(n => ({ kind: 'service_approval', id: n, name: n }))
    expect(buildAttention(rows, 'customers')[0].sub).toBe('A, B, C and 2 more')
    expect(buildAttention(rows, 'billing')).toEqual([])
  })
})

describe('page helpers', () => {
  it('classifies products from service types', () => {
    expect(productOf(['store'])).toBe('store')
    expect(productOf(['messaging', 'documents'])).toBe('services')
    expect(productOf(['store', 'messaging'])).toBe('both')
    expect(productOf(null)).toBe('store')
  })

  it('measures release drift from the most common sha', () => {
    expect(driftFrom(['a', 'a', 'b', null])).toEqual({ head: 'a', behind: 1 })
    expect(driftFrom([])).toEqual({ head: null, behind: 0 })
  })

  it('derives store health', () => {
    expect(healthOf({ status: 'active', instance_state: 'running', last_release: 'success' })).toBe('up')
    expect(healthOf({ status: 'active', instance_state: 'running', last_release: 'failed' })).toBe('degraded')
    expect(healthOf({ status: 'active', instance_state: 'running', last_release: null, domain_failed: true })).toBe(
      'degraded'
    )
    expect(healthOf({ status: 'active', instance_state: 'stopped', last_release: null })).toBe('down')
    expect(healthOf({ status: 'suspended', instance_state: 'running', last_release: null })).toBe('suspended')
    expect(healthOf({ status: 'provisioning', instance_state: 'running', last_release: null })).toBe('setting_up')
  })

  it('classifies a probe', () => {
    expect(probeState(200, 300)).toBe('up')
    expect(probeState(200, 2500)).toBe('slow')
    expect(probeState(503, 100)).toBe('down')
    expect(probeState(0, 5000)).toBe('down')
  })
})
