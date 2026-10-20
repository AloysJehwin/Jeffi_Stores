import { FlatList, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listCategories, withDetails, type CategoryDetail } from '../../src/api/categories'
import { countProducts } from '../../src/api/products'
import { getHome } from '../../src/api/home'
import TopNav from '../../src/components/layout/TopNav'
import CategoryIcon from '../../src/components/catalog/CategoryIcon'
import CompareBar from '../../src/components/catalog/CompareBar'
import { ChevronRightIcon } from '../../src/components/catalog/icons'
import { Pulse } from '../../src/components/catalog/Paged'
import { accent } from '../../src/theme'

// Mirror of controller-service app/(storefront)/categories/page.tsx at the mobile breakpoint.

function CategoryCard({ category, subcategories }: { category: CategoryDetail; subcategories: CategoryDetail[] }) {
  const router = useRouter()
  // Own products plus the subcategories' (the API counts the whole subtree).
  const { data: total } = useQuery({
    queryKey: ['category-count', category.slug],
    queryFn: () => countProducts({ category: category.slug }),
    staleTime: 5 * 60_000,
  })
  const n = total ?? 0

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
              {total == null ? ' ' : `${n} ${n === 1 ? 'product' : 'products'}`}
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

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets()
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 5 * 60_000 })
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: getHome, staleTime: 120_000 })
  const categories = withDetails(data ?? [], home?.data.mainCategories as Record<string, any>[] | undefined)
  const main = categories.filter(c => !c.parent_category_id)
  const subsOf = (id: string) => categories.filter(c => c.parent_category_id === id)

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <FlatList
        data={main}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        ItemSeparatorComponent={() => <View className="h-4" />}
        ListHeaderComponent={
          <>
            <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
              <Text className="mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground">All Categories</Text>
              <Text className="text-foreground-secondary">Browse our complete range of product categories</Text>
            </View>
            <View className="h-4" />
            {isLoading ? (
              <View className="gap-4 px-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Pulse key={i} delay={i * 60}>
                    <View className="h-40 rounded-lg border border-border-default bg-surface-elevated" />
                  </Pulse>
                ))}
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
    </View>
  )
}
