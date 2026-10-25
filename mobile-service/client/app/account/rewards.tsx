import { useState } from 'react'
import { Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Gift } from 'lucide-react-native'
import { getAccountCoupons, getLoyalty, redeemPoints, type AccountCoupon, type RewardsData, type RewardsHistoryEntry } from '../../src/api/account'
import Gradient from '../../src/components/account/Gradient'
import { useInfiniteList, useRequireAuth, type InfiniteList } from '../../src/components/account/hooks'
import { InfiniteFooter } from '../../src/components/account/ui'
import { showToast } from '../../src/stores/toastStore'
import { couponTerms, formatExpiry } from '../../src/lib/coupons'
import {
  Badge, BodySmall, Button, Caption, Card, CardSegment, cn, Divider, elevationClass, EmptyState, Heading, Overline, Screen, SectionedList, Skeleton, Text, TextField, useElevation, type Tone,
} from '../../src/ui'

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
  const shadow = useElevation('raised')
  const tier = TIER_STYLES[data.tier.key] ?? TIER_STYLES.bronze
  const currentMin = data.program.tiers.find(x => x.key === data.tier.key)?.minPoints ?? 0
  const span = data.nextTier ? Math.max(1, data.nextTier.minPoints - currentMin) : 1
  const progress = data.nextTier ? Math.min(100, Math.max(0, ((Math.max(0, data.lifetimePoints) - currentMin) / span) * 100)) : 100

  return (
    <View className={cn('overflow-hidden rounded-panel', tier.bg, elevationClass('raised'))} style={shadow}>
      {dark ? <Gradient from="black" to="black" fromOpacity={0} toOpacity={0.25} /> : <Gradient from="white" to="white" fromOpacity={0} toOpacity={0.5} />}
      <View className="p-5">
        <View className="flex-row items-center justify-between gap-3">
          <View className="px-3 py-1 rounded-full bg-white/60 dark:bg-black/30">
            <Text className={`text-xs font-semibold ${tier.text}`}>{data.tier.name} tier</Text>
          </View>
          {data.tier.multiplier > 1 && <Text className={`text-xs font-medium opacity-80 ${tier.text}`}>{data.tier.multiplier}x points</Text>}
        </View>
        <Text className={`mt-4 font-display text-4xl font-extrabold ${tier.text}`} style={TABULAR}>
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
    <Card>
      <Heading>Redeem points</Heading>
      <BodySmall className="mt-1">
        Turn points into a coupon. Each point is worth {formatMoney(pointValue)}, from {minRedeemPoints.toLocaleString('en-IN')} points.
      </BodySmall>
      {canRedeem ? (
        <View className="mt-4 gap-3">
          <TextField
            label="Points to redeem"
            keyboardType="number-pad"
            value={input}
            onChangeText={v => setInput(v.replace(/\D/g, '').slice(0, 7))}
            placeholder={String(minRedeemPoints)}
            error={input !== '' && !valid ? (points > data.points ? 'You do not have that many points' : `Enter at least ${minRedeemPoints.toLocaleString('en-IN')} points`) : null}
          />
          <Button
            label={valid ? `Get ${formatMoney(points * pointValue)} coupon` : 'Get coupon'}
            loadingLabel="Creating coupon"
            loading={submitting}
            disabled={!valid}
            icon={Gift}
            size="md"
            onPress={redeem}
          />
        </View>
      ) : (
        <Text className="mt-4 text-sm text-foreground-muted">You need {(minRedeemPoints - Math.max(0, data.points)).toLocaleString('en-IN')} more points to redeem.</Text>
      )}
    </Card>
  )
}

// Coupons and points history are rows of one list; each section is a card sliced per row.
type RewardsSection = { key: 'coupons'; data: AccountCoupon[] } | { key: 'history'; data: RewardsHistoryEntry[] }

// No clipboard module in the app: the share sheet offers Copy.
const copyCode = (code: string) => Share.share({ message: code }).catch(() => showToast('Could not copy the code', 'error'))

const COUPON_STATUS: Record<AccountCoupon['status'], { label: string; tone: Tone }> = {
  usable: { label: 'Ready to use', tone: 'success' },
  used: { label: 'Used', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'danger' },
}
const COUPON_SOURCE: Record<AccountCoupon['source'], string> = { game: 'Won in the rewards game', loyalty: 'Redeemed points', store: 'From the store' }

