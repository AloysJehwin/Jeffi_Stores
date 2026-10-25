import { useState } from 'react'
import { FlatList, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ImageOff, ShoppingBag } from 'lucide-react-native'
import { cancelOrder } from '../../src/api/orders'
import { listOrdersPage, type ListOrder } from '../../src/api/account'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { InfiniteFooter, orderStatusLabel } from '../../src/components/account/ui'
import { Badge, Card, confirm, Divider, EmptyState, Screen, Skeleton, statusTone, Text, TextButton, useBottomInset } from '../../src/ui'
import { useTokens } from '../../src/theme'

// Mirror of controller-service app/(storefront)/account/orders/page.tsx (the sm:hidden mobile card).

const fmt = (n: number | string | null | undefined) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function resolveOrderEdd(order: ListOrder): string | null {
  if (!order.estimated_delivery_date) return null
  return new Date(order.estimated_delivery_date + 'T00:00:00Z').toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function getEddDisplay(order: ListOrder, edd: string): { label: string; color: string } {
  if (order.status === 'delivered') return { label: edd ? 'Delivered · ' + edd : 'Delivered', color: 'text-green-600 dark:text-green-400' }
  if (order.status === 'out_for_delivery') return { label: 'Arriving Today', color: 'text-accent-600 dark:text-accent-400' }
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  todayIST.setHours(0, 0, 0, 0)
  const eddDate = new Date(String(order.estimated_delivery_date).slice(0, 10) + 'T00:00:00')
  const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Arriving Today', color: 'text-accent-600 dark:text-accent-400' }
  if (diffDays === 1) return { label: 'Arriving Tomorrow', color: 'text-accent-600 dark:text-accent-400' }
  if (diffDays < 0) return { label: 'Delayed · ' + edd, color: 'text-orange-600 dark:text-orange-400' }
  return { label: 'Est. ' + edd, color: 'text-foreground-muted' }
}

const qtyText = (q: number, mode?: string, unit?: string | null) =>
  mode === 'weight' || mode === 'length' ? `${Number(q).toFixed(3)} ${unit ?? ''}` : String(Math.round(Number(q)))

// OrderCard's shape: number and status, meta line, first line item, actions row.
function OrdersLoading() {
  return (
    <View className="gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="mx-4 rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
          <View className="flex-row items-center justify-between">
            <Skeleton height={16} width={150} />
            <Skeleton height={24} width={84} rounded="rounded-full" />
          </View>
          <View className="mt-2 flex-row gap-3">
            <Skeleton height={11} width={80} rounded="rounded" />
            <Skeleton height={11} width={64} rounded="rounded" />
          </View>
          <View className="mt-4 flex-row items-center gap-3">
            <Skeleton width={56} height={56} rounded="rounded-xl" />
            <View className="flex-1 gap-2">
              <Skeleton height={13} width="75%" />
              <Skeleton height={11} width="35%" />
            </View>
          </View>
          <View className="mt-4 h-px bg-border-default" />
          <View className="mt-3 flex-row items-center justify-between">
            <Skeleton height={13} width={90} />
            <Skeleton height={11} width={110} rounded="rounded" />
          </View>
        </View>
      ))}
    </View>
  )
}

function OrderCard({ order, cancelling, onCancel }: { order: ListOrder; cancelling: boolean; onCancel: () => void }) {
  const router = useRouter()
  const t = useTokens()
  const first = order.order_items[0]
  const img = first?.products?.product_images?.find(i => i.is_primary) || first?.products?.product_images?.[0]
  const extra = order.order_items.length - 1
  const date = new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const edd = resolveOrderEdd(order)
  const eddShow = edd && !['cancelled', 'returned'].includes(order.status) ? getEddDisplay(order, edd) : null
  const open = () => router.push(`/orders/${order.id}`)

  return (
    <Card className="mx-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text accessibilityRole="link" onPress={open} className="flex-1 font-mono text-sm font-semibold text-foreground" numberOfLines={1}>
          {order.order_number}
        </Text>
        <Badge label={orderStatusLabel(order.status)} tone={statusTone(order.status)} />
      </View>
      <View className="mt-1.5 flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <Text className="text-[13px] text-foreground-secondary">{date}</Text>
        <View className="h-3 w-px bg-border-default" />
        <Text className="text-[13px] font-semibold text-foreground">₹{fmt(order.total_amount)}</Text>
        {eddShow && (
          <>
            <View className="h-3 w-px bg-border-default" />
            <Text className={`text-[13px] font-medium ${eddShow.color}`}>{eddShow.label}</Text>
          </>
        )}
      </View>
      {first && (
        <View className="mt-4 flex-row items-center gap-3">
          <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-surface">
            {img ? <Image recyclingKey={img.thumbnail_url} source={{ uri: img.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <ImageOff size={20} color={t.foregroundMuted} />}
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
              {first.product_name}
            </Text>
            <Text className="mt-0.5 text-[13px] text-foreground-secondary">
              Qty: {qtyText(first.quantity, first.buy_mode, first.buy_unit)}
              {extra > 0 && (
                <Text className="text-foreground-muted">
                  {'  '}+{extra} more item{extra > 1 ? 's' : ''}
                </Text>
              )}
            </Text>
          </View>
        </View>
      )}
      <Divider className="mb-2 mt-4" />
      <View className="flex-row items-center justify-between gap-2">
        <TextButton label="View Details" onPress={open} />
        {(order.status === 'pending' || order.status === 'confirmed') && (
          <TextButton label={cancelling ? 'Submitting…' : 'Request Cancellation'} tone="danger" onPress={() => !cancelling && onCancel()} />
        )}
      </View>
    </Card>
  )
}

export default function OrdersScreen() {
  const bottom = useBottomInset()
  const router = useRouter()
  const user = useRequireAuth()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const list = useInfiniteList<ListOrder>({
    key: ['orders-list', user?.id ?? null],
    enabled: !!user,
    pageSize: 10,
    fetchPage: async p => {
      const d = await listOrdersPage(p)
      return { rows: d.orders || [], total: d.total ?? null }
    },
  })
  const orders = list.rows

  const handleCancel = async (orderId: string) => {
    const ok = await confirm({
      title: 'Request cancellation?',
      message: 'Request cancellation for this order? This action cannot be undone.',
      confirmLabel: 'Request Cancellation',
      cancelLabel: 'Keep Order',
      destructive: true,
    })
    if (!ok) return
    setCancellingId(orderId)
    try {
      await cancelOrder(orderId)
      list.reload()
    } catch {
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <Screen title="My Orders" mode="none">
      <FlatList
        data={!user || list.loading ? [] : orders}
        keyExtractor={o => o.id}
        contentContainerStyle={{ paddingBottom: bottom }}
        ListHeaderComponent={<View style={{ height: 16 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <OrderCard order={item} cancelling={cancellingId === item.id} onCancel={() => handleCancel(item.id)} />}
        ListEmptyComponent={
          !user || list.loading ? (
            <OrdersLoading />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              message="You haven't placed any orders yet."
              actionLabel="Start Shopping"
              onAction={() => router.navigate('/(tabs)/products')}
            />
          )
        }
        ListFooterComponent={
          <View className="px-4">
            <InfiniteFooter shown={orders.length} list={list} noun="orders" />
          </View>
        }
      />
    </Screen>
  )
}
