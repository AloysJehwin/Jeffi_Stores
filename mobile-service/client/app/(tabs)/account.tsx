import { Pressable, ScrollView, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import { clearSearchHistory, getDashboard, getSearchHistory } from '../../src/api/account'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { openHref } from '../../src/lib/links'
import { accent, status, useTokens } from '../../src/theme'
import HeroIcon from '../../src/components/account/HeroIcon'
import Gradient from '../../src/components/account/Gradient'
import ProfileCard from '../../src/components/account/ProfileCard'
import BuyAgainRow from '../../src/components/account/BuyAgainRow'
import { AccountMobileTabBar } from '../../src/components/account/AccountMobileHeader'
import { useAccountUser, useSignOut } from '../../src/components/account/hooks'
import { NEUTRAL_TONE, ORDER_STATUS_TONE, StatusPill } from '../../src/components/account/ui'

// Mirror of controller-service app/(storefront)/account/page.tsx at the mobile breakpoint.

const DASH_LABEL: Record<string, string> = {
  cancel_requested: 'Cancel Requested',
  out_for_delivery: 'Out for Delivery',
  granted: 'Access granted',
  return_requested: 'Return Requested',
  return_approved: 'Return Approved',
  return_received: 'Return Received',
  return_rejected: 'Return Rejected',
}
// The dashboard's own colour map (smaller than the orders page's).
const DASH_TONE_KEYS = ['pending', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'granted', 'cancelled', 'cancel_requested', 'return_requested', 'returned']
const dashTone = (s: string) => (DASH_TONE_KEYS.includes(s) ? ORDER_STATUS_TONE[s] : NEUTRAL_TONE)
const dashLabel = (s: string) => DASH_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

function SignedOut() {
  const router = useRouter()
  const config = useStoreConfig()
  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <View className="flex-1 justify-center px-4">
        <View className="bg-surface-elevated rounded-lg p-4" style={{ boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)' }}>
          <Text className="text-3xl font-bold text-foreground text-center">Welcome Back</Text>
          <Text className="mt-2 text-sm text-foreground-secondary text-center">Login to your {config.identity.name || 'Jeffi Stores'} account</Text>
          <Pressable onPress={() => router.push('/(auth)/login')} className="mt-8 bg-accent-500 rounded-lg py-3 items-center">
            <Text className="text-white font-semibold">Sign In</Text>
          </Pressable>
          <Text className="mt-6 text-center text-sm text-foreground-secondary">
            Don&apos;t have an account?{' '}
            <Text className="text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.push('/(auth)/signup')}>
              Create one
            </Text>
          </Text>
        </View>
      </View>
    </View>
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

  const { data: dashboard } = useQuery({ queryKey: ['account-dashboard', user?.id ?? null], queryFn: getDashboard, enabled: !!user })
  const historyKey = ['search-history', user?.id ?? null]
  const { data: searchHistory = [] } = useQuery({ queryKey: historyKey, queryFn: getSearchHistory, enabled: !!user })

  if (!user) return <SignedOut />

  const spent = dashboard ? `₹${Number(dashboard.stats.total_spent).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero header */}
        <View className="px-4 pt-8 pb-14">
          <Gradient from={dark ? accent[700] : accent[600]} to={dark ? accent[600] : accent[500]} />
          <View className="flex-row items-center gap-4">
            <View className="w-16 h-16 rounded-2xl overflow-hidden">
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <View className="w-full h-full bg-white/20 items-center justify-center">
                  <Text className="text-2xl font-bold text-white">{user.firstName?.[0]?.toUpperCase() || 'U'}</Text>
                </View>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-white leading-tight" numberOfLines={1}>
                {user.firstName} {user.lastName}
              </Text>
              <Text className="text-sm text-white/70" numberOfLines={1}>
                {user.email}
              </Text>
            </View>
            <Pressable onPress={signOut} accessibilityLabel="Sign out" className="p-2 rounded-xl bg-white/10 active:bg-white/20">
              <HeroIcon name="logout" size={16} color="rgba(255,255,255,0.8)" />
            </Pressable>
          </View>
          <View className="flex-row gap-2 mt-5">
            {[
              { value: String(dashboard?.stats.total_orders ?? '—'), label: 'Total Orders', big: true },
              { value: spent, label: 'Total Spent', big: false },
              { value: String(dashboard?.stats.active_orders ?? '—'), label: 'Active', big: true },
            ].map(s => (
              <View key={s.label} className="flex-1 bg-white/15 rounded-xl p-3 items-center">
                <Text className={`font-bold text-white ${s.big ? 'text-lg' : 'text-sm leading-tight'}`}>{s.value}</Text>
                <Text className="text-white/70 mt-0.5" style={{ fontSize: 10 }}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="z-10 -mt-12">
          <AccountMobileTabBar />
        </View>

        <View className="px-4 pb-8">
          <View className="pt-2 pb-4 gap-4">
            {/* Recent searches */}
            {searchHistory.length > 0 && (
              <View className="bg-surface-elevated rounded-xl border border-border-default p-4">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-sm font-semibold text-foreground">Recent Searches</Text>
                  <Text
                    className="text-xs text-foreground-muted"
                    onPress={() => {
                      clearSearchHistory()
                      qc.setQueryData(historyKey, [])
                    }}
                  >
                    Clear all
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {searchHistory.map(q => (
                    <Pressable
                      key={q}
                      onPress={() => openHref(router, `/products?search=${encodeURIComponent(q)}`)}
                      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border-secondary"
                    >
                      <HeroIcon name="search" size={12} color={t.foregroundSecondary} />
                      <Text className="text-xs text-foreground-secondary">{q}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <ProfileCard />

            {/* Default address */}
            <View className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-sm font-semibold text-foreground">Default Address</Text>
                <Pressable onPress={() => router.push('/account/addresses')} className="px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800">
                  <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium">Manage</Text>
                </Pressable>
              </View>
              {dashboard?.defaultAddress ? (
                <View className="gap-1">
                  <Text className="font-semibold text-foreground text-sm">{dashboard.defaultAddress.full_name}</Text>
                  <Text className="text-xs text-foreground-secondary">{dashboard.defaultAddress.address_line1}</Text>
                  {!!dashboard.defaultAddress.address_line2 && <Text className="text-xs text-foreground-secondary">{dashboard.defaultAddress.address_line2}</Text>}
                  {!!dashboard.defaultAddress.landmark && <Text className="text-xs text-foreground-muted">Near {dashboard.defaultAddress.landmark}</Text>}
                  <Text className="text-xs text-foreground-secondary">
                    {dashboard.defaultAddress.city}, {dashboard.defaultAddress.state} — {dashboard.defaultAddress.postal_code}
                  </Text>
                  <Text className="text-xs text-foreground-muted pt-1">{dashboard.defaultAddress.phone}</Text>
                </View>
              ) : (
                <View className="h-24 items-center justify-center">
                  <Text className="text-xs text-foreground-muted mb-2">No default address saved</Text>
                  <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium underline" onPress={() => router.push('/account/addresses')}>
                    Add an address
                  </Text>
                </View>
              )}
            </View>

            {/* Recent orders */}
            <View className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-sm font-semibold text-foreground">Recent Orders</Text>
                <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.push('/orders')}>
                  View all
                </Text>
              </View>
              {!dashboard || dashboard.recentOrders.length === 0 ? (
                <View className="items-center py-6">
                  <Text className="text-sm text-foreground-muted mb-3">No orders yet</Text>
                  <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium underline" onPress={() => router.navigate('/(tabs)/products')}>
                    Start shopping
                  </Text>
                </View>
              ) : (
                <View className="gap-2">
                  {dashboard.recentOrders.map(order => (
                    <Pressable key={order.id} onPress={() => router.push(`/orders/${order.id}`)} className="flex-row items-center gap-3 p-3 rounded-xl active:bg-surface">
                      <View className="flex-row">
                        {order.items.slice(0, 3).map((item, i) => (
                          <View
                            key={i}
                            className="w-10 h-10 rounded-lg border-2 border-border-default overflow-hidden bg-surface items-center justify-center"
                            style={{ marginLeft: i === 0 ? 0 : -8 }}
                          >
                            {item.thumbnail_url ? (
                              <Image source={{ uri: item.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            ) : (
                              <HeroIcon name="photo" size={20} color={t.foregroundMuted} strokeWidth={1.5} />
                            )}
                          </View>
                        ))}
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs font-mono text-foreground-muted">#{order.order_number}</Text>
                        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                          {order.items[0]?.product_name}
                          {order.items.length > 1 && <Text className="text-foreground-muted"> +{order.items.length - 1} more</Text>}
                        </Text>
                        <Text className="text-xs text-foreground-muted">
                          {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <View className="items-end gap-1">
                        <Text className="text-sm font-semibold text-foreground">₹{Number(order.total_amount).toLocaleString('en-IN')}</Text>
                        <StatusPill tone={dashTone(order.status)} label={dashLabel(order.status)} className="px-2 py-0.5" textClass="text-[10px] font-medium" />
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <BuyAgainRow />

            {/* Sign out */}
            <Pressable
              onPress={signOut}
              className="w-full flex-row items-center justify-center gap-2 py-3 rounded-xl border border-red-200 dark:border-red-900/40 active:bg-red-50"
            >
              <HeroIcon name="logout" size={16} color={dark ? status.heart : status.danger} />
              <Text className="text-red-600 dark:text-red-400 text-sm font-medium">Sign Out</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/account/delete')} className="items-center py-2">
              <Text className="text-foreground-muted text-xs">Delete account</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
