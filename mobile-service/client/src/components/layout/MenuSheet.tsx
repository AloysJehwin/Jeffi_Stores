import { useEffect, useRef, type ReactNode } from 'react'
import { create } from 'zustand'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, BellRing, Briefcase, Building2, CircleUser, FilePlus2, FileText, GitCompareArrows, Heart, House, Info, LayoutGrid, LifeBuoy,
  LogIn, LogOut, Mail, MonitorSmartphone, Moon, Package, RotateCcw, ShoppingBag, ShoppingCart, Smartphone, Sun, Tag, UserPlus, X,
} from 'lucide-react-native'
import { logout } from '../../api/auth'
import { getWishlist } from '../../api/wishlist'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useUnreadCount } from '../../hooks/useNotifications'
import { useCartStore } from '../../stores/cartStore'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore, type ThemePreference } from '../../stores/themeStore'
import { useBusiness } from '../account/hooks'
import { useTokens } from '../../theme'
import {
  Badge, IconButton, ListGroup, ListRow, ModalSheet, Text, cn, elevationClass, haptic, useElevation, type IconComponent,
} from '../../ui'
import { StoreLogo } from './StoreLogo'

// The site menu as a sheet: account, shop, cart and wishlist, help pages, theme, sign out.

/** Runs `run` once the sheet has slid away (its content unmounts then). */
function AfterClose({ run }: { run: () => void }) {
  const ref = useRef(run)
  ref.current = run
  useEffect(() => () => ref.current(), [])
  return null
}

