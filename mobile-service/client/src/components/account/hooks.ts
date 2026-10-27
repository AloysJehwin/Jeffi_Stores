import { useEffect, useRef } from 'react'
import { useNavigation, useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { getFeatureFlags, getMeFull, type AccountUser, type FeatureFlags } from '../../api/account'
import { logout } from '../../api/auth'
import type { AuthPortal } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { useCartStore } from '../../stores/cartStore'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { FileText, Gift, Heart, MapPin, MonitorSmartphone, Receipt, RefreshCw, ShoppingBag, User, UserPlus } from 'lucide-react-native'
import type { IconComponent } from '../../ui'

const OFF: FeatureFlags = { smsEnabled: true, whatsappEnabled: true, loyaltyEnabled: false, birthdayEnabled: false, referralEnabled: false }

/**
 * Closes the sign-in modal from any of its screens. router.dismissAll() is a POP_TO_TOP on the nearest
 * stack, so from the OTP screen it only went back to login; popping the root stack closes the whole group.
 */
export function useLeaveAuth() {
  const router = useRouter()
  const navigation = useNavigation()
  return () => {
    const root = navigation.getParent()
    if (root?.canGoBack()) root.goBack()
    else router.replace('/(tabs)')
  }
}

/** The web's /login and /signup send a signed-in visitor back to the store. Checked once, when the saved
 *  session has been restored, so a sign-in finishing on the screen keeps its own flow. Signed in to the
 *  other store is fine: that's how the store switch signs in to a second one. */
export function useLeaveIfSignedIn(portal: AuthPortal = 'customer') {
  const leave = useLeaveAuth()
  const isLoading = useAuthStore(s => s.isLoading)
  const checked = useRef(false)
  useEffect(() => {
    if (isLoading || checked.current) return
    checked.current = true
    const s = useAuthStore.getState()
    if (s.user && s.portal === portal) leave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])
}

/** /api/feature-flags, shared like the web's useStoreFlag. */
export function useFeatureFlags(): FeatureFlags {
  return useFeatureFlagsState().flags
}

/** The flags plus whether they have actually arrived: the fallback assumes every OTP channel is on. */
export function useFeatureFlagsState(): { flags: FeatureFlags; loaded: boolean } {
  const { data, isPending } = useQuery({ queryKey: ['feature-flags'], queryFn: getFeatureFlags, staleTime: 5 * 60_000 })
  // A failed request still settles, so the form shows with the fallback instead of waiting forever.
  return { flags: data ?? OFF, loaded: !isPending }
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

/** The signed-in business account, as the web's business portal reads it. Business prices are per category. */
export function useBusiness() {
  const user = useAccountUser()
  const isBusiness = useAuthStore(s => s.portal === 'business') && !!user
  const approved = isBusiness && user?.approvalStatus === 'approved'
  const map = approved ? user?.businessDiscountMap : undefined
  return {
    isBusiness,
    approved,
    profile: isBusiness ? user : null,
    /** The extra business discount for a category, in percent (0 when none). */
    discountFor: (categoryId?: string | null) => (map && categoryId ? map[categoryId] ?? 0 : 0),
  }
}

/** applyDiscount in lib/catalog/pricing.ts. */
export const applyDiscount = (price: number, pct: number) => price * (1 - pct / 100)

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

/** Switches between the storefront and the business store, each with its own session as on the web.
 *  The business store without a session opens its sign in; the storefront without one is browsed as a guest. */
export function useSwitchStore() {
  const router = useRouter()
  const qc = useQueryClient()
  const resetCart = useCartStore(s => s.reset)
  return async (next: AuthPortal) => {
    const auth = useAuthStore.getState()
    if (auth.portal === next) return
    if (!(await auth.switchTo(next))) {
      router.push('/(auth)/business-login')
      return
    }
    resetCart()
    qc.clear()
    router.navigate('/(tabs)')
  }
}

export interface AccountNavItem {
  href: string
  route: string
  label: string
  exact: boolean
  icon: IconComponent
}

const NAV: AccountNavItem[] = [
  { href: '/account', route: '/(tabs)/account', label: 'Profile', exact: true, icon: User },
  { href: '/account/orders', route: '/orders', label: 'My Orders', exact: false, icon: ShoppingBag },
  { href: '/account/transactions', route: '/account/transactions', label: 'Transactions', exact: false, icon: Receipt },
  { href: '/account/addresses', route: '/account/addresses', label: 'My Addresses', exact: false, icon: MapPin },
  { href: '/wishlist', route: '/(tabs)/wishlist', label: 'Wishlist', exact: false, icon: Heart },
]
const SUBSCRIPTIONS: AccountNavItem = { href: '/account/subscriptions', route: '/account/subscriptions', label: 'Subscriptions', exact: false, icon: RefreshCw }
const REWARDS: AccountNavItem = { href: '/account/rewards', route: '/account/rewards', label: 'Rewards', exact: false, icon: Gift }
const REFERRALS: AccountNavItem = { href: '/account/referrals', route: '/account/referrals', label: 'Refer & Earn', exact: false, icon: UserPlus }
const QUOTES: AccountNavItem = { href: '/account/quotes', route: '/account/quotes', label: 'My Quotes', exact: false, icon: FileText }
const SESSIONS: AccountNavItem = { href: '/account/sessions', route: '/account/sessions', label: 'Signed-in devices', exact: false, icon: MonitorSmartphone }

/** The web's useAccountNavItems; a business account gets the business portal's tabs instead of rewards. */
export function useAccountNavItems(): AccountNavItem[] {
  const { isBusiness, approved } = useBusiness()
  const { loyaltyEnabled, referralEnabled } = useFeatureFlags()
  const subscriptionsEnabled = useStoreConfig().flags.subscriptionsEnabled
  let items = subscriptionsEnabled ? [...NAV.slice(0, 2), SUBSCRIPTIONS, ...NAV.slice(2)] : NAV
  if (isBusiness) return approved ? [...items.slice(0, 2), QUOTES, ...items.slice(2), SESSIONS] : [NAV[0], SESSIONS]
  if (loyaltyEnabled) items = referralEnabled ? [...items, REWARDS, REFERRALS] : [...items, REWARDS]
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
