'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'

interface Tier {
  key: string
  name: string
  minPoints: number
  multiplier: number
}

interface HistoryEntry {
  id: string
  delta: number
  reason: string
  orderNumber: string | null
  couponCode: string | null
  createdAt: string
}

interface RewardCoupon {
  code: string
  value: number
  minPurchase: number
  createdAt: string
}

interface RewardsData {
  enabled: boolean
  eligible?: boolean
  tier: { key: string; name: string; multiplier: number }
  nextTier: { key: string; name: string; minPoints: number; pointsToGo: number } | null
  points: number
  lifetimePoints: number
  pending: { points: number; nextCreditAt: string | null }
  history: HistoryEntry[]
  coupons: RewardCoupon[]
  program: {
    rupeesPerPoint: number
    pointValue: number
    minRedeemPoints: number
    creditDelayDays: number
    tiers: Tier[]
  }
}

const TIER_STYLES: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
  gold: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
}

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5'

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function historyLabel(entry: HistoryEntry): string {
  const order = entry.orderNumber ? `order ${entry.orderNumber}` : 'an order'
  switch (entry.reason) {
    case 'order_earn':
      return `Points for ${order}`
    case 'order_reversal':
      return `Points taken back for ${order}`
    case 'redeem':
      return entry.couponCode ? `Redeemed for coupon ${entry.couponCode}` : 'Redeemed for a coupon'
    case 'redeem_refund':
      return entry.couponCode ? `Points returned for coupon ${entry.couponCode}` : 'Points returned'
    default:
      return 'Adjustment by the store'
  }
}

