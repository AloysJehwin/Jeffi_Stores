import { useState } from 'react'
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import { getLoyalty, redeemPoints, type RewardCoupon, type RewardsData, type RewardsHistoryEntry } from '../../src/api/account'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import Gradient from '../../src/components/account/Gradient'
import { useInfiniteList, useRequireAuth, type InfiniteList } from '../../src/components/account/hooks'
import { InfiniteFooter, Pulse } from '../../src/components/account/ui'
import { showToast } from '../../src/stores/toastStore'
import { useTokens } from '../../src/theme'

// Mirror of controller-service components/visitor/AccountRewards.tsx (mobile layout).

// Web: bg-gradient-to-br from-<c>-200 to-<c>-100 → base colour + a fading white/black wash.
const TIER_STYLES: Record<string, { bg: string; text: string; bar: string }> = {
  bronze: { bg: 'bg-amber-200 dark:bg-amber-900/40', text: 'text-amber-900 dark:text-amber-200', bar: 'bg-amber-900 dark:bg-amber-200' },
  silver: { bg: 'bg-slate-200 dark:bg-slate-700/60', text: 'text-slate-800 dark:text-slate-100', bar: 'bg-slate-800 dark:bg-slate-100' },
  gold: { bg: 'bg-yellow-200 dark:bg-yellow-900/40', text: 'text-yellow-900 dark:text-yellow-200', bar: 'bg-yellow-900 dark:bg-yellow-200' },
  platinum: { bg: 'bg-indigo-200 dark:bg-indigo-900/40', text: 'text-indigo-900 dark:text-indigo-200', bar: 'bg-indigo-900 dark:bg-indigo-200' },
}

const TIER_BADGE: Record<string, { bg: string; text: string }> = {
  bronze: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300' },
  silver: { bg: 'bg-slate-200 dark:bg-slate-700/50', text: 'text-slate-700 dark:text-slate-200' },
  gold: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
  platinum: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300' },
}

const CARD = 'bg-surface-elevated rounded-xl border border-border-default p-5'
const SHADOW = { boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }
const TABULAR = { fontVariant: ['tabular-nums' as const] }

const formatMoney = (amount: number) =>
  amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function historyLabel(e: RewardsHistoryEntry): string {
  const order = e.orderNumber ? `order ${e.orderNumber}` : 'an order'
  switch (e.reason) {
    case 'order_earn':
      return `Points for ${order}`
    case 'order_reversal':
      return `Points taken back for ${order}`
    case 'redeem':
      return e.couponCode ? `Redeemed for coupon ${e.couponCode}` : 'Redeemed for a coupon'
    case 'redeem_refund':
      return e.couponCode ? `Points returned for coupon ${e.couponCode}` : 'Points returned'
    case 'referral':
      return 'Reward for referring a friend'
    case 'referral_reversal':
      return "Referral reward taken back (your friend's order was returned)"
    default:
      return 'Adjustment by the store'
  }
}

