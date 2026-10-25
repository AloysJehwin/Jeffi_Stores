import { Linking, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Share2, UserPlus } from 'lucide-react-native'
import { getReferrals, type ReferralFriend, type ReferralsData } from '../../src/api/account'
import Gradient from '../../src/components/account/Gradient'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { InfiniteFooter } from '../../src/components/account/ui'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { SITE_URL } from '../../src/lib/links'
import { showToast } from '../../src/stores/toastStore'
import { accent, useTokens } from '../../src/theme'
import {
  Badge, BodySmall, Button, Caption, Card, cn, Divider, elevationClass, EmptyState, Heading, Overline, Screen, Skeleton, Text, TextButton, useElevation,
  type IconComponent, type Tone,
} from '../../src/ui'

// Mirror of controller-service components/visitor/AccountReferrals.tsx (mobile layout).

// The WhatsApp brand mark, shaped as an icon for Button.
const WhatsAppIcon: IconComponent = ({ size, color }) => <HeroIcon name="whatsapp" size={size} color={color ?? 'currentColor'} />

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function statusChip(f: ReferralFriend): { label: string; tone: Tone } {
  switch (f.status) {
    case 'rewarded':
      return { label: `Rewarded +${(f.points ?? 0).toLocaleString('en-IN')}`, tone: 'success' }
    case 'reversed':
      return { label: 'Order returned', tone: 'warning' }
    case 'capped':
      return { label: 'Yearly limit reached', tone: 'neutral' }
    case 'rejected':
      return { label: 'Not eligible', tone: 'neutral' }
    default:
      return f.hasOrdered ? { label: 'Order placed', tone: 'info' } : { label: 'Joined', tone: 'neutral' }
  }
}

