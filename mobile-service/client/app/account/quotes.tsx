import { useEffect } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import TopNav from '../../src/components/layout/TopNav'
import { listRfqs, type Rfq } from '../../src/api/account'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useAccountUser, useInfiniteList } from '../../src/components/account/hooks'
import { InfiniteFooter, Pulse } from '../../src/components/account/ui'
import { useAuthStore } from '../../src/stores/authStore'
import { useTokens } from '../../src/theme'

// Mirror of controller-service app/(storefront)/account/quotes/page.tsx.

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  reviewed: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  converted: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
}

function Skeleton() {
  return (
    <View className="px-4 pt-4 pb-8 gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <View className="flex-row items-center justify-between mb-2">
            <Pulse className="h-4 bg-surface-secondary rounded w-36" />
            <Pulse className="h-5 bg-surface-secondary rounded-full w-20" />
          </View>
          <Pulse className="h-3 bg-surface-secondary rounded w-48 mb-1" />
          <Pulse className="h-3 bg-surface-secondary rounded w-24" />
        </View>
      ))}
    </View>
  )
}

export default function QuotesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const t = useTokens()
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

  if (isLoading || !allowed || list.loading) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <Skeleton />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <FlatList
        data={rfqs}
        keyExtractor={r => r.id}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={
          <>
            <AccountMobileHeader />
            <View className="mx-4 mt-4 bg-surface-elevated rounded-t-lg border border-border-default px-6 py-4">
              <Text className="text-sm text-foreground-secondary">Track your RFQ submissions. Our team will review and respond.</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View className="mx-4 bg-surface-elevated border-x border-border-default p-12 items-center">
            <HeroIcon name="copy" size={64} color={t.foregroundMuted} strokeWidth={1} />
            <Text className="text-foreground-secondary font-medium mt-4">No quote requests yet</Text>
            <Text className="text-sm text-foreground-muted mt-1 text-center">Use the “Request Quote” button on any product page or cart to get started.</Text>
            <Text onPress={() => router.navigate('/(tabs)/products')} className="mt-4 text-sm font-medium text-accent-600 dark:text-accent-400">
              Browse Products
            </Text>
          </View>
        }
        renderItem={({ item: rfq }) => {
          const tone = STATUS_STYLES[rfq.status] || STATUS_STYLES.pending
          return (
            <View className="mx-4 bg-surface-elevated border-x border-t border-border-default p-5 gap-2">
              <View className="flex-row items-center gap-2 mb-1">
                <Text className="font-semibold text-foreground font-mono text-sm">{rfq.rfq_number}</Text>
                <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
                  <Text className={`text-xs font-semibold ${tone.text}`}>{rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}</Text>
                </View>
              </View>
              <Text className="text-sm text-foreground-secondary">
                {rfq.item_count} item{rfq.item_count !== 1 ? 's' : ''}
              </Text>
              {!!rfq.notes && (
                <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                  {rfq.notes}
                </Text>
              )}
              <Text className="text-xs text-foreground-muted">
                Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              {rfq.status === 'converted' && !!rfq.converted_quotation_id && (
                <Text className="text-xs text-green-700 dark:text-green-400 font-medium">Quotation sent — check your email</Text>
              )}
            </View>
          )
        }}
        ListFooterComponent={
          <View className="mx-4 bg-surface-elevated rounded-b-lg border border-border-default px-6 py-3">
            <InfiniteFooter shown={rfqs.length} list={list} noun="quotes" />
          </View>
        }
      />
    </View>
  )
}
