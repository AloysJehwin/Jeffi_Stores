import { View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter, type Href } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, FileText, Gift, Heart, ImageOff, LogIn, LogOut, MapPin, Package, Receipt, Repeat, Search, Trash2, User, UserPlus,
} from 'lucide-react-native'
import { clearSearchHistory, getDashboard, getSearchHistory } from '../../src/api/account'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { openHref } from '../../src/lib/links'
import { accent, useTokens } from '../../src/theme'
import Gradient from '../../src/components/account/Gradient'
import BuyAgainRow from '../../src/components/account/BuyAgainRow'
import { DobNudge, useDobNudge } from '../../src/components/account/ProfileCard'
import { useAccountNavItems, useAccountUser, useSignOut } from '../../src/components/account/hooks'
import {
  Badge, BodySmall, Button, Card, Chip, ChipGroup, EmptyState, IconButton, ListGroup, ListRow, Screen, ScreenHeader, Section, statusTone, Text,
  Title, type IconComponent,
} from '../../src/ui'

// The account hub: the storefront's account page (controller-service app/(storefront)/account/page.tsx) as
// a hero and lists of rows into each account screen.

const DASH_LABEL: Record<string, string> = {
  cancel_requested: 'Cancel Requested',
  out_for_delivery: 'Out for Delivery',
  granted: 'Access granted',
  return_requested: 'Return Requested',
  return_approved: 'Return Approved',
  return_received: 'Return Received',
  return_rejected: 'Return Rejected',
}
// The dashboard colours fewer statuses than the orders page.
const DASH_TONE_KEYS = ['pending', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'granted', 'cancelled', 'cancel_requested', 'return_requested', 'returned']
const dashTone = (s: string) => (DASH_TONE_KEYS.includes(s) ? statusTone(s) : 'neutral')
const dashLabel = (s: string) => DASH_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

// The rows each nav item gets (useAccountNavItems decides which ones a user sees).
const ROWS: Record<string, { icon: IconComponent; route: Href; subtitle?: string; group: 'shop' | 'account'; tab?: boolean }> = {
  '/account/orders': { icon: Package, route: '/orders', subtitle: 'Track, return or review', group: 'shop' },
  '/account/subscriptions': { icon: Repeat, route: '/account/subscriptions', group: 'shop' },
  '/account/transactions': { icon: Receipt, route: '/account/transactions', subtitle: 'Payments and refunds', group: 'shop' },
  '/wishlist': { icon: Heart, route: '/(tabs)/wishlist', group: 'shop', tab: true },
  '/account': { icon: User, route: '/account/profile', group: 'account' },
  '/account/addresses': { icon: MapPin, route: '/account/addresses', group: 'account' },
  '/account/rewards': { icon: Gift, route: '/account/rewards', subtitle: 'Points, tiers and coupons', group: 'account' },
  '/account/referrals': { icon: UserPlus, route: '/account/referrals', subtitle: 'Invite friends, earn points', group: 'account' },
  '/account/quotes': { icon: FileText, route: '/account/quotes', subtitle: 'Your RFQ submissions', group: 'account' },
}

// A top-level page: back goes home.
function TopHeader() {
  const router = useRouter()
  return <ScreenHeader title="Account" large onBack={() => router.navigate('/(tabs)')} />
}

function SignedOut() {
  const router = useRouter()
  const config = useStoreConfig()
  return (
    <Screen header={<TopHeader />} mode="none">
      <View className="flex-1 justify-center px-4">
        <Card elevation="overlay" className="items-center">
          <Title className="text-center">Welcome Back</Title>
          <BodySmall className="mt-2 text-center">Login to your {config.identity.name || 'Jeffi Stores'} account</BodySmall>
          <View className="mt-6 self-stretch">
            <Button label="Sign In" icon={LogIn} onPress={() => router.push('/(auth)/login')} />
          </View>
          <Text className="mt-5 text-center text-sm text-foreground-secondary">
            Don&apos;t have an account?{' '}
            <Text accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.push('/(auth)/signup')}>
              Create one
            </Text>
          </Text>
        </Card>
      </View>
    </Screen>
  )
}

