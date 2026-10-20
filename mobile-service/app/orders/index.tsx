import { useState } from 'react'
import { View, Text, FlatList, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listOrders } from '../../src/api/orders'
import type { Order } from '../../src/types'
import AccountHeader from '../../src/components/account/AccountHeader'
import Spinner from '../../src/components/ui/Spinner'

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending:           { bg: 'bg-yellow-100 dark:bg-yellow-900/30',  text: 'text-yellow-800 dark:text-yellow-300' },
  confirmed:         { bg: 'bg-blue-100 dark:bg-blue-900/30',      text: 'text-blue-800 dark:text-blue-300' },
  processing:        { bg: 'bg-blue-100 dark:bg-blue-900/30',      text: 'text-blue-800 dark:text-blue-300' },
  shipped:           { bg: 'bg-purple-100 dark:bg-purple-900/30',  text: 'text-purple-800 dark:text-purple-300' },
  out_for_delivery:  { bg: 'bg-indigo-100 dark:bg-indigo-900/30',  text: 'text-indigo-800 dark:text-indigo-300' },
  delivered:         { bg: 'bg-green-100 dark:bg-green-900/30',    text: 'text-green-800 dark:text-green-300' },
  cancel_requested:  { bg: 'bg-orange-100 dark:bg-orange-900/30',  text: 'text-orange-800 dark:text-orange-300' },
  cancel_rejected:   { bg: 'bg-red-100 dark:bg-red-900/30',        text: 'text-red-800 dark:text-red-300' },
  cancelled:         { bg: 'bg-red-100 dark:bg-red-900/30',        text: 'text-red-800 dark:text-red-300' },
  return_requested:  { bg: 'bg-orange-100 dark:bg-orange-900/30',  text: 'text-orange-800 dark:text-orange-300' },
  return_approved:   { bg: 'bg-blue-100 dark:bg-blue-900/30',      text: 'text-blue-800 dark:text-blue-300' },
  return_received:   { bg: 'bg-blue-100 dark:bg-blue-900/30',      text: 'text-blue-800 dark:text-blue-300' },
  return_rejected:   { bg: 'bg-red-100 dark:bg-red-900/30',        text: 'text-red-800 dark:text-red-300' },
  returned:          { bg: 'bg-gray-100 dark:bg-gray-800',          text: 'text-gray-700 dark:text-gray-300' },
}

const STATUS_LABEL: Record<string, string> = {
  cancel_requested: 'Cancellation Requested',
  cancel_rejected:  'Cancellation Rejected',
  return_requested: 'Return Requested',
  return_approved:  'Return Approved',
  return_received:  'Return Received',
  return_rejected:  'Return Rejected',
  out_for_delivery: 'Out for Delivery',
}

