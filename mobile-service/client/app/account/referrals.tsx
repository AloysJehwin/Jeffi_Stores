import { Linking, Pressable, ScrollView, Share, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import { getReferrals, type ReferralFriend, type ReferralsData } from '../../src/api/account'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import Gradient from '../../src/components/account/Gradient'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { InfiniteFooter, Pulse } from '../../src/components/account/ui'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { SITE_URL } from '../../src/lib/links'
import { showToast } from '../../src/stores/toastStore'
import { accent, useTokens } from '../../src/theme'

// Mirror of controller-service components/visitor/AccountReferrals.tsx (mobile layout).

const CARD = 'bg-surface-elevated rounded-xl border border-border-default p-5'
const SHADOW = { boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const CHIP = {
  green: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  amber: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300' },
  blue: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  neutral: { bg: 'bg-surface-secondary', text: 'text-foreground-secondary' },
  muted: { bg: 'bg-surface-secondary', text: 'text-foreground-muted' },
}

function statusChip(f: ReferralFriend): { label: string; tone: { bg: string; text: string } } {
  switch (f.status) {
    case 'rewarded':
      return { label: `Rewarded +${(f.points ?? 0).toLocaleString('en-IN')}`, tone: CHIP.green }
    case 'reversed':
      return { label: 'Order returned', tone: CHIP.amber }
    case 'capped':
      return { label: 'Yearly limit reached', tone: CHIP.neutral }
    case 'rejected':
      return { label: 'Not eligible', tone: CHIP.muted }
    default:
      return f.hasOrdered ? { label: 'Order placed', tone: CHIP.blue } : { label: 'Joined', tone: CHIP.neutral }
  }
}

function ShareCard({ data, storeName }: { data: ReferralsData; storeName: string }) {
  const t = useTokens()
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const link = `${SITE_URL}/r/${data.code}`
  const message = `I shop at ${storeName}. Create your account with my link: ${link}`
  const points = data.program.rewardPoints.toLocaleString('en-IN')

  // No clipboard module in the app: the share sheet offers Copy.
  const copy = () => Share.share({ message: link }).catch(() => showToast('Could not copy the link', 'error'))
  const share = () => Share.share({ title: storeName, message }).catch(() => {})
  const whatsapp = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`).catch(() => {})

  return (
    <View className="rounded-xl border border-border-default p-4 overflow-hidden" style={SHADOW}>
      {dark ? <Gradient from={accent[900]} to={accent[800]} fromOpacity={0.4} toOpacity={0.2} radius={12} /> : <Gradient from={accent[100]} to={accent[50]} radius={12} />}
      <Text className="text-xs font-semibold uppercase text-accent-700 dark:text-accent-300" style={{ letterSpacing: 0.3 }}>
        Refer &amp; Earn
      </Text>
      <Text className="mt-1 text-lg font-bold leading-snug text-foreground">Invite friends, earn {points} points each</Text>
      <Text className="mt-1 text-sm text-foreground-secondary">When a friend signs up with your link and their first order is delivered, the points are yours.</Text>

      <View className="mt-4 flex-row items-center gap-2 rounded-lg bg-surface-elevated border border-border-default pl-3 pr-1.5 py-1.5">
        <Text className="flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
          {link}
        </Text>
        <Pressable onPress={copy} accessibilityLabel="Copy link" className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-default">
          <HeroIcon name="copy" size={16} color={t.foregroundSecondary} />
          <Text className="text-xs font-medium text-foreground-secondary">Copy</Text>
        </Pressable>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable onPress={whatsapp} className="flex-1 flex-row items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-green-600">
          <HeroIcon name="whatsapp" size={16} color="white" />
          <Text className="text-white text-sm font-medium">WhatsApp</Text>
        </Pressable>
        <Pressable onPress={share} className="flex-1 flex-row items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent-500">
          <HeroIcon name="share" size={16} color="white" />
          <Text className="text-white text-sm font-medium">Share</Text>
        </Pressable>
      </View>

      <View className="mt-3 flex-row items-center flex-wrap gap-1">
        <Text className="text-xs text-foreground-muted">Or share your code</Text>
        <View className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border-default">
          <Text className="font-mono font-semibold text-xs text-foreground">{data.code}</Text>
        </View>
      </View>
    </View>
  )
}

function Stats({ data }: { data: ReferralsData }) {
  const joined = data.counts.joined + data.counts.rewarded + data.counts.reversed + data.counts.capped
  const tiles = [
    { label: 'Friends joined', value: joined },
    { label: 'Rewarded', value: data.counts.rewarded },
    { label: 'Points earned', value: data.pointsEarned },
    { label: 'Left this year', value: data.rewardsLeftThisYear },
  ]
  return (
    <View className="flex-row flex-wrap rounded-xl border border-border-default bg-border-default overflow-hidden" style={{ gap: 1 }}>
      {tiles.map(tile => (
        <View key={tile.label} className="bg-surface-elevated px-4 py-3" style={{ width: '49.8%', flexGrow: 1 }}>
          <Text className="text-xl font-bold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {tile.value.toLocaleString('en-IN')}
          </Text>
          <Text className="text-xs text-foreground-secondary">{tile.label}</Text>
        </View>
      ))}
    </View>
  )
}

function HowItWorks({ program }: { program: ReferralsData['program'] }) {
  const router = useRouter()
  const points = program.rewardPoints.toLocaleString('en-IN')
  const steps = [
    'Share your link with a friend who has not shopped with us before.',
    'They create an account using your link.',
    `When their first online order is delivered (within ${program.qualifyDays} days of signing up), you get ${points} points.`,
  ]
  const notes = [
    `You can earn up to ${program.yearlyCap} referral rewards a year.`,
    'If your friend returns or cancels that order, the points are taken back.',
    'Referral points can be spent like any other points but do not count toward your tier.',
    'Signing up yourself with your own link, phone number or device does not count.',
  ]
  return (
    <View className={CARD} style={SHADOW}>
      <Text className="font-semibold text-foreground">How it works</Text>
      <View className="mt-3 gap-3">
        {steps.map((step, i) => (
          <View key={i} className="flex-row gap-3">
            <View className="h-6 w-6 rounded-full bg-accent-100 dark:bg-accent-900/40 items-center justify-center">
              <Text className="text-xs font-semibold text-accent-700 dark:text-accent-300">{i + 1}</Text>
            </View>
            <Text className="flex-1 pt-0.5 text-sm text-foreground-secondary">{step}</Text>
          </View>
        ))}
      </View>
      <View className="mt-4 gap-1.5 border-t border-border-default pt-3">
        {notes.map(n => (
          <View key={n} className="flex-row gap-2 pl-1">
            <Text className="text-xs text-foreground-muted">•</Text>
            <Text className="flex-1 text-xs text-foreground-muted">{n}</Text>
          </View>
        ))}
      </View>
      <Pressable onPress={() => router.push('/account/rewards')} className="mt-4 self-start">
        <Text className="text-sm font-medium text-accent-600">See your points</Text>
      </Pressable>
    </View>
  )
}

export default function ReferralsScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useRequireAuth()
  const config = useStoreConfig()
  const key = ['referrals', user?.id ?? null]

  // Stats come from page 1; the friends list paginates the same payload.
  const summary = useQuery({ queryKey: [...key, 1], queryFn: () => getReferrals(1), enabled: !!user, retry: 0 })
  const friends = useInfiniteList<ReferralFriend>({
    key: [...key, 'friends'],
    enabled: !!user,
    pageSize: 20,
    fetchPage: async p => {
      const d = p === 1 ? await qc.fetchQuery({ queryKey: [...key, 1], queryFn: () => getReferrals(1) }) : await getReferrals(p)
      return { rows: d.friends.items, total: d.friends.total }
    },
  })

  const data = summary.data
  const loading = !user || summary.isLoading
  const failed = summary.isError
  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        scrollEventThrottle={200}
        onScroll={e => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
          if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) friends.loadMore()
        }}
      >
        <AccountMobileHeader />
        <View className="px-4 pt-4">
          {loading ? (
            <View className="gap-4">
              <Pulse className="h-44 rounded-xl bg-surface-elevated border border-border-default" />
              <Pulse className="h-20 rounded-xl bg-surface-elevated border border-border-default" />
              <Pulse className="h-56 rounded-xl bg-surface-elevated border border-border-default" />
            </View>
          ) : unavailable || !data ? (
            <View className={`${CARD} items-center py-12`} style={SHADOW}>
              <Text className="text-foreground font-medium text-center">{failed ? 'Could not load your referrals' : 'Referrals are not available for this account'}</Text>
              <Pressable onPress={() => router.navigate('/(tabs)/account')} className="mt-3">
                <Text className="text-sm text-accent-600">Back to my account</Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-4">
              <ShareCard data={data} storeName={config.identity.name} />
              <Stats data={data} />
              <View className={CARD} style={SHADOW}>
                <Text className="font-semibold text-foreground">Your friends</Text>
                {friends.total === 0 && !friends.loading ? (
                  <View className="mt-4 flex-row items-center gap-3 rounded-lg bg-surface-secondary p-3">
                    <View className="h-9 w-9 rounded-full bg-accent-100 dark:bg-accent-900/40 items-center justify-center">
                      <HeroIcon name="share" size={16} color={accent[700]} />
                    </View>
                    <Text className="flex-1 text-sm text-foreground-secondary">No one has joined with your link yet. Share it above to get started.</Text>
                  </View>
                ) : (
                  <>
                    <View className="mt-2">
                      {friends.rows.map((f, i) => {
                        const chip = statusChip(f)
                        return (
                          <View key={f.id} className={`flex-row items-center justify-between gap-3 py-3 ${i > 0 ? 'border-t border-border-default' : ''}`}>
                            <View className="flex-1">
                              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                                {f.name}
                              </Text>
                              <Text className="text-xs text-foreground-muted">Joined {formatDate(f.signedUpAt)}</Text>
                            </View>
                            <View className={`px-2.5 py-1 rounded-full ${chip.tone.bg}`}>
                              <Text className={`text-xs font-medium ${chip.tone.text}`}>{chip.label}</Text>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                    <InfiniteFooter shown={friends.rows.length} list={friends} noun="friends" />
                  </>
                )}
              </View>
              <HowItWorks program={data.program} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
