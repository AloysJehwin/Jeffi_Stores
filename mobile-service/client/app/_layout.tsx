import '../global.css'
import { useEffect, useRef } from 'react'
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider, dehydrate, hydrate, type DehydratedState } from '@tanstack/react-query'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { useColorScheme } from 'nativewind'
import { sessionUsable, useAuthStore } from '../src/stores/authStore'
import { useCartStore } from '../src/stores/cartStore'
import { useThemeStore } from '../src/stores/themeStore'
import { useHomeLayoutStore } from '../src/stores/homeLayoutStore'
import { getStoredToken, loadAuthPortal } from '../src/api/client'
import { getMe } from '../src/api/auth'
import { getCart } from '../src/api/cart'
import { loadPendingUpi } from '../src/components/checkout/upiPending'
import Toast from '../src/ui/Toast'
import UpdatePrompt from '../src/ui/UpdatePrompt'
import { QuickAddSheetHost } from '../src/components/product/QuickAddSheet'
import { StoryViewerHost } from '../src/components/home/StoryViewer'
import { PushBootstrap } from '../src/components/push/PushBootstrap'
import { PushPermissionSheetHost } from '../src/components/push/PushPermissionSheet'
import { trackScreen } from '../src/lib/analytics'
import { ConfirmHost, HeaderMenuContext } from '../src/ui'
import { MenuButton } from '../src/components/layout/MenuButton'
import { MenuSheetHost } from '../src/components/layout/MenuSheet'
import { useTokens } from '../src/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

/** GA4 screen_view per route pattern (the web gets page_view from the Google tag). */
function ScreenTracker() {
  const segments = useSegments() as string[]
  const screen = segments.filter(s => !s.startsWith('(')).join('/') || 'home'
  useEffect(() => {
    trackScreen(screen)
  }, [screen])
  return null
}

function AuthRehydrator() {
  const { setAuth, clearAuth, setLoading } = useAuthStore()

  useEffect(() => {
    ;(async () => {
      try {
        // Bearer when a token is stored (the backend returns it at sign-in), else the session cookie.
        const portal = await loadAuthPortal()
        useAuthStore.setState({ savedPortal: portal })
        const token = await getStoredToken()
        const user = await getMe()
        if (user && sessionUsable(user, portal)) await setAuth(user, token ?? '', portal)
        else if (portal === 'business') await clearAuth()
      } catch {
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return null
}

// Signing in to the other store, or switching to it, must not show the last account's cart, orders or wishlist.
// Each account's data is parked on the way out and put back on return, so switching back is instant (then refreshed).
const parked = new Map<string, DehydratedState>()
function AccountCacheReset() {
  const portal = useAuthStore(s => s.portal)
  const userId = useAuthStore(s => s.user?.id ?? null)
  const prev = useRef({ portal, userId })
  useEffect(() => {
    const was = prev.current
    prev.current = { portal, userId }
    const switched = was.portal !== portal || (!!was.userId && !!userId && was.userId !== userId)
    if (!switched) return
    parked.set(`${was.portal}:${was.userId ?? ''}`, dehydrate(queryClient))
    queryClient.clear()
    const back = parked.get(`${portal}:${userId ?? ''}`)
    if (back) hydrate(queryClient, back)
  }, [portal, userId])
  return null
}

function CartRehydrator() {
  const { user } = useAuthStore()
  const setCount = useCartStore((s) => s.setCount)

  useEffect(() => {
    if (!user) { setCount(0); return }
    getCart().then((res) => {
      const total = res.items.reduce((sum, item) => sum + Math.round(Number(item.quantity)), 0)
      setCount(total)
    }).catch(() => {})

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        Array.isArray(event.query.queryKey) &&
        event.query.queryKey[0] === 'cart' &&
        event.query.state.data
      ) {
        const data = event.query.state.data as { items: { quantity: number }[] }
        const total = (data.items || []).reduce((sum, item) => sum + Math.round(Number(item.quantity)), 0)
        setCount(total)
      }
    })
    return unsubscribe
  }, [user])

  return null
}

function ThemeRehydrator() {
  useEffect(() => {
    useThemeStore.getState().hydrate()
    useHomeLayoutStore.getState().hydrate()
  }, [])
  return null
}

// A UPI payment the app was killed in the middle of (browser or UPI app open) picks up where it left off.
function UpiResume() {
  const router = useRouter()
  const navReady = !!useRootNavigationState()?.key
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current || !navReady || isLoading || !user) return
    checked.current = true
    loadPendingUpi().then(p => {
      if (p) router.push({ pathname: '/checkout/upi', params: { intentId: p.intentId } })
    })
  }, [navReady, isLoading, user, router])
  return null
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme()
  const t = useTokens()
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Edge-to-edge Android no longer resizes the window for the keyboard; this tracks it on both platforms. */}
      <KeyboardProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthRehydrator />
          <AccountCacheReset />
          <ScreenTracker />
          <CartRehydrator />
          <ThemeRehydrator />
          <UpiResume />
          <PushBootstrap />
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          {/* The scene background matches the theme, so a push never flashes white in dark mode. */}
          <HeaderMenuContext.Provider value={MenuButton}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.surface } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
            <Stack.Screen name="product/[slug]" />
            <Stack.Screen name="category/[slug]" />
            <Stack.Screen name="checkout/review" />
            <Stack.Screen name="checkout/payment" />
            <Stack.Screen name="checkout/upi" />
            <Stack.Screen name="orders/index" />
            <Stack.Screen name="orders/[id]" />
            <Stack.Screen name="account/profile" />
            <Stack.Screen name="account/addresses" />
            <Stack.Screen name="account/notifications" />
            <Stack.Screen name="notifications" />
          </Stack>
          </HeaderMenuContext.Provider>
          <MenuSheetHost />
          {/* One sheet for every "+" and long-press; lives above the stack so toasts still render over it. */}
          <QuickAddSheetHost />
          <StoryViewerHost />
          <PushPermissionSheetHost />
          <UpdatePrompt />
          <ConfirmHost />
          <Toast />
        </QueryClientProvider>
      </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
