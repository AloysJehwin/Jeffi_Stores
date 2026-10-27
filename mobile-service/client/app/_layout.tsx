import '../global.css'
import { useEffect, useRef } from 'react'
import { Stack, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { useColorScheme } from 'nativewind'
import { sessionUsable, useAuthStore } from '../src/stores/authStore'
import { useCartStore } from '../src/stores/cartStore'
import { useThemeStore } from '../src/stores/themeStore'
import { getStoredToken, loadAuthPortal } from '../src/api/client'
import { getMe } from '../src/api/auth'
import { getCart } from '../src/api/cart'
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
function AccountCacheReset() {
  const account = useAuthStore(s => (s.user ? `${s.portal}:${s.user.id}` : null))
  const prev = useRef(account)
  useEffect(() => {
    if (prev.current && account && prev.current !== account) queryClient.clear()
    prev.current = account
  }, [account])
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
  }, [])
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
