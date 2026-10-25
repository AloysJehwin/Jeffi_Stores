import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CreditCard, Receipt } from 'lucide-react-native'
import { listTransactions, type Transaction } from '../../src/api/account'
import { useInfiniteList, useRequireAuth } from '../../src/components/account/hooks'
import { InfiniteFooter } from '../../src/components/account/ui'
import { Badge, Caption, Card, Chip, ChipGroup, EmptyState, ModalSheet, Radio, Screen, Skeleton, statusTone, Text, TextButton, useBottomInset } from '../../src/ui'

// Mirror of controller-service components/shared/AccountTransactions.tsx (visitor).

const STATUSES = ['all', 'completed', 'pending', 'failed', 'refunded'] as const
const statusLabel = (s: string) => ({ completed: 'Completed', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' })[s] ?? s
const txnTone = (s: string) => (['completed', 'pending', 'failed', 'refunded'].includes(s) ? statusTone(s) : 'neutral')

function methodLabel(method: string, gateway: string) {
  if (gateway === 'razorpay') return 'Razorpay'
  if (method === 'cod') return 'Cash on Delivery'
  if (method === 'bank_transfer') return 'Bank Transfer'
  if (method === 'upi') return 'UPI'
  return method ? method.charAt(0).toUpperCase() + method.slice(1) : 'N/A'
}

// Status chips, then transaction cards: badges, amount + order, date.
function TransactionsLoading() {
  return (
    <View className="pt-4">
      <View className="mb-4 flex-row gap-2 overflow-hidden px-4">
        {[52, 104, 84, 70, 92].map((w, i) => (
          <Skeleton key={i} width={w} height={38} rounded="rounded-full" />
        ))}
      </View>
      <View className="gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={i} className="mx-4 rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
            <View className="mb-3 flex-row gap-2">
              <Skeleton height={24} width={84} rounded="rounded-full" />
              <Skeleton height={24} width={76} rounded="rounded-full" />
            </View>
            <View className="flex-row items-center gap-4">
              <Skeleton height={22} width={100} />
              <Skeleton height={13} width={110} />
            </View>
            <Skeleton height={10} width="60%" rounded="rounded" className="mt-2" />
            <Skeleton height={12} width={130} className="mt-4" />
          </View>
        ))}
      </View>
    </View>
  )
}

export default function TransactionsScreen() {
  const bottom = useBottomInset()
  const router = useRouter()
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

  const header =
    transactions.length > 0 ? (
      <ChipGroup scroll className="mb-4 pt-4">
        {STATUSES.map(s => (
          <Chip key={s} label={s === 'all' ? 'All' : statusLabel(s)} selected={filterStatus === s} onPress={() => setFilterStatus(s)} />
        ))}
        {methods.length > 1 && (
          <Chip
            label={filterMethod === 'all' ? 'All Methods' : filterMethod}
            icon={CreditCard}
            selected={filterMethod !== 'all'}
            onPress={() => setMethodOpen(true)}
          />
        )}
      </ChipGroup>
    ) : null

  return (
    <Screen title="Transactions" mode="none">
      {!user || list.loading ? (
        <FlatList data={[]} renderItem={null} ListHeaderComponent={<TransactionsLoading />} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={x => x.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: bottom }}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.5}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={
            transactions.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No transactions yet"
                message="Your payment transactions will appear here once you place an order."
                actionLabel="Browse Products"
                onAction={() => router.navigate('/(tabs)/products')}
              />
            ) : null
          }
          ListFooterComponent={
            <View className="px-4">
              <InfiniteFooter shown={transactions.length} list={list} noun="transactions" />
            </View>
          }
          renderItem={({ item: txn }) => (
            <Card className="mx-4">
              <View className="mb-2 flex-row flex-wrap items-center gap-2">
                <Badge label={statusLabel(txn.status)} tone={txnTone(txn.status)} />
                <Badge label={methodLabel(txn.paymentMethod, txn.paymentGateway)} />
              </View>
              <View className="flex-row flex-wrap items-center" style={{ columnGap: 16, rowGap: 4 }}>
                <Text className="font-display text-xl font-extrabold text-foreground">{Number(txn.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</Text>
                <TextButton label={`Order #${txn.orderNumber}`} onPress={() => router.push(`/orders/${txn.orderId}`)} />
              </View>
              {!!txn.transactionId && (
                <Caption className="mt-1 font-mono" numberOfLines={1}>
                  TXN: {txn.transactionId}
                </Caption>
              )}
              <Text className="mt-3 text-[13px] text-foreground-muted">
                {new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                {new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
              </Text>
            </Card>
          )}
        />
      )}

      <ModalSheet open={methodOpen} onClose={() => setMethodOpen(false)} title="Payment method">
        <View className="pb-2">
          {['all', ...methods].map(m => (
            <Radio
              key={m}
              selected={filterMethod === m}
              label={m === 'all' ? 'All Methods' : m}
              onSelect={() => {
                setFilterMethod(m)
                setMethodOpen(false)
              }}
            />
          ))}
        </View>
      </ModalSheet>
    </Screen>
  )
}
