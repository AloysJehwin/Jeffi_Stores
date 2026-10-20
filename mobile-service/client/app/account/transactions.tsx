import { View, Text, FlatList, TouchableOpacity } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import AccountHeader from '../../src/components/account/AccountHeader'
import Spinner from '../../src/components/ui/Spinner'

type Transaction = {
  id: string
  amount: number
  status: string
  paymentMethod: string | null
  paymentGateway: string | null
  transactionId: string | null
  createdAt: string
  orderId: string | null
  orderNumber: string | null
}

const STATUS: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  paid:       { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  success:    { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  pending:    { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  refunded:   { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400' },
  failed:     { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
}

export default function TransactionsScreen() {
  const router = useRouter()
  const { data, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api<{ transactions: Transaction[] }>('/api/transactions'),
  })

  const transactions = data?.transactions || []

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <AccountHeader activeTab="transactions" />

      {isLoading ? (
        <Spinner />
      ) : transactions.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="receipt-outline" size={64} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">No transactions yet</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const { bg, text } = STATUS[item.status?.toLowerCase()] || { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300' }
            const gateway = item.paymentGateway || item.paymentMethod
            return (
              <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-100 dark:border-[#3f4150] p-4">
                <View className="flex-row items-center gap-2 mb-2">
                  <View className={`px-2.5 py-0.5 rounded-full ${bg}`}>
                    <Text className={`text-xs font-semibold capitalize ${text}`}>{item.status}</Text>
                  </View>
                  {gateway && (
                    <View className="bg-gray-100 dark:bg-[#2e303b] px-2.5 py-0.5 rounded-full">
                      <Text className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                        {gateway.replace(/_/g, ' ')}
                      </Text>
                    </View>
                  )}
                </View>

                <View className="flex-row items-baseline gap-3 mb-1">
                  <Text className="text-xl font-black text-gray-900 dark:text-gray-100">
                    ₹{Number(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                  {item.orderNumber && item.orderId && (
                    <TouchableOpacity onPress={() => router.push(`/orders/${item.orderId}`)}>
                      <Text className="text-accent-600 dark:text-accent-400 text-sm font-semibold" numberOfLines={1}>
                        Order #{item.orderNumber}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {item.transactionId && (
                  <Text className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">
                    TXN: {item.transactionId}
                  </Text>
                )}

                <Text className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {'  '}
                  {new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </Text>
              </View>
            )
          }}
        />
      )}
    </View>
  )
}
