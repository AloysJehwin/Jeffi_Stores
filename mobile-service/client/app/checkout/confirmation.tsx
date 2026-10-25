import { useEffect } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, ErrorState, Notice, Screen, ScreenHeader, Skeleton, Text, statusTone } from '../../src/ui'
import AiInsight from '../../src/components/cart/AiInsight'
import OrderCelebration from '../../src/components/checkout/OrderCelebration'
import RecommendedProducts from '../../src/components/checkout/RecommendedProducts'
import { money, qtyText, unitText } from '../../src/components/cart/lines'
import { getOrder } from '../../src/api/orders'
import { trackPurchase } from '../../src/lib/analytics'

// Mirror of controller-service app/(storefront)/account/orders/confirmation/page.tsx (the order placed page).

const HEADING = 'mb-4 font-display text-xl font-extrabold text-foreground'

function statusLabel(s: string) {
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'granted') return 'Access granted'
  if (s === 'cancel_requested') return 'Cancellation Requested'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The loaded page's shape: celebration card, order summary, shipping address. */
function ConfirmationLoading() {
  return (
    <View className="flex-1 overflow-hidden px-4 pt-4">
      <View className="mb-8 items-center rounded-panel border-2 border-border-default bg-surface-elevated p-4">
        <Skeleton width={64} height={64} rounded="rounded-full" className="mb-4" />
        <Skeleton height={30} width={220} className="mb-3" />
        <View className="mb-4 w-full items-center gap-2">
          <Skeleton height={14} width="85%" rounded="rounded" />
          <Skeleton height={14} width="60%" rounded="rounded" />
        </View>
        <View className="items-center gap-2 rounded-field bg-surface p-4">
          <Skeleton height={12} width={96} rounded="rounded" />
          <Skeleton height={26} width={170} />
        </View>
      </View>
      <Card className="mb-6">
        <Skeleton height={22} width={150} className="mb-4" />
        <View className="mb-6 gap-4">
          {[0, 1].map(i => (
            <View key={i} className={`flex-row items-center justify-between gap-3 pb-4 ${i === 0 ? 'border-b border-border-default' : ''}`}>
              <View className="flex-1 gap-2">
                <Skeleton height={15} width="75%" />
                <Skeleton height={12} width="35%" rounded="rounded" />
                <Skeleton height={12} width="50%" rounded="rounded" />
              </View>
              <Skeleton height={15} width={64} />
            </View>
          ))}
        </View>
        <View className="flex-row items-center justify-between border-t-2 border-border-default pt-4">
          <Skeleton height={20} width={60} />
          <Skeleton height={28} width={110} />
        </View>
      </Card>
      <Card>
        <Skeleton height={22} width={170} className="mb-4" />
        <View className="gap-2">
          <Skeleton height={14} width="80%" rounded="rounded" />
          <Skeleton height={14} width="55%" rounded="rounded" />
          <Skeleton height={14} width="40%" rounded="rounded" className="mt-1" />
        </View>
      </Card>
    </View>
  )
}

export default function OrderConfirmationScreen() {
  const router = useRouter()
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

  useEffect(() => {
    if (!order || order.status === 'cancelled') return
    trackPurchase({
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      taxAmount: order.taxAmount,
      shippingAmount: order.shippingAmount,
      couponCode: order.couponCode,
      items: order.items.map(i => ({
        sku: i.subVariantSku || i.productSku,
        name: i.productName,
        price: i.unitPrice,
        quantity: Number(i.quantity),
        variant: i.variantName,
      })),
    })
  }, [order])

  const header = <ScreenHeader title="Order Confirmation" />
  if (isLoading || !orderId) return <Screen header={header} mode="none" loading skeleton={<ConfirmationLoading />} />

  if (error || !order) {
    return (
      <Screen header={header} mode="none">
        <ErrorState
          fill
          title="Order Not Found"
          message={(error instanceof Error && error.message) || 'Unable to load order details'}
          actionLabel="View All Orders"
          onAction={() => router.push('/orders')}
        />
      </Screen>
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
    <Screen header={header} scrollProps={{ showsVerticalScrollIndicator: false }}>
      <OrderCelebration orderId={order.id} orderNumber={order.orderNumber} />

      <Card className="mb-6">
        <Text accessibilityRole="header" className={HEADING}>
          Order Summary
        </Text>
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
            <Text className="font-display text-2xl font-extrabold text-accent-600 dark:text-accent-400">{money(total)}</Text>
          </View>
        </View>
      </Card>

      <Card className="mb-6">
        <Text accessibilityRole="header" className={HEADING}>
          Shipping Address
        </Text>
        {line1 ? <Text className="text-foreground-secondary">{line1}</Text> : null}
        {line2 ? <Text className="text-foreground-secondary">{line2}</Text> : null}
        <Text className="text-foreground-secondary">
          {addr.city}, {addr.state} {pin}
        </Text>
        <Text className="mt-2 text-foreground-secondary">Phone: {addr.phone}</Text>
      </Card>

      <Card className="mb-8">
        <Text accessibilityRole="header" className={HEADING}>
          Order Status
        </Text>
        <View className="flex-row flex-wrap items-center gap-3">
          <Badge label={statusLabel(status)} tone={statusTone(status)} />
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
      </Card>

      <Notice className="mb-8">A confirmation email has been sent to your email address with your order details.</Notice>

      <AiInsight kind="affirmation" className="mb-6" body={{ itemNames: order.items.map(i => i.productName) }} />

      <View className="gap-3">
        <Button label="View All Orders" onPress={() => router.push('/orders')} />
        <Button label="Continue Shopping" variant="outline" onPress={() => router.navigate('/(tabs)')} />
      </View>

      <RecommendedProducts title="Shop More Products" limit={4} />
    </Screen>
  )
}
