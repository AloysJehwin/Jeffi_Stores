'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import Pagination from '@/components/visitor/ListPagination'

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

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

interface RewardsData {
  enabled: boolean
  eligible?: boolean
  tier: { key: string; name: string; multiplier: number }
  nextTier: { key: string; name: string; minPoints: number; pointsToGo: number } | null
  points: number
  lifetimePoints: number
  pending: { points: number; nextCreditAt: string | null }
  history: Page<HistoryEntry>
  coupons: Page<RewardCoupon>
  program: {
    rupeesPerPoint: number
    pointValue: number
    minRedeemPoints: number
    creditDelayDays: number
    tiers: Tier[]
  }
}

const TIER_STYLES: Record<string, string> = {
  bronze: 'from-amber-200 to-amber-100 text-amber-900 dark:from-amber-900/40 dark:to-amber-800/20 dark:text-amber-200',
  silver: 'from-slate-200 to-slate-100 text-slate-800 dark:from-slate-700/60 dark:to-slate-600/30 dark:text-slate-100',
  gold: 'from-yellow-200 to-amber-100 text-yellow-900 dark:from-yellow-900/40 dark:to-amber-800/20 dark:text-yellow-200',
  platinum: 'from-indigo-200 to-violet-100 text-indigo-900 dark:from-indigo-900/40 dark:to-violet-800/20 dark:text-indigo-200',
}

const TIER_BADGE: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
  gold: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
}

const CARD = 'bg-surface-elevated rounded-xl shadow-sm border border-border-default p-5 sm:p-6'

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
    // The linked order is the friend's, so its number is never shown to the referrer.
    case 'referral':
      return 'Reward for referring a friend'
    case 'referral_reversal':
      return "Referral reward taken back (your friend's order was returned)"
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
    <div className={`relative overflow-hidden rounded-xl border border-border-default shadow-sm bg-gradient-to-br ${TIER_STYLES[data.tier.key] ?? TIER_STYLES.bronze}`}>
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white/60 dark:bg-black/30">
            {data.tier.name} tier
          </span>
          {data.tier.multiplier > 1 && (
            <span className="text-xs font-medium opacity-80">{data.tier.multiplier}x points</span>
          )}
        </div>

        <p className="mt-4 text-4xl font-bold tabular-nums">{Math.max(0, data.points).toLocaleString('en-IN')}</p>
        <p className="text-sm opacity-80">
          points available, worth {formatMoney(Math.max(0, data.points) * data.program.pointValue)}
        </p>

        <div className="mt-5">
          <div className="h-2 rounded-full bg-white/50 dark:bg-black/30 overflow-hidden">
            <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-sm opacity-80">
            {data.nextTier
              ? `${data.nextTier.pointsToGo.toLocaleString('en-IN')} more points to reach ${data.nextTier.name}`
              : 'You are at the highest tier'}
          </p>
        </div>

        {data.pending.points > 0 && (
          <p className="mt-4 text-sm opacity-80 border-t border-current/20 pt-3">
            {data.pending.points.toLocaleString('en-IN')} points on the way
            {data.pending.nextCreditAt ? `, the next from ${formatDate(data.pending.nextCreditAt)}` : ''}.
          </p>
        )}
      </div>
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
        <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="sm:flex-1">
            <label htmlFor="redeem-points" className="block text-xs font-medium text-foreground-secondary mb-1">
              Points to redeem
            </label>
            <input
              id="redeem-points"
              inputMode="numeric"
              value={input}
              onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 7))}
              placeholder={String(minRedeemPoints)}
              className="w-full sm:w-40 px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>
          <button
            type="button"
            onClick={redeem}
            disabled={!valid || submitting}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
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

function CouponList({
  coupons,
  onPage,
  busy,
}: {
  coupons: Page<RewardCoupon>
  onPage: (page: number) => void
  busy: boolean
}) {
  const { showToast } = useToast()
  if (coupons.total === 0) return null

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
        {coupons.items.map(coupon => (
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
      <Pagination
        page={coupons.page}
        total={coupons.total}
        pageSize={coupons.pageSize}
        onChange={onPage}
        busy={busy}
      />
    </div>
  )
}

function HowItWorks({ program }: { program: RewardsData['program'] }) {
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">How it works</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-foreground-secondary list-disc pl-5">
        <li>Earn 1 point for every {formatMoney(program.rupeesPerPoint)} you spend on online orders.</li>
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
                <td className="py-2 pr-4">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TIER_BADGE[tier.key] ?? TIER_BADGE.bronze}`}>
                    {tier.name}
                  </span>
                </td>
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

function History({
  history,
  onPage,
  busy,
}: {
  history: Page<HistoryEntry>
  onPage: (page: number) => void
  busy: boolean
}) {
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Points history</h2>
      {history.total === 0 ? (
        <p className="mt-3 text-sm text-foreground-muted">
          No points yet. They appear here after your first delivered order.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border-default">
            {history.items.map(entry => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm text-foreground">{historyLabel(entry)}</p>
                  <p className="text-xs text-foreground-muted">{formatDate(entry.createdAt)}</p>
                </div>
                <span
                  className={`text-sm font-semibold whitespace-nowrap tabular-nums ${
                    entry.delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-secondary'
                  }`}
                >
                  {entry.delta > 0 ? '+' : ''}
                  {entry.delta.toLocaleString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
          <Pagination
            page={history.page}
            total={history.total}
            pageSize={history.pageSize}
            onChange={onPage}
            busy={busy}
          />
        </>
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
  const [historyPage, setHistoryPage] = useState(1)
  const [couponPage, setCouponPage] = useState(1)
  const [paging, setPaging] = useState(false)

  const load = useCallback(
    async (opts: { historyPage?: number; couponPage?: number; silent?: boolean } = {}) => {
      const hp = opts.historyPage ?? 1
      const cp = opts.couponPage ?? 1
      if (opts.silent) setPaging(true)
      try {
        const res = await fetch(`/api/user/loyalty?historyPage=${hp}&couponPage=${cp}`)
        if (!res.ok) throw new Error('load failed')
        setData(await res.json())
        setHistoryPage(hp)
        setCouponPage(cp)
        setFailed(false)
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
        setPaging(false)
      }
    },
    []
  )

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
      <div className="container mx-auto px-4 pt-4 pb-10 max-w-5xl">
        {authLoading || loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-44 rounded-xl bg-surface-elevated border border-border-default" />
            <div className="h-28 rounded-xl bg-surface-elevated border border-border-default" />
            <div className="h-56 rounded-xl bg-surface-elevated border border-border-default" />
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
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <div className="space-y-4 lg:col-span-2">
              <TierCard data={data} />
              <RedeemCard data={data} onRedeemed={() => load({ historyPage, couponPage })} />
              <CouponList
                coupons={data.coupons}
                busy={paging}
                onPage={cp => load({ historyPage, couponPage: cp, silent: true })}
              />
              <History
                history={data.history}
                busy={paging}
                onPage={hp => load({ historyPage: hp, couponPage, silent: true })}
              />
            </div>
            <div className="lg:sticky lg:top-4">
              <HowItWorks program={data.program} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
