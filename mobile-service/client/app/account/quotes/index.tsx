import { useEffect } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { FileText } from 'lucide-react-native'
import { listRfqs, type Rfq } from '../../src/api/account'
import { useAccountUser, useInfiniteList } from '../../src/components/account/hooks'
import { InfiniteFooter } from '../../src/components/account/ui'
import { useAuthStore } from '../../src/stores/authStore'
import { Badge, BodySmall, Caption, Card, EmptyState, Screen, Skeleton, Text, useBottomInset, type Tone } from '../../src/ui'

// Mirror of controller-service app/(storefront)/account/quotes/page.tsx.

const STATUS_TONE: Record<string, Tone> = { pending: 'warning', reviewed: 'info', converted: 'success', rejected: 'danger' }

// The loaded list: intro line, then RFQ cards.
function QuotesLoading() {
  return (
    <View className="gap-3 px-4 pt-4">
      <View className="mb-1 gap-1.5">
        <Skeleton height={12} width="85%" />
        <Skeleton height={12} width="45%" />
      </View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} className="gap-2 rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
          <View className="mb-1 flex-row items-center gap-2">
            <Skeleton height={14} width={120} />
            <Skeleton height={20} width={72} rounded="rounded-full" />
          </View>
          <Skeleton height={12} width={60} />
          <Skeleton height={10} width={130} rounded="rounded" />
        </View>
      ))}
    </View>
  )
}

export default function QuotesScreen() {
  const bottom = useBottomInset()
  const router = useRouter()
  const user = useAccountUser()
  const isLoading = useAuthStore(s => s.isLoading)
  const allowed = !!user?.isBusiness && user.approvalStatus === 'approved'

  useEffect(() => {
    if (!isLoading && !allowed) router.replace(user ? '/(tabs)/account' : '/(auth)/login')
  }, [isLoading, allowed, user, router])

  const list = useInfiniteList<Rfq>({
    key: ['rfqs', user?.id ?? null],
    enabled: allowed,
    pageSize: 20,
    fetchPage: async p => {
      const d = await listRfqs(p)
      return { rows: d.rfqs || [], total: d.total ?? null }
    },
  })
  const rfqs = list.rows

  return (
    <Screen title="My Quotes" mode="none" loading={isLoading || !allowed || list.loading} skeleton={<QuotesLoading />}>
      <FlatList
        data={rfqs}
        keyExtractor={r => r.id}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: bottom }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={<BodySmall className="mx-4 mb-4 mt-4">Track your RFQ submissions. Our team will review and respond.</BodySmall>}
        ListEmptyComponent={
          <EmptyState
            icon={FileText}
            title="No quote requests yet"
            message="Use the “Request Quote” button on any product page or cart to get started."
            actionLabel="Browse Products"
            onAction={() => router.navigate('/(tabs)/products')}
          />
        }
        renderItem={({ item: rfq }) => (
          <Card className="mx-4 gap-1.5">
            <View className="mb-1 flex-row items-center gap-2">
              <Text className="font-mono text-sm font-semibold text-foreground">{rfq.rfq_number}</Text>
              <Badge label={rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)} tone={STATUS_TONE[rfq.status] ?? 'warning'} size="sm" />
            </View>
            <BodySmall>
              {rfq.item_count} item{rfq.item_count !== 1 ? 's' : ''}
            </BodySmall>
            {!!rfq.notes && (
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {rfq.notes}
              </Text>
            )}
            <Caption>Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Caption>
            {rfq.status === 'converted' && !!rfq.converted_quotation_id && (
              <Text className="text-xs font-semibold text-green-700 dark:text-green-400">Quotation sent — check your email</Text>
            )}
          </Card>
        )}
        ListFooterComponent={
          <View className="px-4">
            <InfiniteFooter shown={rfqs.length} list={list} noun="quotes" />
          </View>
        }
      />
    </Screen>
  )
}
