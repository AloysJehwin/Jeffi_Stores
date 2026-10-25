import { FlatList, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listBrandsWithCounts, type BrandWithCount } from '../../src/api/brands'
import TopNav from '../../src/components/layout/TopNav'
import CompareBar from '../../src/components/catalog/CompareBar'
import { ChevronRightIcon, TagIcon } from '../../src/components/catalog/icons'
import { EmptyCard, InfiniteFooter } from '../../src/components/catalog/Paged'
import { absUrl } from '../../src/lib/links'
import { accent, useTokens } from '../../src/theme'
import { Text, Skeleton } from '../../src/ui'

// Mirror of controller-service app/(storefront)/brands/page.tsx at the mobile breakpoint.

function BrandCard({ brand }: { brand: BrandWithCount }) {
  const router = useRouter()
  const t = useTokens()
  const n = brand.product_count
  const logo = absUrl(brand.logo_url)

  return (
    <View className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-sm">
      <Pressable onPress={() => router.push(`/brands/${brand.slug}`)} className="p-4">
        <View className="mb-4 flex-row items-start gap-4">
          <View className="h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
            {logo ? (
              <Image source={{ uri: logo }} contentFit="contain" style={{ width: '100%', height: '100%', margin: 4 }} accessibilityLabel={brand.name} />
            ) : (
              <TagIcon size={32} strokeWidth={1.5} color={t.foregroundMuted} />
            )}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-xl font-bold text-foreground">{brand.name}</Text>
            <Text className="mt-1 text-sm text-foreground-muted">{`${n} ${n === 1 ? 'product' : 'products'}`}</Text>
          </View>
        </View>

        {brand.description ? (
          <Text numberOfLines={2} className="mb-4 text-sm text-foreground-secondary">
            {brand.description}
          </Text>
        ) : null}

        <View className="flex-row items-center">
          <Text className="text-sm font-semibold text-accent-500">Browse Products</Text>
          <View className="ml-1">
            <ChevronRightIcon color={accent[500]} />
          </View>
        </View>
      </Pressable>
    </View>
  )
}

function BrandCardSkeleton() {
  return (
    <View className="rounded-lg border border-border-default bg-surface-elevated p-4">
      <View className="mb-4 flex-row items-start gap-4">
        <Skeleton width={64} height={64} rounded="rounded-lg" />
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
    </View>
  )
}

export default function BrandsScreen() {
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['brands', 'counts'], queryFn: listBrandsWithCounts, staleTime: 5 * 60_000 })
  const brands = data ?? []

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <FlatList
        data={brands}
        keyExtractor={b => b.id}
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        ItemSeparatorComponent={() => <View className="h-4" />}
        ListHeaderComponent={
          <>
            <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
              <Text className="mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground">All Brands</Text>
              <Text className="text-foreground-secondary">Browse products by brand</Text>
            </View>
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
              <InfiniteFooter
                shown={0}
                control={{ hasMore: false, loadingMore: false, error: error.message || 'Failed to load', loadMore: refetch, retry: refetch }}
              />
            </View>
          ) : (
            <View className="px-4">
              <EmptyCard title="No Brands Yet" body="Check back soon!" icon={<TagIcon size={96} strokeWidth={1} color={t.foregroundMuted} />} />
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
    </View>
  )
}
