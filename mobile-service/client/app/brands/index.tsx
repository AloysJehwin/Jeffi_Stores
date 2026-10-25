import { FlatList, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { listBrandsWithCounts, type BrandWithCount } from '../../src/api/brands'
import CompareBar from '../../src/components/catalog/CompareBar'
import { ChevronRight, Tag } from 'lucide-react-native'
import { EmptyCard } from '../../src/components/catalog/Paged'
import { absUrl } from '../../src/lib/links'
import { useTokens } from '../../src/theme'
import { Card, ErrorState, Screen, ScreenHeader, Skeleton, Text, useBottomInset } from '../../src/ui'

// Mirror of controller-service app/(storefront)/brands/page.tsx at the mobile breakpoint.

function BrandCard({ brand }: { brand: BrandWithCount }) {
  const router = useRouter()
  const t = useTokens()
  const n = brand.product_count
  const logo = absUrl(brand.logo_url)

  return (
    <Card onPress={() => router.push(`/brands/${brand.slug}`)} accessibilityLabel={`${brand.name}, ${n} ${n === 1 ? 'product' : 'products'}`}>
      <View className="mb-4 flex-row items-start gap-4">
        <View className="h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
          {logo ? (
            <Image source={{ uri: logo }} contentFit="contain" style={{ width: '100%', height: '100%', margin: 4 }} />
          ) : (
            <Tag size={32} strokeWidth={1.5} color={t.foregroundMuted} />
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-display text-xl font-extrabold text-foreground">{brand.name}</Text>
          <Text className="mt-1 text-sm text-foreground-muted">{`${n} ${n === 1 ? 'product' : 'products'}`}</Text>
        </View>
      </View>

      {brand.description ? (
        <Text numberOfLines={2} className="mb-4 text-sm text-foreground-secondary">
          {brand.description}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-1">
        <Text className="text-sm font-semibold text-accent-600 dark:text-accent-400">Browse Products</Text>
        <ChevronRight size={16} color={t.accent600} />
      </View>
    </Card>
  )
}

function BrandCardSkeleton() {
  return (
    <Card>
      <View className="mb-4 flex-row items-start gap-4">
        <Skeleton width={64} height={64} rounded="rounded-xl" />
        <View className="flex-1 gap-2 pt-1">
          <Skeleton height={20} width="55%" />
          <Skeleton height={12} width={80} rounded="rounded" />
        </View>
      </View>
      <View className="mb-4 gap-2">
        <Skeleton height={12} />
        <Skeleton height={12} width="70%" />
      </View>
      <Skeleton height={14} width={130} rounded="rounded" />
    </Card>
  )
}

export default function BrandsScreen() {
  const bottomInset = useBottomInset(32)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['brands', 'counts'], queryFn: listBrandsWithCounts, staleTime: 5 * 60_000 })
  const brands = data ?? []

  return (
    <Screen header={<ScreenHeader title="All Brands" subtitle="Browse products by brand" />} mode="none">
      <FlatList
        data={brands}
        keyExtractor={b => b.id}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        ItemSeparatorComponent={() => <View className="h-4" />}
        ListHeaderComponent={
          <>
            <View className="h-4" />
            {isLoading ? (
              <View className="gap-4 px-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <BrandCardSkeleton key={i} />
                ))}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          isLoading ? null : error ? (
            <View className="px-4">
              <ErrorState message={error.message || 'Failed to load'} onRetry={refetch} />
            </View>
          ) : (
            <View className="px-4">
              <EmptyCard title="No Brands Yet" body="Check back soon!" icon={Tag} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <View className="px-4">
            <BrandCard brand={item} />
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      <CompareBar />
    </Screen>
  )
}
