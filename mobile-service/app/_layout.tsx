import '../global.css'
import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '../src/stores/authStore'
import { useCartStore } from '../src/stores/cartStore'
import { getStoredToken } from '../src/api/client'
import { getMe } from '../src/api/auth'
import { getCart } from '../src/api/cart'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function AuthRehydrator() {
  const { setAuth, setLoading } = useAuthStore()

  useEffect(() => {
    ;(async () => {
      try {
        const token = await getStoredToken()
        if (token) {
          const user = await getMe()
          await setAuth(user, token)
        }
      } catch {
      } finally {
        setLoading(false)
      }
    })()
  }, [])

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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthRehydrator />
          <CartRehydrator />
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
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
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
