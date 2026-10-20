import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import TopNav from '../../src/components/layout/TopNav'
import { listTransactions, type Transaction } from '../../src/api/account'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { FilterChip, InfiniteFooter, NEUTRAL_TONE, ORDER_STATUS_TONE, Pulse, StatusPill } from '../../src/components/account/ui'
import { useTokens } from '../../src/theme'

// Mirror of controller-service components/shared/AccountTransactions.tsx (visitor).

const STATUSES = ['all', 'completed', 'pending', 'failed', 'refunded'] as const
const statusLabel = (s: string) => ({ completed: 'Completed', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' })[s] ?? s
const statusTone = (s: string) => (['completed', 'pending', 'failed', 'refunded'].includes(s) ? ORDER_STATUS_TONE[s] : NEUTRAL_TONE)

function methodLabel(method: string, gateway: string) {
  if (gateway === 'razorpay') return 'Razorpay'
  if (method === 'cod') return 'Cash on Delivery'
  if (method === 'bank_transfer') return 'Bank Transfer'
  if (method === 'upi') return 'UPI'
  return method ? method.charAt(0).toUpperCase() + method.slice(1) : 'N/A'
}

function Skeleton() {
  return (
    <View className="px-4 pt-4 pb-8 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <View className="flex-row items-center justify-between mb-2">
            <Pulse className="h-3 bg-surface-secondary rounded w-32" />
            <Pulse className="h-5 bg-surface-secondary rounded-full w-16" />
          </View>
          <View className="flex-row items-center justify-between">
            <Pulse className="h-4 bg-surface-secondary rounded w-24" />
            <Pulse className="h-4 bg-surface-secondary rounded w-20" />
          </View>
        </View>
      ))}
    </View>
  )
}

export default function TransactionsScreen() {
  const router = useRouter()
  const t = useTokens()
  const user = useRequireAuth()
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterMethod, setFilterMethod] = useState<string>('all')
  const [methodOpen, setMethodOpen] = useState(false)

  const list = useInfiniteList<Transaction>({
    key: ['transactions', user?.id ?? null],
    enabled: !!user,
    pageSize: 10,
    fetchPage: async p => {
      const d = await listTransactions(p)
      return { rows: d.transactions || [], total: Number(d.total ?? 0) }
    },
  })
  const transactions = list.rows

  const methods = useMemo(() => Array.from(new Set(transactions.map(x => methodLabel(x.paymentMethod, x.paymentGateway)))), [transactions])
  const filtered = useMemo(
    () =>
      transactions.filter(x => {
        if (filterStatus !== 'all' && x.status !== filterStatus) return false
        if (filterMethod !== 'all' && methodLabel(x.paymentMethod, x.paymentGateway) !== filterMethod) return false
        return true
      }),
    [transactions, filterStatus, filterMethod]
  )

  const header = (
    <>
      <AccountMobileHeader />
      {transactions.length > 0 && (
        <View className="px-4 pt-4 mb-4 flex-row flex-wrap items-center gap-3">
          <View className="flex-row flex-wrap items-center gap-1.5">
            {STATUSES.map(s => (
              <FilterChip key={s} label={s === 'all' ? 'All' : statusLabel(s)} active={filterStatus === s} onPress={() => setFilterStatus(s)} />
            ))}
          </View>
          {methods.length > 1 && (
            <Pressable onPress={() => setMethodOpen(true)} className="flex-row items-center gap-1 px-3 py-1 rounded-full border border-border-default bg-surface-elevated">
              <Text className="text-xs text-foreground-secondary">{filterMethod === 'all' ? 'All Methods' : filterMethod}</Text>
              <HeroIcon name="chevronDown" size={12} color={t.foregroundSecondary} />
            </Pressable>
          )}
        </View>
      )}
    </>
  )

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      {!user || list.loading ? (
        <FlatList data={[]} renderItem={null} ListHeaderComponent={<><AccountMobileHeader /><Skeleton /></>} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={x => x.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 32 }}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.5}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          ListEmptyComponent={
            transactions.length === 0 ? (
              <View className="mx-4 mt-4 bg-surface-elevated rounded-lg border border-border-default p-12 items-center">
                <HeroIcon name="receipt" size={64} color={t.foregroundMuted} strokeWidth={1.5} />
                <Text className="text-xl font-semibold text-foreground mb-2 mt-4">No transactions yet</Text>
                <Text className="text-foreground-secondary mb-6 text-center">Your payment transactions will appear here once you place an order.</Text>
                <Pressable onPress={() => router.navigate('/(tabs)/products')} className="px-6 py-3 bg-accent-500 rounded-lg">
                  <Text className="text-white font-semibold">Browse Products</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListFooterComponent={
            <View className="px-4">
              <InfiniteFooter shown={transactions.length} list={list} noun="transactions" />
            </View>
          }
          renderItem={({ item: txn }) => (
            <View className="mx-4 bg-surface-elevated rounded-lg border border-border-default p-4" style={{ boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
              <View className="flex-row flex-wrap items-center gap-2 mb-2">
                <StatusPill tone={statusTone(txn.status)} label={statusLabel(txn.status)} />
                <StatusPill tone={{ bg: 'bg-surface-secondary', text: 'text-foreground-secondary' }} label={methodLabel(txn.paymentMethod, txn.paymentGateway)} />
              </View>
              <View className="flex-row flex-wrap items-baseline" style={{ columnGap: 16, rowGap: 4 }}>
                <Text className="text-lg font-bold text-foreground">{Number(txn.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</Text>
                <Text className="text-sm text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.push(`/orders/${txn.orderId}`)}>
                  Order #{txn.orderNumber}
                </Text>
              </View>
              {!!txn.transactionId && (
                <Text className="text-xs text-foreground-muted mt-1 font-mono" numberOfLines={1}>
                  TXN: {txn.transactionId}
                </Text>
              )}
              <View className="mt-4">
                <Text className="text-sm text-foreground-muted">
                  {new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={methodOpen} transparent animationType="fade" onRequestClose={() => setMethodOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-center px-8" onPress={() => setMethodOpen(false)}>
          <View className="bg-surface-elevated rounded-xl border border-border-default py-2">
            {['all', ...methods].map(m => (
              <Pressable
                key={m}
                onPress={() => {
                  setFilterMethod(m)
                  setMethodOpen(false)
                }}
                className={`px-4 py-3 ${filterMethod === m ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
              >
                <Text className={`text-sm ${filterMethod === m ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground'}`}>
                  {m === 'all' ? 'All Methods' : m}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}
