import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { listCategories, withDetails, type CategoryDetail } from '../../src/api/categories'
import { getHome } from '../../src/api/home'
import CategoryIcon from '../../src/components/catalog/CategoryIcon'
import CompareBar from '../../src/components/catalog/CompareBar'
import { ChevronRight } from 'lucide-react-native'
import { InfiniteFooter } from '../../src/components/catalog/Paged'
import { accent, useTokens } from '../../src/theme'
import { Badge, Card, Screen, ScreenHeader, Skeleton, Text, useBottomInset } from '../../src/ui'

// Mirror of controller-service app/(storefront)/categories/page.tsx at the mobile breakpoint.

function CategoryCard({ category, subcategories }: { category: CategoryDetail; subcategories: CategoryDetail[] }) {
  const router = useRouter()
  const t = useTokens()
  // The web page's total: own products plus the direct subcategories'.
  const n = (category.product_count ?? 0) + subcategories.reduce((sum, sub) => sum + (sub.product_count ?? 0), 0)

  return (
    <Card onPress={() => router.push(`/category/${category.slug}`)} accessibilityLabel={`${category.name}, ${n} ${n === 1 ? 'product' : 'products'}`}>
      <View className="mb-4 flex-row items-center gap-4">
        <View className="h-16 w-16 items-center justify-center rounded-xl bg-accent-100 dark:bg-accent-900/30">
          <CategoryIcon iconName={category.icon_name} categoryName={category.name} color={accent[600]} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-display text-xl font-extrabold text-foreground">{category.name}</Text>
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
              <Badge key={sub.id} label={sub.name} />
            ))}
            {subcategories.length > 5 ? (
              <Text className="text-xs font-medium text-accent-600 dark:text-accent-400">+{subcategories.length - 5} more</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View className="mt-4 flex-row items-center gap-1">
        <Text className="text-sm font-semibold text-accent-600 dark:text-accent-400">Browse Products</Text>
        <ChevronRight size={16} color={t.accent600} />
      </View>
    </Card>
  )
}

function CategoryCardSkeleton() {
  return (
    <View className="rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
      <View className="mb-4 flex-row items-center gap-4">
        <Skeleton width={64} height={64} rounded="rounded-xl" />
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
            <Skeleton key={i} width={w} height={24} rounded="rounded-full" />
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
