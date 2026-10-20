import { useEffect } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import Pulse from '../../src/components/cart/Pulse'
import AiInsight from '../../src/components/cart/AiInsight'
import OrderCelebration from '../../src/components/checkout/OrderCelebration'
import RecommendedProducts from '../../src/components/checkout/RecommendedProducts'
import { money, qtyText, unitText } from '../../src/components/cart/lines'
import { getOrder } from '../../src/api/orders'

// Mirror of controller-service app/(storefront)/account/orders/confirmation/page.tsx (the order placed page).

const STATUS_PILL: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30',
  processing: 'bg-blue-100 dark:bg-blue-900/30',
  shipped: 'bg-purple-100 dark:bg-purple-900/30',
  out_for_delivery: 'bg-indigo-100 dark:bg-indigo-900/30',
  delivered: 'bg-green-100 dark:bg-green-900/30',
  granted: 'bg-green-100 dark:bg-green-900/30',
}
const STATUS_TEXT: Record<string, string> = {
  pending: 'text-yellow-800 dark:text-yellow-300',
  processing: 'text-blue-800 dark:text-blue-300',
  shipped: 'text-purple-800 dark:text-purple-300',
  out_for_delivery: 'text-indigo-800 dark:text-indigo-300',
  delivered: 'text-green-800 dark:text-green-300',
  granted: 'text-green-800 dark:text-green-300',
}

function statusLabel(s: string) {
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'granted') return 'Access granted'
  if (s === 'cancel_requested') return 'Cancellation Requested'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function OrderConfirmationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { orderId } = useLocalSearchParams<{ orderId?: string }>()
  const { data: order, isLoading, error } = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => getOrder(orderId!),
    enabled: !!orderId,
    retry: 1,
  })

  useEffect(() => {
    if (!orderId) router.replace('/orders')
  }, [orderId, router])

  if (isLoading || !orderId) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="flex-1 justify-center px-4">
          <Pulse className="items-center gap-4">
            <View className="h-16 w-16 rounded-full bg-surface-elevated" />
            <View className="h-6 w-48 rounded bg-surface-elevated" />
            <View className="h-4 w-64 rounded bg-surface-elevated" />
            <View className="h-32 w-full rounded-lg bg-surface-elevated" />
          </Pulse>
        </View>
      </View>
    )
  }

  if (error || !order) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="flex-1 items-center justify-center px-4">
          <View className="w-full items-center rounded-lg bg-surface-elevated p-4 shadow-md">
            <Text className="mb-4 text-5xl text-red-500">!</Text>
            <Text className="mb-2 text-2xl font-bold text-foreground">Order Not Found</Text>
            <Text className="mb-6 text-center text-foreground-secondary">
              {(error instanceof Error && error.message) || 'Unable to load order details'}
            </Text>
            <Pressable onPress={() => router.push('/orders')} className="rounded-lg bg-accent-600 px-6 py-2 active:bg-accent-700">
              <Text className="text-white">View All Orders</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  // Snapshot addresses are snake_case; the web page reads camelCase keys, so take either.
  const addr = (order.shippingAddress ?? {}) as Record<string, string | null | undefined>
  const line1 = addr.address_line1 ?? addr.addressLine1
  const line2 = addr.address_line2 ?? addr.addressLine2
  const pin = addr.postal_code ?? addr.postalCode
  const total = Number(order.totalAmount)
  const status = String(order.status)

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 48, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        <OrderCelebration orderId={order.id} orderNumber={order.orderNumber} />

        <View className="mb-6 rounded-lg bg-surface-elevated p-4 shadow-md">
          <Text className="mb-4 text-xl font-bold text-foreground">Order Summary</Text>
          <View className="mb-6 gap-4">
            {order.items.map((item, i) => {
              const fractional = (!!item.buyMode && item.buyMode !== 'unit') || (!!item.buyUnit && item.buyUnit !== 'unit')
              const unit = item.buyUnit && item.buyUnit !== 'unit' ? item.buyUnit : item.buyMode && item.buyMode !== 'unit' ? item.buyMode : null
              const qty = fractional ? qtyText(item.quantity) : String(Math.round(Number(item.quantity)))
              const unitSuffix = unit ? ` ${unitText(unit)}` : ''
              return (
                <View
                  key={item.id}
                  className={`flex-row items-center justify-between gap-3 pb-4 ${i === order.items.length - 1 ? '' : 'border-b border-border-default'}`}
                >
                  <View className="flex-1">
                    <Text className="font-medium text-foreground">{item.productName}</Text>
                    <Text className="text-sm text-foreground-secondary">
                      Quantity: {qty}
                      {unitSuffix}
                    </Text>
                    <Text className="text-sm text-foreground-secondary">
                      {money(item.unitPrice)}
                      {unit ? ` / ${unitText(unit)}` : ''} × {qty}
                      {unitSuffix}
                    </Text>
                  </View>
                  <Text className="font-semibold text-foreground">{money(Number(item.unitPrice) * Number(item.quantity))}</Text>
                </View>
              )
            })}
          </View>
          <View className="border-t-2 border-border-default pt-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">Total</Text>
              <Text className="text-2xl font-bold text-accent-600 dark:text-accent-400">{money(total)}</Text>
            </View>
          </View>
        </View>

        <View className="mb-6 rounded-lg bg-surface-elevated p-4 shadow-md">
          <Text className="mb-4 text-xl font-bold text-foreground">Shipping Address</Text>
          {line1 ? <Text className="text-foreground-secondary">{line1}</Text> : null}
          {line2 ? <Text className="text-foreground-secondary">{line2}</Text> : null}
          <Text className="text-foreground-secondary">
            {addr.city}, {addr.state} {pin}
          </Text>
          <Text className="mt-2 text-foreground-secondary">Phone: {addr.phone}</Text>
        </View>

        <View className="mb-8 rounded-lg bg-surface-elevated p-4 shadow-md">
          <Text className="mb-4 text-xl font-bold text-foreground">Order Status</Text>
          <View className="flex-row flex-wrap items-center gap-3">
            <View className={`rounded-full px-4 py-2 ${STATUS_PILL[status] ?? 'bg-surface-secondary'}`}>
              <Text className={`font-semibold ${STATUS_TEXT[status] ?? 'text-foreground'}`}>{statusLabel(status)}</Text>
            </View>
            <Text className="text-foreground-secondary">
              Placed on{' '}
              {new Date(order.createdAt).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        <View className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/30">
          <Text className="text-sm text-blue-900 dark:text-blue-300">
            A confirmation email has been sent to your email address with your order details.
          </Text>
        </View>

        <AiInsight kind="affirmation" className="mb-6" body={{ itemNames: order.items.map(i => i.productName) }} />

        <View className="gap-4">
          <Pressable onPress={() => router.push('/orders')} className="rounded-lg bg-accent-600 px-6 py-3 active:bg-accent-700">
            <Text className="text-center font-semibold text-white">View All Orders</Text>
          </Pressable>
          <Pressable
            onPress={() => router.navigate('/(tabs)')}
            className="rounded-lg border-2 border-border-secondary bg-surface-elevated px-6 py-3 active:bg-surface-secondary"
          >
            <Text className="text-center font-semibold text-foreground-secondary">Continue Shopping</Text>
          </Pressable>
        </View>

        <RecommendedProducts title="Shop More Products" limit={4} />
      </ScrollView>
    </View>
  )
}