function TierCard({ data }: { data: RewardsData }) {
  const currentMin = data.program.tiers.find(tier => tier.key === data.tier.key)?.minPoints ?? 0
  const span = data.nextTier ? Math.max(1, data.nextTier.minPoints - currentMin) : 1
  const progress = data.nextTier
    ? Math.min(100, Math.max(0, ((Math.max(0, data.lifetimePoints) - currentMin) / span) * 100))
    : 100

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span
            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${TIER_STYLES[data.tier.key] ?? TIER_STYLES.bronze}`}
          >
            {data.tier.name}
          </span>
          <p className="mt-3 text-3xl font-bold text-foreground">{data.points.toLocaleString('en-IN')}</p>
          <p className="text-sm text-foreground-secondary">
            points, worth {formatMoney(Math.max(0, data.points) * data.program.pointValue)}
          </p>
        </div>
        {data.tier.multiplier > 1 && (
          <p className="text-sm text-foreground-secondary">You earn {data.tier.multiplier}x points on every order</p>
        )}
      </div>

      <div className="mt-5">
        <div className="h-2 rounded-full bg-surface-secondary overflow-hidden">
          <div className="h-full bg-accent-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-sm text-foreground-secondary">
          {data.nextTier
            ? `${data.nextTier.pointsToGo.toLocaleString('en-IN')} more points to reach ${data.nextTier.name}`
            : 'You are at the highest tier'}
        </p>
      </div>

      {data.pending.points > 0 && (
        <p className="mt-4 text-sm text-foreground-secondary border-t border-border-default pt-3">
          {data.pending.points.toLocaleString('en-IN')} points are on the way
          {data.pending.nextCreditAt ? `, the next from ${formatDate(data.pending.nextCreditAt)}` : ''}.
        </p>
      )}
    </div>
  )
}

function RedeemCard({ data, onRedeemed }: { data: RewardsData; onRedeemed: () => void }) {
  const { showToast } = useToast()
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { minRedeemPoints, pointValue } = data.program
  const points = /^\d+$/.test(input) ? parseInt(input, 10) : 0
  const canRedeem = data.points >= minRedeemPoints
  const valid = points >= minRedeemPoints && points <= data.points

  const redeem = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/user/loyalty/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(body?.error || 'Could not redeem points', 'error')
        return
      }
      showToast(`Coupon ${body.code} is ready`, 'success')
      setInput('')
      onRedeemed()
    } catch {
      showToast('Could not redeem points', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Redeem points</h2>
      <p className="mt-1 text-sm text-foreground-secondary">
        Turn points into a coupon. Each point is worth {formatMoney(pointValue)}, from{' '}
        {minRedeemPoints.toLocaleString('en-IN')} points.
      </p>
      {canRedeem ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="redeem-points" className="block text-xs font-medium text-foreground-secondary mb-1">
              Points to redeem
            </label>
            <input
              id="redeem-points"
              inputMode="numeric"
              value={input}
              onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 7))}
              placeholder={String(minRedeemPoints)}
              className="w-36 px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>
          <button
            type="button"
            onClick={redeem}
            disabled={!valid || submitting}
            className="px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating coupon' : valid ? `Get ${formatMoney(points * pointValue)} coupon` : 'Get coupon'}
          </button>
          {input !== '' && !valid && (
            <p className="w-full text-xs text-red-600 dark:text-red-400">
              {points > data.points
                ? 'You do not have that many points'
                : `Enter at least ${minRedeemPoints.toLocaleString('en-IN')} points`}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-foreground-muted">
          You need {(minRedeemPoints - Math.max(0, data.points)).toLocaleString('en-IN')} more points to redeem.
        </p>
      )}
    </div>
  )
}

function CouponList({ coupons }: { coupons: RewardCoupon[] }) {
  const { showToast } = useToast()
  if (coupons.length === 0) return null

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      showToast('Coupon code copied', 'success')
    } catch {
      showToast('Could not copy the code', 'error')
    }
  }

  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Your reward coupons</h2>
      <p className="mt-1 text-sm text-foreground-secondary">Enter the code in the coupon box at checkout.</p>
      <ul className="mt-4 space-y-3">
        {coupons.map(coupon => (
          <li
            key={coupon.code}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-default px-4 py-3"
          >
            <div>
              <p className="font-mono font-semibold text-foreground">{coupon.code}</p>
              <p className="text-xs text-foreground-secondary">
                {formatMoney(coupon.value)} off orders of {formatMoney(coupon.minPurchase)} or more
              </p>
            </div>
            <button
              type="button"
              onClick={() => copy(coupon.code)}
              className="px-3 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary"
            >
              Copy
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HowItWorks({ program }: { program: RewardsData['program'] }) {
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">How it works</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-foreground-secondary list-disc pl-5">
        <li>Earn 1 point for every {formatMoney(program.rupeesPerPoint)} you spend on products.</li>
        <li>
          {program.creditDelayDays > 0
            ? `Points are added ${program.creditDelayDays} days after your order is delivered.`
            : 'Points are added once your order is delivered.'}
        </li>
        <li>Returned or cancelled orders do not earn points.</li>
        <li>Your tier is based on all the points you have earned, and redeeming never lowers it.</li>
      </ul>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
              <th className="py-2 pr-4 font-medium">Tier</th>
              <th className="py-2 pr-4 font-medium">Points needed</th>
              <th className="py-2 font-medium">Earning rate</th>
            </tr>
          </thead>
          <tbody>
            {program.tiers.map(tier => (
              <tr key={tier.key} className="border-t border-border-default text-foreground-secondary">
                <td className="py-2 pr-4 text-foreground">{tier.name}</td>
                <td className="py-2 pr-4">{tier.minPoints.toLocaleString('en-IN')}</td>
                <td className="py-2">{tier.multiplier}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Points history</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-foreground-muted">
          No points yet. They appear here after your first delivered order.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-default">
          {entries.map(entry => (
            <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm text-foreground">{historyLabel(entry)}</p>
                <p className="text-xs text-foreground-muted">{formatDate(entry.createdAt)}</p>
              </div>
              <span
                className={`text-sm font-semibold whitespace-nowrap ${
                  entry.delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-secondary'
                }`}
              >
                {entry.delta > 0 ? '+' : ''}
                {entry.delta.toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AccountRewards() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<RewardsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/user/loyalty')
      if (!res.ok) throw new Error('load failed')
      setData(await res.json())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login?redirect=/account/rewards')
      return
    }
    load()
  }, [user, authLoading, router, load])

  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)

  return (
    <div className="bg-surface min-h-screen">
      <AccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-8">
        {authLoading || loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-40 rounded-lg bg-surface-elevated border border-border-default" />
            <div className="h-28 rounded-lg bg-surface-elevated border border-border-default" />
            <div className="h-56 rounded-lg bg-surface-elevated border border-border-default" />
          </div>
        ) : unavailable || !data ? (
          <div className={`${CARD} text-center py-12`}>
            <p className="text-foreground font-medium">
              {failed ? 'Could not load your rewards' : 'Rewards are not available for this account'}
            </p>
            <Link href="/account" className="mt-3 inline-block text-sm text-accent-600 hover:text-accent-700">
              Back to my account
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <TierCard data={data} />
              <RedeemCard data={data} onRedeemed={load} />
              <CouponList coupons={data.coupons} />
              <History entries={data.history} />
            </div>
            <div>
              <HowItWorks program={data.program} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
