import { useState } from 'react'
import { Alert, FlatList, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { cancelOrder } from '../../src/api/orders'
import { listOrdersPage, type ListOrder } from '../../src/api/account'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { InfiniteFooter, NEUTRAL_TONE, ORDER_STATUS_TONE, orderStatusLabel, StatusPill } from '../../src/components/account/ui'
import { Screen, Skeleton, Text, useBottomInset } from '../../src/ui'
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
  if (order.status === 'out_for_delivery') return { label: 'Arriving Today', color: 'text-accent-500' }
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  todayIST.setHours(0, 0, 0, 0)
  const eddDate = new Date(String(order.estimated_delivery_date).slice(0, 10) + 'T00:00:00')
  const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Arriving Today', color: 'text-accent-500' }
  if (diffDays === 1) return { label: 'Arriving Tomorrow', color: 'text-accent-500' }
  if (diffDays < 0) return { label: 'Delayed · ' + edd, color: 'text-orange-500 dark:text-orange-400' }
  return { label: 'Est. ' + edd, color: 'text-foreground-muted' }
}

const qtyText = (q: number, mode?: string, unit?: string | null) =>
  mode === 'weight' || mode === 'length' ? `${Number(q).toFixed(3)} ${unit ?? ''}` : String(Math.round(Number(q)))

// OrderCard's shape: header strip, first line item, actions row.
function OrdersLoading() {
  return (
    <View className="gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="mx-4 overflow-hidden rounded-lg border border-border-default bg-surface-elevated">
          <View className="gap-2 border-b border-border-default bg-surface px-4 py-3">
            <View className="flex-row items-center justify-between">
              <Skeleton height={16} width={150} />
              <Skeleton height={20} width={80} rounded="rounded-full" />
            </View>
            <View className="flex-row gap-3">
              <Skeleton height={11} width={80} rounded="rounded" />
              <Skeleton height={11} width={64} rounded="rounded" />
            </View>
          </View>
          <View className="px-4 py-3">
            <View className="flex-row items-center gap-3">
              <Skeleton width={48} height={48} rounded="rounded-lg" />
              <View className="flex-1 gap-2">
                <Skeleton height={13} width="75%" />
                <Skeleton height={11} width="35%" />
              </View>
            </View>
            <View className="mt-3 flex-row items-center justify-between border-t border-border-default pt-3">
              <Skeleton height={13} width={90} />
              <Skeleton height={11} width={110} rounded="rounded" />
            </View>
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
    <View className="mx-4 bg-surface-elevated rounded-lg border border-border-default overflow-hidden" style={{ boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
      <View className="bg-surface border-b border-border-default px-4 py-3">
        <View className="flex-row items-center justify-between gap-2 mb-1.5">
          <Text onPress={open} className="flex-1 font-mono text-sm font-semibold text-foreground" numberOfLines={1}>
            {order.order_number}
          </Text>
          <StatusPill tone={ORDER_STATUS_TONE[order.status] ?? NEUTRAL_TONE} label={orderStatusLabel(order.status)} />
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Text className="text-xs text-foreground-secondary">{date}</Text>
          <View className="w-px h-3 bg-border-default" />
          <Text className="text-xs font-semibold text-foreground">₹{fmt(order.total_amount)}</Text>
          {eddShow && (
            <>
              <View className="w-px h-3 bg-border-default" />
              <Text className={`text-xs font-medium ${eddShow.color}`}>{eddShow.label}</Text>
            </>
          )}
        </View>
      </View>
      <View className="px-4 py-3">
        {first && (
          <View className="flex-row gap-3 items-center">
            <View className="w-12 h-12 bg-surface rounded-lg overflow-hidden border border-border-default items-center justify-center">
              {img ? (
                <Image source={{ uri: img.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <HeroIcon name="photo" size={20} color={t.foregroundMuted} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                {first.product_name}
              </Text>
              <Text className="text-xs text-foreground-secondary mt-0.5">
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
        <View className="mt-3 pt-3 border-t border-border-default flex-row items-center justify-between gap-2">
          <Pressable onPress={open} className="flex-row items-center">
            <Text className="text-accent-600 dark:text-accent-400 font-medium text-sm">View Details</Text>
            <View className="ml-1">
              <HeroIcon name="chevronRight" size={16} color={t.accent600} />
            </View>
          </Pressable>
          {(order.status === 'pending' || order.status === 'confirmed') && (
            <Pressable onPress={onCancel} disabled={cancelling}>
              <Text className={`text-red-600 dark:text-red-400 text-xs font-medium ${cancelling ? 'opacity-50' : ''}`}>
                {cancelling ? 'Submitting…' : 'Request Cancellation'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

export default function OrdersScreen() {
  const bottom = useBottomInset()
  const router = useRouter()
  const t = useTokens()
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

  const handleCancel = (orderId: string) => {
    Alert.alert('Request cancellation?', 'Request cancellation for this order? This action cannot be undone.', [
      { text: 'Keep Order', style: 'cancel' },
      {
        text: 'Request Cancellation',
        style: 'destructive',
        onPress: async () => {
          setCancellingId(orderId)
          try {
            await cancelOrder(orderId)
            list.reload()
          } catch {
          } finally {
            setCancellingId(null)
          }
        },
      },
    ])
  }

  return (
    <Screen title="My Orders" mode="none">
      <FlatList
        data={!user || list.loading ? [] : orders}
        keyExtractor={o => o.id}
        contentContainerStyle={{ paddingBottom: bottom }}
        ListHeaderComponent={<View style={{ height: 16 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <OrderCard order={item} cancelling={cancellingId === item.id} onCancel={() => handleCancel(item.id)} />}
        ListEmptyComponent={
          !user || list.loading ? (
            <OrdersLoading />
          ) : (
            <View className="mx-4 bg-surface-elevated rounded-lg border border-border-default p-12 items-center">
              <HeroIcon name="bag" size={64} color={t.foregroundMuted} strokeWidth={1.5} />
              <Text className="text-xl font-semibold text-foreground mb-2 mt-4">No orders yet</Text>
              <Text className="text-foreground-secondary mb-6 text-center">You haven&apos;t placed any orders yet.</Text>
              <Pressable onPress={() => router.navigate('/(tabs)/products')} className="px-6 py-3 bg-accent-500 rounded-lg">
                <Text className="text-white font-semibold">Start Shopping</Text>
              </Pressable>
            </View>
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
