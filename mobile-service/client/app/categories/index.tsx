import { FlatList, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { listCategories, withDetails, type CategoryDetail } from '../../src/api/categories'
import { getHome } from '../../src/api/home'
import CategoryIcon from '../../src/components/catalog/CategoryIcon'
import CompareBar from '../../src/components/catalog/CompareBar'
import { ChevronRightIcon } from '../../src/components/catalog/icons'
import { InfiniteFooter } from '../../src/components/catalog/Paged'
import { accent } from '../../src/theme'
import { Screen, ScreenHeader, Skeleton, Text, useBottomInset } from '../../src/ui'

// Mirror of controller-service app/(storefront)/categories/page.tsx at the mobile breakpoint.

function CategoryCard({ category, subcategories }: { category: CategoryDetail; subcategories: CategoryDetail[] }) {
  const router = useRouter()
  // The web page's total: own products plus the direct subcategories'.
  const n = (category.product_count ?? 0) + subcategories.reduce((sum, sub) => sum + (sub.product_count ?? 0), 0)

  return (
    <View className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-sm">
      <Pressable onPress={() => router.push(`/category/${category.slug}`)} className="p-4">
        <View className="mb-4 flex-row items-center gap-4">
          <View className="h-16 w-16 items-center justify-center rounded-lg bg-accent-100">
            <CategoryIcon iconName={category.icon_name} categoryName={category.name} color={accent[600]} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-xl font-bold text-foreground">{category.name}</Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              {`${n} ${n === 1 ? 'product' : 'products'}`}
            </Text>
          </View>
        </View>

        {category.description ? (
          <Text numberOfLines={2} className="mb-4 text-sm text-foreground-secondary">
            {category.description}
          </Text>
        ) : null}

        {subcategories.length > 0 ? (
          <View className="border-t border-border-default pt-4">
            <Text className="mb-2 text-xs font-medium text-foreground-muted">Subcategories:</Text>
            <View className="flex-row flex-wrap items-center gap-2">
              {subcategories.slice(0, 5).map(sub => (
                <View key={sub.id} className="rounded bg-surface-secondary px-2 py-1">
                  <Text className="text-xs text-foreground-secondary">{sub.name}</Text>
                </View>
              ))}
              {subcategories.length > 5 ? (
                <Text className="text-xs font-medium text-accent-600 dark:text-accent-400">+{subcategories.length - 5} more</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View className="mt-4 flex-row items-center">
          <Text className="text-sm font-semibold text-accent-500">Browse Products</Text>
          <View className="ml-1">
            <ChevronRightIcon color={accent[500]} />
          </View>
        </View>
      </Pressable>
    </View>
  )
}

function CategoryCardSkeleton() {
  return (
    <View className="rounded-lg border border-border-default bg-surface-elevated p-4">
      <View className="mb-4 flex-row items-center gap-4">
        <Skeleton width={64} height={64} rounded="rounded-lg" />
        <View className="flex-1 gap-2">
          <Skeleton height={20} width="55%" />
          <Skeleton height={12} width={80} rounded="rounded" />
        </View>
      </View>
      <View className="mb-4 gap-2">
        <Skeleton height={12} />
        <Skeleton height={12} width="70%" />
      </View>
      <View className="border-t border-border-default pt-4">
        <Skeleton height={10} width={90} rounded="rounded" className="mb-2" />
        <View className="flex-row gap-2">
          {[64, 80, 56].map((w, i) => (
            <Skeleton key={i} width={w} height={22} rounded="rounded" />
          ))}
        </View>
      </View>
      <Skeleton height={14} width={130} rounded="rounded" className="mt-4" />
    </View>
  )
}

export default function CategoriesScreen() {
  const bottomInset = useBottomInset(32)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 5 * 60_000 })
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: getHome, staleTime: 120_000 })
  const categories = withDetails(data ?? [], home?.data.mainCategories as Record<string, any>[] | undefined)
  const main = categories.filter(c => !c.parent_category_id)
  const subsOf = (id: string) => categories.filter(c => c.parent_category_id === id)

  return (
    <Screen header={<ScreenHeader title="All Categories" subtitle="Browse our complete range of product categories" />} mode="none">
      <FlatList
        data={main}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        ItemSeparatorComponent={() => <View className="h-4" />}
        ListHeaderComponent={
          <>
            <View className="h-4" />
            {isLoading ? (
              <View className="gap-4 px-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <CategoryCardSkeleton key={i} />
                ))}
              </View>
            ) : error && !data ? (
              <View className="px-4">
                <InfiniteFooter
                  shown={0}
                  control={{ hasMore: false, loadingMore: false, error: error.message || 'Failed to load', loadMore: refetch, retry: refetch }}
                />
              </View>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <View className="px-4">
            <CategoryCard category={item} subcategories={subsOf(item.id)} />
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      <CompareBar />
    </Screen>
  )
}