// Mirror of controller-service components/visitor/account/AccountCoupons.tsx.
function CouponRow({ c }: { c: AccountCoupon }) {
  const router = useRouter()
  const usable = c.status === 'usable'
  const status = COUPON_STATUS[c.status]
  const source = c.source === 'store' ? (c.label ?? COUPON_SOURCE.store) : COUPON_SOURCE[c.source]
  const expiry = c.validUntil ? ` · ${new Date(c.validUntil) <= new Date() ? 'expired' : 'valid till'} ${formatExpiry(c.validUntil)}` : ''
  return (
    <View className="rounded-field border-2 border-dashed border-border-default px-4 py-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className={cn('font-mono font-semibold', usable ? 'text-foreground' : 'text-foreground-muted line-through')}>{c.code}</Text>
        <Badge label={status.label} tone={status.tone} size="sm" />
      </View>
      <Text className="mt-0.5 text-xs text-foreground-secondary">{couponTerms(c, { expiry: false })}</Text>
      <Text className="text-xs text-foreground-muted">{`${source}${expiry}`}</Text>
      {usable ? (
        <View className="mt-3 flex-row gap-2">
          <Button label="Copy" icon={Copy} variant="secondary" size="sm" block={false} accessibilityLabel={`Copy coupon ${c.code}`} onPress={() => copyCode(c.code)} />
          <Button
            label="Apply in cart"
            size="sm"
            block={false}
            accessibilityLabel={`Apply coupon ${c.code} in your cart`}
            onPress={() => router.navigate({ pathname: '/(tabs)/cart', params: { coupon: c.code } })}
          />
        </View>
      ) : null}
    </View>
  )
}

/** The coupons alone, when the points programme is off or not open to this account. */
function CouponsCard({ coupons }: { coupons: AccountCoupon[] }) {
  return (
    <Card>
      <Heading>Your coupons</Heading>
      <BodySmall className="mt-1">Apply one in your cart, or enter the code in the coupon box at checkout.</BodySmall>
      <View className="mt-4 gap-3">
        {coupons.map(c => (
          <CouponRow key={c.id} c={c} />
        ))}
      </View>
    </Card>
  )
}

function HistoryRow({ e }: { e: RewardsHistoryEntry }) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <View className="flex-1">
        <Text className="text-sm text-foreground">{historyLabel(e)}</Text>
        <Caption>{formatDate(e.createdAt)}</Caption>
      </View>
      <Text className={`text-sm font-semibold ${e.delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-secondary'}`} style={TABULAR}>
        {e.delta > 0 ? '+' : ''}
        {e.delta.toLocaleString('en-IN')}
      </Text>
    </View>
  )
}

function SectionTop({ section, history }: { section: RewardsSection; history: InfiniteList<RewardsHistoryEntry> }) {
  if (section.key === 'coupons') {
    return (
      <CardSegment position="top" className="px-4 pb-4 pt-4">
        <Heading>Your coupons</Heading>
        <BodySmall className="mt-1">Apply one in your cart, or enter the code in the coupon box at checkout.</BodySmall>
      </CardSegment>
    )
  }
  const empty = (history.total ?? 0) === 0 && !history.loading
  return (
    <CardSegment position="top" className={cn('px-4 pt-4', !empty && 'pb-3')}>
      <Heading>Points history</Heading>
      {empty ? <Text className="mt-3 text-sm text-foreground-muted">No points yet. They appear here after your first delivered order.</Text> : null}
    </CardSegment>
  )
}