function OrderCard({ order }: { order: Order }) {
  const router = useRouter()
  const { bg, text } = STATUS_COLOR[order.status] || { bg: 'bg-gray-100', text: 'text-gray-700' }
  const label = STATUS_LABEL[order.status] || order.status.replace(/_/g, ' ')

  return (
    <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] overflow-hidden mb-4">
      <View className="bg-gray-50 dark:bg-[#2e303b] border-b border-gray-100 dark:border-[#3f4150] px-4 py-3">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-xs text-gray-400 mb-0.5">Order Number</Text>
            <Text className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100" numberOfLines={2}>
              {order.orderNumber}
            </Text>
          </View>
          <View className="mr-4">
            <Text className="text-xs text-gray-400 mb-0.5">Order Date</Text>
            <Text className="text-xs text-gray-700 dark:text-gray-300">
              {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-gray-400 mb-0.5">Total</Text>
            <Text className="text-sm font-bold text-gray-900 dark:text-gray-100">
              ₹{Number(order.totalAmount).toLocaleString('en-IN')}
            </Text>
          </View>
        </View>
      </View>

      <View className="px-4 pt-3 pb-1">
        <View className={`self-start px-3 py-1 rounded-full ${bg}`}>
          <Text className={`text-xs font-semibold capitalize ${text}`}>{label}</Text>
        </View>
      </View>

      <View className="px-4 pt-2 pb-3 gap-3">
        {order.items?.map((item) => {
          const imgs = item.products?.product_images || []
          const img = imgs.find((i) => i.is_primary) || imgs[0]
          const qty = item.buyMode === 'weight' || item.buyMode === 'length'
            ? `${Number(item.quantity).toFixed(3)} ${item.buyUnit ?? ''}`
            : String(Math.round(Number(item.quantity)))
          return (
            <View key={item.id} className="flex-row gap-3">
              <View className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-[#2e303b] overflow-hidden border border-gray-100 dark:border-[#3f4150] shrink-0">
                {img?.thumbnail_url ? (
                  <>
                    <Image source={{ uri: img.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" blurRadius={10} />
                    <Image source={{ uri: img.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="contain" />
                  </>
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Ionicons name="image-outline" size={24} color="#9CA3AF" />
                  </View>
                )}
              </View>
              <View className="flex-1">
                <Text className="font-medium text-gray-900 dark:text-gray-100 text-sm leading-snug" numberOfLines={2}>
                  {item.productName}
                </Text>
                {item.variantName ? (
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.variantName}</Text>
                ) : null}
                <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Quantity: {qty}</Text>
                <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-0.5">
                  ₹{Number(item.unitPrice).toLocaleString('en-IN')} × {qty} = ₹{Number(item.totalPrice).toLocaleString('en-IN')}
                </Text>
              </View>
            </View>
          )
        })}
      </View>

      {order.shippingAddress && (
        <View className="px-4 pb-3 pt-2 border-t border-gray-100 dark:border-[#3f4150]">
          <Text className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">Shipping Address</Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">{order.shippingAddress.address_line1}</Text>
          {order.shippingAddress.address_line2 ? (
            <Text className="text-sm text-gray-500 dark:text-gray-400">{order.shippingAddress.address_line2}</Text>
          ) : null}
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal_code}
          </Text>
        </View>
      )}

      <View className="flex-row justify-between items-center px-4 py-3 border-t border-gray-100 dark:border-[#3f4150]">
        <TouchableOpacity onPress={() => router.push(`/orders/${order.id}` as any)} className="flex-row items-center gap-1">
          <Text className="text-accent-600 dark:text-accent-400 text-sm font-semibold">View Order Details</Text>
          <Ionicons name="chevron-forward" size={14} color="#5a8a00" />
        </TouchableOpacity>
      </View>
    </View>
  )
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <View className="flex-row items-center justify-center gap-2 py-4">
      <TouchableOpacity
        onPress={() => onPage(Math.max(1, page - 1))}
        disabled={page === 1}
        className={`flex-row items-center gap-1 px-4 py-2.5 rounded-xl border ${
          page === 1
            ? 'border-gray-200 dark:border-[#3f4150] opacity-40'
            : 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
        }`}
      >
        <Ionicons name="chevron-back" size={16} color={page === 1 ? '#9CA3AF' : '#7cb900'} />
        <Text className={`text-sm font-semibold ${page === 1 ? 'text-gray-400' : 'text-accent-600 dark:text-accent-400'}`}>
          Prev
        </Text>
      </TouchableOpacity>

      <View className="flex-row items-center gap-1">
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pageNum: number
          if (totalPages <= 5) {
            pageNum = i + 1
          } else if (page <= 3) {
            pageNum = i + 1
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i
          } else {
            pageNum = page - 2 + i
          }
          return (
            <TouchableOpacity
              key={pageNum}
              onPress={() => onPage(pageNum)}
              className={`w-9 h-9 rounded-xl items-center justify-center border ${
                pageNum === page
                  ? 'bg-accent-500 border-accent-500'
                  : 'border-gray-200 dark:border-[#3f4150] bg-white dark:bg-[#24252f]'
              }`}
            >
              <Text className={`text-sm font-bold ${pageNum === page ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {pageNum}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <TouchableOpacity
        onPress={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className={`flex-row items-center gap-1 px-4 py-2.5 rounded-xl border ${
          page === totalPages
            ? 'border-gray-200 dark:border-[#3f4150] opacity-40'
            : 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
        }`}
      >
        <Text className={`text-sm font-semibold ${page === totalPages ? 'text-gray-400' : 'text-accent-600 dark:text-accent-400'}`}>
          Next
        </Text>
        <Ionicons name="chevron-forward" size={16} color={page === totalPages ? '#9CA3AF' : '#7cb900'} />
      </TouchableOpacity>
    </View>
  )
}

export default function OrdersScreen() {
  const router = useRouter()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', page],
    queryFn: () => listOrders(page),
  })

  const orders = data?.orders || []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 10
  const totalPages = Math.ceil(total / pageSize)

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <AccountHeader activeTab="orders" />

      {isLoading ? (
        <Spinner />
      ) : orders.length === 0 && page === 1 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="bag-outline" size={64} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">No orders yet</Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1 text-center">You haven&apos;t placed any orders yet.</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')} className="mt-6 bg-accent-500 px-8 py-3 rounded-xl">
            <Text className="text-white font-semibold">Start Shopping</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <OrderCard order={item} />}
          ListFooterComponent={
            <Pagination page={page} totalPages={totalPages} onPage={(p) => setPage(p)} />
          }
        />
      )}
    </View>
  )
}