function ShareCard({ data, storeName }: { data: ReferralsData; storeName: string }) {
  const shadow = useElevation('raised')
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
    <View className={cn('overflow-hidden rounded-panel p-4', elevationClass('raised'))} style={shadow}>
      {dark ? <Gradient from={accent[900]} to={accent[800]} fromOpacity={0.4} toOpacity={0.2} radius={20} /> : <Gradient from={accent[100]} to={accent[50]} radius={20} />}
      <Overline className="text-accent-700 dark:text-accent-300">Refer &amp; Earn</Overline>
      <Text className="mt-1 font-display text-xl font-extrabold leading-7 text-foreground">Invite friends, earn {points} points each</Text>
      <BodySmall className="mt-1">When a friend signs up with your link and their first order is delivered, the points are yours.</BodySmall>

      <View className="mt-4 flex-row items-center gap-2 rounded-field bg-surface-elevated py-1.5 pl-4 pr-1.5">
        <Text className="flex-1 font-mono text-[13px] text-foreground" numberOfLines={1}>
          {link}
        </Text>
        <Button label="Copy" icon={Copy} variant="secondary" size="sm" block={false} accessibilityLabel="Copy link" onPress={copy} />
      </View>

      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <Button label="WhatsApp" icon={WhatsAppIcon} variant="secondary" size="md" onPress={whatsapp} />
        </View>
        <View className="flex-1">
          <Button label="Share" icon={Share2} size="md" onPress={share} />
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
        <Caption>Or share your code</Caption>
        <View className="rounded-md bg-surface-elevated px-2 py-0.5">
          <Text className="font-mono text-xs font-semibold text-foreground">{data.code}</Text>
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
    <View className="flex-row flex-wrap overflow-hidden rounded-panel border border-border-default bg-border-default" style={{ gap: 1 }}>
      {tiles.map(tile => (
        <View key={tile.label} className="bg-surface-elevated px-4 py-3" style={{ width: '49.8%', flexGrow: 1 }}>
          <Text className="font-display text-xl font-extrabold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {tile.value.toLocaleString('en-IN')}
          </Text>
          <Caption>{tile.label}</Caption>
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
    <Card>
      <Heading>How it works</Heading>
      <View className="mt-3 gap-3">
        {steps.map((step, i) => (
          <View key={i} className="flex-row gap-3">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
              <Text className="text-xs font-bold text-accent-700 dark:text-accent-300">{i + 1}</Text>
            </View>
            <Text className="flex-1 pt-1 text-sm text-foreground-secondary">{step}</Text>
          </View>
        ))}
      </View>
      <Divider className="mb-3 mt-4" />
      <View className="gap-1.5">
        {notes.map(n => (
          <View key={n} className="flex-row gap-2 pl-1">
            <Text className="text-xs text-foreground-muted">•</Text>
            <Caption className="flex-1">{n}</Caption>
          </View>
        ))}
      </View>
      <TextButton label="See your points" onPress={() => router.push('/account/rewards')} className="mt-3" />
    </Card>
  )
}

// Share card, the 2x2 stats grid and the friends card, as loaded.
function ReferralsLoading() {
  return (
    <View className="gap-4">
      <View className="rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
        <Skeleton width={80} height={10} rounded="rounded" />
        <Skeleton width="85%" height={22} className="mt-2" />
        <Skeleton height={12} className="mt-2" />
        <Skeleton width="60%" height={12} className="mt-1.5" />
        <Skeleton height={52} rounded="rounded-field" className="mt-4" />
        <View className="mt-3 flex-row gap-2">
          <Skeleton height={48} rounded="rounded-field" className="flex-1" />
          <Skeleton height={48} rounded="rounded-field" className="flex-1" />
        </View>
        <Skeleton width={170} height={12} rounded="rounded" className="mt-3" />
      </View>
      <View className="flex-row flex-wrap overflow-hidden rounded-panel border border-border-default bg-border-default" style={{ gap: 1 }}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} className="gap-1.5 bg-surface-elevated px-4 py-3" style={{ width: '49.8%', flexGrow: 1 }}>
            <Skeleton width={40} height={22} />
            <Skeleton width={80} height={10} rounded="rounded" />
          </View>
        ))}
      </View>
      <View className="rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
        <Skeleton width={120} height={18} />
        <View className="mt-2">
          {[0, 1, 2].map(i => (
            <View key={i} className={`flex-row items-center justify-between gap-3 py-3 ${i > 0 ? 'border-t border-border-default' : ''}`}>
              <View className="flex-1 gap-1.5">
                <Skeleton width="55%" height={13} />
                <Skeleton width={110} height={10} rounded="rounded" />
              </View>
              <Skeleton width={84} height={24} rounded="rounded-full" />
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

export default function ReferralsScreen() {
  const router = useRouter()
  const t = useTokens()
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
    <Screen
      title="Refer & Earn"
      scrollProps={{
        scrollEventThrottle: 200,
        onScroll: e => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
          if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) friends.loadMore()
        },
      }}
    >
      {loading ? (
        <ReferralsLoading />
      ) : unavailable || !data ? (
        <EmptyState
          fill
          icon={UserPlus}
          title={failed ? 'Could not load your referrals' : 'Referrals are not available for this account'}
          actionLabel="Back to my account"
          onAction={() => router.navigate('/(tabs)/account')}
        />
      ) : (
        <View className="gap-4">
          <ShareCard data={data} storeName={config.identity.name} />
          <Stats data={data} />
          <Card>
            <Heading>Your friends</Heading>
            {friends.total === 0 && !friends.loading ? (
              <View className="mt-4 flex-row items-center gap-3 rounded-field bg-surface-secondary p-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
                  <Share2 size={18} color={t.accent600} />
                </View>
                <BodySmall className="flex-1">No one has joined with your link yet. Share it above to get started.</BodySmall>
              </View>
            ) : (
              <>
                <View className="mt-2">
                  {friends.rows.map((f, i) => {
                    const chip = statusChip(f)
                    return (
                      <View key={f.id}>
                        {i > 0 ? <Divider /> : null}
                        <View className="flex-row items-center justify-between gap-3 py-3">
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                              {f.name}
                            </Text>
                            <Caption>Joined {formatDate(f.signedUpAt)}</Caption>
                          </View>
                          <Badge label={chip.label} tone={chip.tone} />
                        </View>
                      </View>
                    )
                  })}
                </View>
                <InfiniteFooter shown={friends.rows.length} list={friends} noun="friends" />
              </>
            )}
          </Card>
          <HowItWorks program={data.program} />
        </View>
      )}
    </Screen>
  )
}
