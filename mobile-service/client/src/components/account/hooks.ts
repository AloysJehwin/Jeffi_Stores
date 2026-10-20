import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { getFeatureFlags, getMeFull, type AccountUser, type FeatureFlags } from '../../api/account'
import { logout } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'
import { useCartStore } from '../../stores/cartStore'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import type { HeroIconName } from './HeroIcon'

const OFF: FeatureFlags = { smsEnabled: true, whatsappEnabled: true, loyaltyEnabled: false, birthdayEnabled: false, referralEnabled: false }

/** /api/feature-flags, shared like the web's useStoreFlag. */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useQuery({ queryKey: ['feature-flags'], queryFn: getFeatureFlags, staleTime: 5 * 60_000 })
  return data ?? OFF
}

export function useAccountUser(): AccountUser | null {
  return useAuthStore(s => s.user) as AccountUser | null
}

/** The web's `if (!isLoading && !user) router.push('/login?redirect=…')`. */
export function useRequireAuth(): AccountUser | null {
  const router = useRouter()
  const user = useAccountUser()
  const isLoading = useAuthStore(s => s.isLoading)
  useEffect(() => {
    if (!isLoading && !user) router.replace('/(auth)/login')
  }, [isLoading, user, router])
  return user
}

/** AuthContext.refreshUser: re-read /api/auth/me into the store (token untouched). */
export async function refreshUser(): Promise<AccountUser | null> {
  const user = await getMeFull().catch(() => null)
  if (user) useAuthStore.setState({ user })
  return user
}

/** AuthContext.logout, as TopNav signs out. */
export function useSignOut() {
  const qc = useQueryClient()
  const clearAuth = useAuthStore(s => s.clearAuth)
  const resetCart = useCartStore(s => s.reset)
  return async () => {
    await logout()
    await clearAuth()
    resetCart()
    qc.clear()
  }
}

export interface AccountNavItem {
  href: string
  route: string
  label: string
  exact: boolean
  icon: HeroIconName
}

const NAV: AccountNavItem[] = [
  { href: '/account', route: '/(tabs)/account', label: 'Profile', exact: true, icon: 'user' },
  { href: '/account/orders', route: '/orders', label: 'My Orders', exact: false, icon: 'bag' },
  { href: '/account/transactions', route: '/account/transactions', label: 'Transactions', exact: false, icon: 'receipt' },
  { href: '/account/addresses', route: '/account/addresses', label: 'My Addresses', exact: false, icon: 'location' },
  { href: '/wishlist', route: '/(tabs)/wishlist', label: 'Wishlist', exact: false, icon: 'heart' },
]
const SUBSCRIPTIONS: AccountNavItem = { href: '/account/subscriptions', route: '/account/subscriptions', label: 'Subscriptions', exact: false, icon: 'refresh' }
const REWARDS: AccountNavItem = { href: '/account/rewards', route: '/account/rewards', label: 'Rewards', exact: false, icon: 'gift' }
const REFERRALS: AccountNavItem = { href: '/account/referrals', route: '/account/referrals', label: 'Refer & Earn', exact: false, icon: 'userAdd' }
const QUOTES: AccountNavItem = { href: '/account/quotes', route: '/account/quotes', label: 'My Quotes', exact: false, icon: 'document' }

/** The web's useAccountNavItems (+ the approved-business quotes tab). */
export function useAccountNavItems(): AccountNavItem[] {
  const user = useAccountUser()
  const { loyaltyEnabled, referralEnabled } = useFeatureFlags()
  const subscriptionsEnabled = useStoreConfig().flags.subscriptionsEnabled
  let items = subscriptionsEnabled ? [...NAV.slice(0, 2), SUBSCRIPTIONS, ...NAV.slice(2)] : NAV
  if (loyaltyEnabled && !user?.isBusiness) items = referralEnabled ? [...items, REWARDS, REFERRALS] : [...items, REWARDS]
  if (user?.isBusiness && user.approvalStatus === 'approved') items = [...items, QUOTES]
  return items
}

/** App pathname → is this nav item the current page (account tab is "/account", orders live at "/orders"). */
export function isNavActive(item: AccountNavItem, pathname: string): boolean {
  const path = pathname === '/orders' || pathname.startsWith('/orders/') ? pathname.replace(/^\/orders/, '/account/orders') : pathname
  return item.exact ? path === item.href : path.startsWith(item.href)
}

/** useInfiniteList from the web's admin kit: pages accumulate, total from page 1. */
export function useInfiniteList<T>(opts: {
  key: unknown[]
  enabled: boolean
  pageSize: number
  fetchPage: (page: number) => Promise<{ rows: T[]; total: number | null }>
}) {
  const q = useInfiniteQuery({
    queryKey: opts.key,
    enabled: opts.enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => opts.fetchPage(pageParam),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0)
      if (last.rows.length < opts.pageSize) return undefined
      if (last.total != null && loaded >= last.total) return undefined
      return all.length + 1
    },
  })
  const rows = q.data?.pages.flatMap(p => p.rows) ?? []
  const total = q.data?.pages[0]?.total ?? null
  return {
    rows,
    total,
    loading: q.isLoading,
    loadingMore: q.isFetchingNextPage,
    hasMore: !!q.hasNextPage,
    error: q.isError ? (q.error as Error)?.message || 'Could not load' : null,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
    },
    reload: () => q.refetch(),
  }
}

export type InfiniteList<T> = ReturnType<typeof useInfiniteList<T>>
