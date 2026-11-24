import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { chargedAt, cyclePaise, effectivePaise, lineLabels, listLines, monthlyTotal, paymentMethodsFor, type LineKind, type LineStatus, type PaymentMethod } from './lines'
import { currentSubscription, pendingReplacement, type BillingSubscription } from './subscription'

// What the owner's Billing page (and GET /api/ecom/billing/subscription) shows about the workspace's subscription.

export interface OverviewLine {
  id: string
  kind: LineKind
  ref: string
  label: string
  status: LineStatus
  /** Monthly, after the store's included site and any lower price that has started. */
  amountPaise: number
  /** A lower price from changesAt. */
  nextAmountPaise: number | null
  changesAt: string | null
  trialEndsAt: string | null
  endsAt: string | null
  graceUntil: string | null
}

export interface OverviewSubscription {
  id: string
  status: string
  interval: 'monthly' | 'yearly'
  amountPaise: number
  currentEnd: string | null
  startAt: string | null
  paymentMethod: string | null
  graceUntil: string | null
  checkoutUrl: string | null
}

export interface BillingOverview {
  current: OverviewSubscription | null
  /** A change waiting for the owner's approval. */
  pending: (OverviewSubscription & { upfrontPaise: number }) | null
  lines: OverviewLine[]
  monthlyPaise: number
  cyclePaise: number
  methods: PaymentMethod[]
  /** Lines still paid from the wallet: the owner should subscribe (/dashboard/billing/subscribe). */
  legacy: number
  charges: { paymentId: string; amountPaise: number; refundedPaise: number; chargedAt: string; periodEnd: string | null }[]
}

const view = (s: BillingSubscription): OverviewSubscription => ({
  id: s.id,
  status: s.status,
  interval: s.interval,
  amountPaise: s.amountPaise,
  currentEnd: s.currentEnd,
  startAt: s.startAt,
  paymentMethod: s.paymentMethod,
  graceUntil: s.graceUntil,
  checkoutUrl: s.status === 'created' || s.status === 'halted' || s.status === 'pending' ? s.checkoutUrl : null,
})

export async function billingOverview(tenantId: string): Promise<BillingOverview> {
  const [lines, current, pending, charges] = await Promise.all([
    listLines(tenantId),
    currentSubscription(tenantId),
    pendingReplacement(tenantId),
    controlPlanePool()
      .query(
        `SELECT razorpay_payment_id, amount_paise, refunded_paise, charged_at, period_end FROM billing_charges WHERE tenant_id = $1 ORDER BY charged_at DESC LIMIT 12`,
        [tenantId]
      )
      .catch(() => ({ rows: [] as any[] })),
  ])
  const label = await lineLabels(tenantId, lines)
  const at = Date.now()
  const interval = current?.interval ?? 'monthly'
  const monthly = monthlyTotal(lines, at)
  return {
    current: current ? view(current) : null,
    pending: pending ? { ...view(pending), checkoutUrl: pending.checkoutUrl, upfrontPaise: pending.upfrontPaise } : null,
    lines: lines.map(l => ({
      id: l.id,
      kind: l.kind,
      ref: l.ref,
      label: label(l),
      status: l.status,
      amountPaise: chargedAt(l, at) || l.status === 'trial' ? effectivePaise(l, lines, at) : l.amountPaise,
      nextAmountPaise: l.nextAmountPaise,
      changesAt: l.changesAt,
      trialEndsAt: l.trialEndsAt,
      endsAt: l.endsAt,
      graceUntil: l.graceUntil,
    })),
    monthlyPaise: monthly,
    cyclePaise: cyclePaise(monthly, interval),
    methods: paymentMethodsFor(),
    legacy: lines.filter(l => l.status === 'legacy_wallet').length,
    charges: charges.rows.map((c: any) => ({
      paymentId: c.razorpay_payment_id,
      amountPaise: Number(c.amount_paise),
      refundedPaise: Number(c.refunded_paise),
      chargedAt: new Date(c.charged_at).toISOString(),
      periodEnd: c.period_end ? new Date(c.period_end).toISOString() : null,
    })),
  }
}