export default function AccountScreen() {
  const router = useRouter()
  const t = useTokens()
  const qc = useQueryClient()
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const user = useAccountUser()
  const signOut = useSignOut()
  const navItems = useAccountNavItems()
  const nudge = useDobNudge()

  const { data: dashboard } = useQuery({ queryKey: ['account-dashboard', user?.id ?? null], queryFn: getDashboard, enabled: !!user })
  const historyKey = ['search-history', user?.id ?? null]
  const { data: searchHistory = [] } = useQuery({ queryKey: historyKey, queryFn: getSearchHistory, enabled: !!user })

  if (!user) return <SignedOut />

  const spent = dashboard ? `₹${Number(dashboard.stats.total_spent).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
  const addr = dashboard?.defaultAddress
  const phone = user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : null
  const subtitles: Record<string, string | undefined> = {
    '/account': phone ?? 'Name, phone and date of birth',
    '/account/addresses': dashboard ? (addr ? `${addr.full_name} · ${addr.city} ${addr.postal_code}` : 'No default address saved') : undefined,
  }
  const rows = (group: 'shop' | 'account') =>
    navItems
      .filter(item => ROWS[item.href]?.group === group)
      .map(item => {
        const row = ROWS[item.href]
        return (
          <ListRow
            key={item.href}
            title={item.label}
            subtitle={subtitles[item.href] ?? row.subtitle}
            icon={row.icon}
            value={item.href === '/wishlist' && dashboard?.wishlistCount ? String(dashboard.wishlistCount) : undefined}
            onPress={() => (row.tab ? router.navigate(row.route) : router.push(row.route))}
          />
        )
      })

  return (
    <Screen header={<TopHeader />} padded={false} scrollProps={{ showsVerticalScrollIndicator: false }}>
      {/* Hero; -mt-4 cancels Screen's top padding so the band meets the header */}
      <View className="-mt-4 px-4 pb-6 pt-6">
        <Gradient from={dark ? accent[700] : accent[600]} to={dark ? accent[600] : accent[500]} />
        <View className="flex-row items-center gap-4">
          <View className="h-16 w-16 overflow-hidden rounded-2xl">
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <View className="h-full w-full items-center justify-center bg-white/20">
                <Text className="text-2xl font-bold text-white">{user.firstName?.[0]?.toUpperCase() || 'U'}</Text>
              </View>
            )}
          </View>
          <View className="flex-1">
            <Text className="font-display text-xl font-extrabold leading-7 text-white" numberOfLines={1}>
              {user.firstName} {user.lastName}
            </Text>
            <Text className="text-sm text-white/75" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
          <IconButton icon={LogOut} label="Sign out" variant="overlay" onPress={signOut} />
        </View>
        <View className="mt-5 flex-row gap-2">
          {[
            { value: String(dashboard?.stats.total_orders ?? '—'), label: 'Total Orders' },
            { value: spent, label: 'Total Spent' },
            { value: String(dashboard?.stats.active_orders ?? '—'), label: 'Active' },
          ].map(s => (
            <View key={s.label} className="flex-1 items-center rounded-2xl bg-white/15 px-2 py-3">
              <Text className="text-lg font-bold text-white" numberOfLines={1} adjustsFontSizeToFit>
                {s.value}
              </Text>
              <Text className="mt-0.5 text-[11px] font-medium text-white/75">{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Spacing comes from each block's mb-6 (Section has its own). */}
      <View className="px-4 pt-5">
        {nudge.show ? <DobNudge className="mb-6" onAdd={() => router.push('/account/profile')} onDismiss={nudge.dismiss} /> : null}

        <ListGroup title="Shopping" className="mb-6">
          {rows('shop')}
        </ListGroup>
        <ListGroup title="Your account" className="mb-6">
          {rows('account')}
          <ListRow title="Notifications" subtitle="Order updates, offers and alerts" icon={Bell} onPress={() => router.push('/account/notifications')} />
        </ListGroup>

        <Section title="Recent orders" actionLabel="View all" onAction={() => router.push('/orders')} gutter={false}>
          {!dashboard || dashboard.recentOrders.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Package}
                title="No orders yet"
                actionLabel="Start shopping"
                onAction={() => router.navigate('/(tabs)/products')}
              />
            </Card>
          ) : (
            <ListGroup>
              {dashboard.recentOrders.map(order => (
                <ListRow
                  key={order.id}
                  title={`${order.items[0]?.product_name ?? ''}${order.items.length > 1 ? ` +${order.items.length - 1} more` : ''}`}
                  subtitle={`#${order.order_number} · ${new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  chevron={false}
                  onPress={() => router.push(`/orders/${order.id}`)}
                  leading={
                    <View className="flex-row">
                      {order.items.slice(0, 3).map((item, i) => (
                        <View
                          key={i}
                          className="h-10 w-10 items-center justify-center overflow-hidden rounded-lg border-2 border-surface-elevated bg-surface"
                          style={{ marginLeft: i === 0 ? 0 : -12 }}
                        >
                          {item.thumbnail_url ? (
                            <Image source={{ uri: item.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          ) : (
                            <ImageOff size={18} color={t.foregroundMuted} />
                          )}
                        </View>
                      ))}
                    </View>
                  }
                  trailing={
                    <View className="items-end gap-1">
                      <Text className="text-sm font-semibold text-foreground">₹{Number(order.total_amount).toLocaleString('en-IN')}</Text>
                      <Badge label={dashLabel(order.status)} tone={dashTone(order.status)} size="sm" />
                    </View>
                  }
                />
              ))}
            </ListGroup>
          )}
        </Section>

        {searchHistory.length > 0 && (
          <Section
            title="Recent searches"
            actionLabel="Clear all"
            onAction={() => {
              clearSearchHistory()
              qc.setQueryData(historyKey, [])
            }}
            gutter={false}
          >
            <ChipGroup>
              {searchHistory.map(q => (
                <Chip key={q} size="sm" icon={Search} label={q} onPress={() => openHref(router, `/products?search=${encodeURIComponent(q)}`)} />
              ))}
            </ChipGroup>
          </Section>
        )}

        <BuyAgainRow />

        <ListGroup>
          <ListRow title="Sign Out" icon={LogOut} destructive chevron={false} onPress={signOut} />
          <ListRow title="Delete account" icon={Trash2} onPress={() => router.push('/account/delete')} />
        </ListGroup>
      </View>
    </Screen>
  )
}