const THEMES: { value: ThemePreference; label: string; icon: IconComponent }[] = [
  { value: 'system', label: 'System', icon: Smartphone },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function ThemePicker() {
  const t = useTokens()
  const shadow = useElevation('raised')
  const preference = useThemeStore(s => s.preference)
  const setPreference = useThemeStore(s => s.setPreference)
  return (
    <View className="px-4 py-3" accessibilityRole="radiogroup" accessibilityLabel="Theme">
      <View className="flex-row gap-1 rounded-2xl bg-surface-secondary p-1">
        {THEMES.map(({ value, label, icon: Icon }) => {
          const on = preference === value
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${label} theme`}
              onPress={() => {
                if (on) return
                haptic.select()
                setPreference(value)
              }}
              style={on ? shadow : undefined}
              className={cn('min-h-[40px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl', on && cn('bg-surface-elevated', elevationClass('raised')))}
            >
              <Icon size={16} color={on ? t.accent600 : t.foregroundSecondary} />
              <Text className={cn('text-sm font-semibold', on ? 'text-foreground' : 'text-foreground-secondary')}>{label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const qc = useQueryClient()
  const { identity } = useStoreConfig()
  const cartCount = useCartStore(s => s.count)
  const resetCart = useCartStore(s => s.reset)
  const user = useAuthStore(s => s.user)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const business = useBusiness()

  const { data: wishlist } = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: !!user, staleTime: 60_000 })
  const wishlistCount = user ? wishlist?.length ?? 0 : 0
  const unread = useUnreadCount().count

  // Navigation waits until the sheet is gone, so modal routes (sign in) never open under it.
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (open) pending.current = null
  }, [open])
  const go = (action: () => void) => {
    pending.current = action
    onClose()
  }
  const flush = () => {
    const action = pending.current
    pending.current = null
    action?.()
  }

  const handleLogout = async () => {
    await logout()
    await clearAuth()
    resetCart()
    qc.clear()
  }

  // `path` is the app route, for the active highlight.
  const row = (title: string, icon: IconComponent, path: string, nav: () => void, extra?: { trailing?: ReactNode }) => {
    const active = pathname === path
    return (
      <ListRow
        key={title}
        title={title}
        icon={icon}
        iconTone={active ? 'accent' : 'neutral'}
        trailing={extra?.trailing}
        onPress={() => go(nav)}
      />
    )
  }

  const avatarUrl = (user as { avatarUrl?: string | null } | null)?.avatarUrl

  return (
    <ModalSheet open={open} onClose={onClose}>
      <AfterClose run={flush} />

      <View className="mb-4 flex-row items-center gap-3 pt-1">
        <Pressable
          onPress={() => go(() => router.navigate('/(tabs)'))}
          className="flex-1 flex-row items-center gap-2"
          accessibilityRole="link"
          accessibilityLabel={`${identity.name}, home`}
        >
          <StoreLogo uri={identity.logoUrl} name={identity.name} size={40} />
          <Text className="font-display text-lg font-extrabold text-secondary-500 dark:text-primary-400 shrink" numberOfLines={1}>
            {identity.name}
          </Text>
        </Pressable>
        <IconButton icon={X} label="Close menu" variant="tinted" size="sm" onPress={onClose} />
      </View>

      <View className="gap-5">
        {user ? (
          <ListGroup>
            <ListRow
              key="me"
              title={`${user.firstName} ${user.lastName}`.trim()}
              subtitle={business.isBusiness && business.profile?.companyName ? business.profile.companyName : user.email}
              leading={
                <View className="h-10 w-10 overflow-hidden rounded-full">
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} contentFit="cover" style={{ width: 40, height: 40 }} />
                  ) : (
                    <View className="h-full w-full items-center justify-center bg-accent-500">
                      <Text className="font-semibold text-white">
                        {`${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) || ''}`.toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              }
            />
            {row('My account', CircleUser, '/account', () => router.navigate('/(tabs)/account'))}
            {row('My orders', Package, '/orders', () => router.push('/orders'))}
            {row('Notifications', Bell, '/notifications', () => router.push('/notifications'), {
              trailing: unread > 0 ? <Badge label={unread > 99 ? '99+' : String(unread)} tone="accent" solid size="sm" /> : null,
            })}
            {row('Notification settings', BellRing, '/account/notifications', () => router.push('/account/notifications'))}
          </ListGroup>
        ) : (
          <ListGroup>
            <ListRow key="login" title="Sign in" icon={LogIn} iconTone="accent" onPress={() => go(() => router.push('/(auth)/login'))} />
            <ListRow key="signup" title="Create account" icon={UserPlus} onPress={() => go(() => router.push('/(auth)/signup'))} />
            <ListRow key="business" title="Business sign in" icon={Briefcase} onPress={() => go(() => router.push('/(auth)/business-login'))} />
            {row('Notification settings', BellRing, '/account/notifications', () => router.push('/account/notifications'))}
          </ListGroup>
        )}

        {business.approved ? (
          <ListGroup title="Business">
            {row('My quotes', FileText, '/account/quotes', () => router.push('/account/quotes'))}
            {row('New quote', FilePlus2, '/account/quotes/new', () => router.push('/account/quotes/new'))}
            {row('Company', Building2, '/account', () => router.navigate('/(tabs)/account'))}
            {row('Signed-in devices', MonitorSmartphone, '/account/sessions', () => router.push('/account/sessions'))}
          </ListGroup>
        ) : null}

        <ListGroup title="Shop">
          {row('Home', House, '/', () => router.navigate('/(tabs)'))}
          {row('Products', ShoppingBag, '/products', () => router.navigate('/(tabs)/products'))}
          {row('Categories', LayoutGrid, '/categories', () => router.push('/categories'))}
          {row('Brands', Tag, '/brands', () => router.push('/brands'))}
          {row('Compare', GitCompareArrows, '/compare', () => router.push('/compare'))}
        </ListGroup>

        <ListGroup title="Cart and wishlist">
          {row('Cart', ShoppingCart, '/cart', () => router.navigate('/(tabs)/cart'), {
            trailing: cartCount > 0 ? <Badge label={String(cartCount)} tone="accent" solid size="sm" /> : null,
          })}
          {row('Wishlist', Heart, '/wishlist', () => router.navigate('/(tabs)/wishlist'), {
            trailing: wishlistCount > 0 ? <Badge label={String(wishlistCount)} tone="danger" solid size="sm" /> : null,
          })}
        </ListGroup>

        <ListGroup title="Help and info">
          {row('About us', Info, '/info/about', () => router.push('/info/about'))}
          {row('Contact', Mail, '/info/contact', () => router.push('/info/contact'))}
          {row('Support', LifeBuoy, '/info/support', () => router.push('/info/support'))}
          {row('Return policy', RotateCcw, '/info/return-policy', () => router.push('/info/return-policy'))}
          {row('Legal', FileText, '/legal', () => router.push('/legal'))}
        </ListGroup>

        <ListGroup title="Theme">
          <ThemePicker key="theme" />
        </ListGroup>

        {user ? (
          <ListGroup>
            <ListRow key="logout" title="Sign out" icon={LogOut} destructive chevron={false} onPress={() => go(() => void handleLogout())} />
          </ListGroup>
        ) : null}
      </View>

      <View style={{ height: insets.bottom }} />
    </ModalSheet>
  )
}

// One menu sheet for the whole app, mounted at the root; every header's MenuButton opens it.
const useMenuStore = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({ open: false, setOpen: open => set({ open }) }))
export const openMenu = () => useMenuStore.getState().setOpen(true)
const closeMenu = () => useMenuStore.getState().setOpen(false)

export function MenuSheetHost() {
  const open = useMenuStore(s => s.open)
  return <MenuSheet open={open} onClose={closeMenu} />
}