function SectionBottom({ section, history }: { section: RewardsSection; history: InfiniteList<RewardsHistoryEntry> }) {
  if (section.key === 'coupons') return <CardSegment position="bottom" className="mb-4 px-4 pb-4">{null}</CardSegment>
  return (
    <CardSegment position="bottom" className="px-4 pb-4">
      <InfiniteFooter shown={history.rows.length} list={history} noun="entries" />
    </CardSegment>
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
    <Card>
      <Heading>How it works</Heading>
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
            <Overline key={h} className={i === 2 ? 'w-24' : 'flex-1 pr-4'}>
              {h}
            </Overline>
          ))}
        </View>
        {program.tiers.map(tier => {
          const b = TIER_BADGE[tier.key] ?? TIER_BADGE.bronze
          return (
            <View key={tier.key} className="flex-row items-center border-t border-border-default py-2.5">
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
    </Card>
  )
}

const SKELETON_CARD = 'rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default'

// Tier card, redeem card and points history, as loaded.
function RewardsLoading() {
  return (
    <View className="gap-4">
      <View className="rounded-panel bg-surface-elevated p-5 dark:border dark:border-border-default">
        <Skeleton width={90} height={24} rounded="rounded-full" />
        <Skeleton width={120} height={36} className="mt-4" />
        <Skeleton width="70%" height={13} className="mt-2" />
        <Skeleton height={8} rounded="rounded-full" className="mt-5" />
        <Skeleton width="60%" height={13} className="mt-2" />
      </View>
      <View className={SKELETON_CARD}>
        <Skeleton width={140} height={18} />
        <Skeleton height={12} className="mt-2" />
        <Skeleton width="55%" height={12} className="mt-1.5" />
        <Skeleton width={110} height={12} rounded="rounded" className="mt-4" />
        <Skeleton height={56} rounded="rounded-field" className="mt-2" />
        <Skeleton height={48} rounded="rounded-field" className="mt-3" />
      </View>
      <View className={SKELETON_CARD}>
        <Skeleton width={130} height={18} />
        <View className="mt-3">
          {[0, 1, 2].map(i => (
            <View key={i} className={`flex-row items-center justify-between gap-4 py-3 ${i > 0 ? 'border-t border-border-default' : ''}`}>
              <View className="flex-1 gap-1.5">
                <Skeleton width="65%" height={13} />
                <Skeleton width={80} height={10} rounded="rounded" />
              </View>
              <Skeleton width={36} height={13} />
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

export default function RewardsScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useRequireAuth()
  const uid = user?.id ?? null

  // Tier / stats come from page 1; history paginates.
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
  // Personal coupons don't depend on the points programme, so they show even when it is off.
  const couponsQ = useQuery({ queryKey: ['account-coupons', uid, 'all'], queryFn: () => getAccountCoupons(), enabled: !!user, retry: 0 })
  const coupons = couponsQ.data ?? []

  const data = summary.data
  const loading = !user || summary.isLoading
  const failed = summary.isError
  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['rewards', uid] })
    history.reload()
    qc.invalidateQueries({ queryKey: ['account-coupons', uid] })
  }

  const sections: RewardsSection[] = [
    ...(coupons.length === 0 ? [] : [{ key: 'coupons' as const, data: coupons }]),
    { key: 'history', data: (history.total ?? 0) === 0 && !history.loading ? [] : history.rows },
  ]

  if (loading || unavailable || !data) {
    return (
      <Screen title="Rewards">
        {loading || couponsQ.isLoading ? (
          <RewardsLoading />
        ) : !failed && coupons.length > 0 ? (
          <CouponsCard coupons={coupons} />
        ) : (
          <EmptyState
            fill
            icon={Gift}
            title={failed ? 'Could not load your rewards' : 'Rewards are not available for this account'}
            actionLabel="Back to my account"
            onAction={() => router.navigate('/(tabs)/account')}
          />
        )}
      </Screen>
    )
  }

  return (
    <Screen title="Rewards" mode="none">
      <SectionedList<AccountCoupon | RewardsHistoryEntry, RewardsSection>
        sections={sections}
        keyboard
        keyExtractor={item => ('code' in item ? `c-${item.code}` : `h-${item.id}`)}
        onEndReached={history.loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View className="mb-4 gap-4">
            <TierCard data={data} />
            <RedeemCard data={data} onRedeemed={reload} />
          </View>
        }
        renderSectionHeader={({ section }) => <SectionTop section={section} history={history} />}
        renderSectionFooter={({ section }) => <SectionBottom section={section} history={history} />}
        renderItem={({ item, index, section }) =>
          section.key === 'coupons' ? (
            <CardSegment className={cn('px-4', index > 0 && 'pt-3')}>
              <CouponRow c={item as AccountCoupon} />
            </CardSegment>
          ) : (
            <CardSegment className="px-4">
              {index > 0 ? <Divider /> : null}
              <HistoryRow e={item as RewardsHistoryEntry} />
            </CardSegment>
          )
        }
        ListFooterComponent={
          <View className="mt-4">
            <HowItWorks program={data.program} />
          </View>
        }
      />
    </Screen>
  )
}