function TierCard({ data }: { data: RewardsData }) {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const tier = TIER_STYLES[data.tier.key] ?? TIER_STYLES.bronze
  const currentMin = data.program.tiers.find(x => x.key === data.tier.key)?.minPoints ?? 0
  const span = data.nextTier ? Math.max(1, data.nextTier.minPoints - currentMin) : 1
  const progress = data.nextTier ? Math.min(100, Math.max(0, ((Math.max(0, data.lifetimePoints) - currentMin) / span) * 100)) : 100

  return (
    <View className={`rounded-xl border border-border-default overflow-hidden ${tier.bg}`} style={SHADOW}>
      {dark ? <Gradient from="black" to="black" fromOpacity={0} toOpacity={0.25} /> : <Gradient from="white" to="white" fromOpacity={0} toOpacity={0.5} />}
      <View className="p-5">
        <View className="flex-row items-center justify-between gap-3">
          <View className="px-3 py-1 rounded-full bg-white/60 dark:bg-black/30">
            <Text className={`text-xs font-semibold ${tier.text}`}>{data.tier.name} tier</Text>
          </View>
          {data.tier.multiplier > 1 && <Text className={`text-xs font-medium opacity-80 ${tier.text}`}>{data.tier.multiplier}x points</Text>}
        </View>
        <Text className={`mt-4 text-4xl font-bold ${tier.text}`} style={TABULAR}>
          {Math.max(0, data.points).toLocaleString('en-IN')}
        </Text>
        <Text className={`text-sm opacity-80 ${tier.text}`}>points available, worth {formatMoney(Math.max(0, data.points) * data.program.pointValue)}</Text>
        <View className="mt-5">
          <View className="h-2 rounded-full bg-white/50 dark:bg-black/30 overflow-hidden">
            <View className={`h-full rounded-full opacity-70 ${tier.bar}`} style={{ width: `${progress}%` }} />
          </View>
          <Text className={`mt-2 text-sm opacity-80 ${tier.text}`}>
            {data.nextTier ? `${data.nextTier.pointsToGo.toLocaleString('en-IN')} more points to reach ${data.nextTier.name}` : 'You are at the highest tier'}
          </Text>
        </View>
        {data.pending.points > 0 && (
          <View className="mt-4 border-t border-black/10 dark:border-white/20 pt-3">
            <Text className={`text-sm opacity-80 ${tier.text}`}>
              {data.pending.points.toLocaleString('en-IN')} points on the way
              {data.pending.nextCreditAt ? `, the next from ${formatDate(data.pending.nextCreditAt)}` : ''}.
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

function RedeemCard({ data, onRedeemed }: { data: RewardsData; onRedeemed: () => void }) {
  const t = useTokens()
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
      const res = await redeemPoints(points)
      if (!res.ok) return showToast(res.data?.error || 'Could not redeem points', 'error')
      showToast(`Coupon ${res.data.code} is ready`, 'success')
      setInput('')
      onRedeemed()
    } catch {
      showToast('Could not redeem points', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className={CARD} style={SHADOW}>
      <Text className="font-semibold text-foreground">Redeem points</Text>
      <Text className="mt-1 text-sm text-foreground-secondary">
        Turn points into a coupon. Each point is worth {formatMoney(pointValue)}, from {minRedeemPoints.toLocaleString('en-IN')} points.
      </Text>
      {canRedeem ? (
        <View className="mt-4 gap-3">
          <View>
            <Text className="text-xs font-medium text-foreground-secondary mb-1">Points to redeem</Text>
            <TextInput
              keyboardType="number-pad"
              value={input}
              onChangeText={v => setInput(v.replace(/\D/g, '').slice(0, 7))}
              placeholder={String(minRedeemPoints)}
              placeholderTextColor={t.foregroundMuted}
              className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground"
            />
          </View>
          <Pressable onPress={redeem} disabled={!valid || submitting} className={`w-full px-4 py-2.5 rounded-lg bg-accent-500 items-center ${!valid || submitting ? 'opacity-50' : ''}`}>
            <Text className="text-white text-sm font-medium">{submitting ? 'Creating coupon' : valid ? `Get ${formatMoney(points * pointValue)} coupon` : 'Get coupon'}</Text>
          </Pressable>
          {input !== '' && !valid && (
            <Text className="text-xs text-red-600 dark:text-red-400">
              {points > data.points ? 'You do not have that many points' : `Enter at least ${minRedeemPoints.toLocaleString('en-IN')} points`}
            </Text>
          )}
        </View>
      ) : (
        <Text className="mt-4 text-sm text-foreground-muted">You need {(minRedeemPoints - Math.max(0, data.points)).toLocaleString('en-IN')} more points to redeem.</Text>
      )}
    </View>
  )
}

function CouponList({ list }: { list: InfiniteList<RewardCoupon> }) {
  if ((list.total ?? 0) === 0 && !list.loading) return null
  // No clipboard module in the app: the share sheet offers Copy.
  const copy = (code: string) => Share.share({ message: code }).catch(() => showToast('Could not copy the code', 'error'))
  return (
    <View className={CARD} style={SHADOW}>
      <Text className="font-semibold text-foreground">Your reward coupons</Text>
      <Text className="mt-1 text-sm text-foreground-secondary">Enter the code in the coupon box at checkout.</Text>
      <View className="mt-4 gap-3">
        {list.rows.map(c => (
          <View key={c.code} className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-default px-4 py-3">
            <View className="flex-1">
              <Text className="font-mono font-semibold text-foreground">{c.code}</Text>
              <Text className="text-xs text-foreground-secondary">
                {formatMoney(c.value)} off orders of {formatMoney(c.minPurchase)} or more
              </Text>
            </View>
            <Pressable onPress={() => copy(c.code)} className="px-3 py-1.5 rounded-lg border border-border-default">
              <Text className="text-sm text-foreground-secondary">Copy</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <InfiniteFooter shown={list.rows.length} list={list} noun="coupons" />
    </View>
  )
}

function History({ list }: { list: InfiniteList<RewardsHistoryEntry> }) {
  return (
    <View className={CARD} style={SHADOW}>
      <Text className="font-semibold text-foreground">Points history</Text>
      {(list.total ?? 0) === 0 && !list.loading ? (
        <Text className="mt-3 text-sm text-foreground-muted">No points yet. They appear here after your first delivered order.</Text>
      ) : (
        <>
          <View className="mt-3">
            {list.rows.map((e, i) => (
              <View key={e.id} className={`flex-row items-center justify-between gap-4 py-3 ${i > 0 ? 'border-t border-border-default' : ''}`}>
                <View className="flex-1">
                  <Text className="text-sm text-foreground">{historyLabel(e)}</Text>
                  <Text className="text-xs text-foreground-muted">{formatDate(e.createdAt)}</Text>
                </View>
                <Text className={`text-sm font-semibold ${e.delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-secondary'}`} style={TABULAR}>
                  {e.delta > 0 ? '+' : ''}
                  {e.delta.toLocaleString('en-IN')}
                </Text>
              </View>
            ))}
          </View>
          <InfiniteFooter shown={list.rows.length} list={list} noun="entries" />
        </>
      )}
    </View>
  )
}

function HowItWorks({ program }: { program: RewardsData['program'] }) {
  const points = [
    `Earn 1 point for every ${formatMoney(program.rupeesPerPoint)} you spend on online orders.`,
    program.creditDelayDays > 0 ? `Points are added ${program.creditDelayDays} days after your order is delivered.` : 'Points are added once your order is delivered.',
    'Returned or cancelled orders do not earn points.',
    'Your tier is based on all the points you have earned, and redeeming never lowers it.',
  ]
  return (
    <View className={CARD} style={SHADOW}>
      <Text className="font-semibold text-foreground">How it works</Text>
      <View className="mt-3 gap-1.5">
        {points.map(p => (
          <View key={p} className="flex-row gap-2 pl-1">
            <Text className="text-sm text-foreground-secondary">•</Text>
            <Text className="flex-1 text-sm text-foreground-secondary">{p}</Text>
          </View>
        ))}
      </View>
      <View className="mt-4">
        <View className="flex-row py-2">
          {['Tier', 'Points needed', 'Earning rate'].map((h, i) => (
            <Text key={h} className={`text-xs uppercase font-medium text-foreground-muted ${i === 2 ? 'w-24' : 'flex-1 pr-4'}`} style={{ letterSpacing: 0.3 }}>
              {h}
            </Text>
          ))}
        </View>
        {program.tiers.map(tier => {
          const b = TIER_BADGE[tier.key] ?? TIER_BADGE.bronze
          return (
            <View key={tier.key} className="flex-row items-center border-t border-border-default py-2">
              <View className="flex-1 pr-4 items-start">
                <View className={`px-2 py-0.5 rounded-full ${b.bg}`}>
                  <Text className={`text-xs font-medium ${b.text}`}>{tier.name}</Text>
                </View>
              </View>
              <Text className="flex-1 pr-4 text-sm text-foreground-secondary">{tier.minPoints.toLocaleString('en-IN')}</Text>
              <Text className="w-24 text-sm text-foreground-secondary">{tier.multiplier}x</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

export default function RewardsScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useRequireAuth()
  const uid = user?.id ?? null

  // Tier / stats come from page 1; history and coupons paginate independently.
  const summary = useQuery({ queryKey: ['rewards', uid, 1, 1], queryFn: () => getLoyalty(1, 1), enabled: !!user, retry: 0 })
  const fetchPage = (h: number, c: number) =>
    h === 1 && c === 1 ? qc.fetchQuery({ queryKey: ['rewards', uid, 1, 1], queryFn: () => getLoyalty(1, 1) }) : getLoyalty(h, c)
  const history = useInfiniteList<RewardsHistoryEntry>({
    key: ['rewards-history', uid],
    enabled: !!user,
    pageSize: 20,
    fetchPage: async p => {
      const d = await fetchPage(p, 1)
      return { rows: d.history.items, total: d.history.total }
    },
  })
  const coupons = useInfiniteList<RewardCoupon>({
    key: ['rewards-coupons', uid],
    enabled: !!user,
    pageSize: 20,
    fetchPage: async p => {
      const d = await fetchPage(1, p)
      return { rows: d.coupons.items, total: d.coupons.total }
    },
  })

  const data = summary.data
  const loading = !user || summary.isLoading
  const failed = summary.isError
  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['rewards', uid] })
    history.reload()
    coupons.reload()
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        scrollEventThrottle={200}
        onScroll={e => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
          if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) history.loadMore()
        }}
      >
        <AccountMobileHeader />
        <View className="px-4 pt-4">
          {loading ? (
            <View className="gap-4">
              <Pulse className="h-44 rounded-xl bg-surface-elevated border border-border-default" />
              <Pulse className="h-28 rounded-xl bg-surface-elevated border border-border-default" />
              <Pulse className="h-56 rounded-xl bg-surface-elevated border border-border-default" />
            </View>
          ) : unavailable || !data ? (
            <View className={`${CARD} items-center py-12`} style={SHADOW}>
              <Text className="text-foreground font-medium text-center">{failed ? 'Could not load your rewards' : 'Rewards are not available for this account'}</Text>
              <Pressable onPress={() => router.navigate('/(tabs)/account')} className="mt-3">
                <Text className="text-sm text-accent-600">Back to my account</Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-4">
              <TierCard data={data} />
              <RedeemCard data={data} onRedeemed={reload} />
              <CouponList list={coupons} />
              <History list={history} />
              <HowItWorks program={data.program} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
