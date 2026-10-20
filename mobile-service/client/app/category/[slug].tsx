import { Pressable, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listCategories, withDetails, type CategoryDetail } from '../../src/api/categories'
import { getHome } from '../../src/api/home'
import TopNav from '../../src/components/layout/TopNav'
import CategoryIcon from '../../src/components/catalog/CategoryIcon'
import CompareBar from '../../src/components/catalog/CompareBar'
import PagedProductGrid from '../../src/components/catalog/PagedProductGrid'
import { Breadcrumb, EmptyCard, InfiniteFooter } from '../../src/components/catalog/Paged'
import { Grid } from '../../src/components/home/layout'
import Spinner from '../../src/components/ui/Spinner'
import { accent } from '../../src/theme'

// Mirror of controller-service app/(storefront)/categories/[slug]/page.tsx at the mobile breakpoint.

const PAGE_SIZE = 24

function SubcategoryTile({ category }: { category: CategoryDetail }) {
  const router = useRouter()
  return (
    <Pressable onPress={() => router.push(`/category/${category.slug}`)} className="flex-1">
      <View className="flex-1 items-center gap-1.5 rounded-xl border border-border-default bg-surface-elevated p-2 shadow-sm">
        <View className="h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-100">
          <CategoryIcon iconName={category.icon_name} categoryName={category.name} size={20} color={accent[600]} />
        </View>
        <View className="min-h-[32px] items-center justify-center">
          <Text numberOfLines={2} className="text-center text-[11px] font-semibold text-foreground" style={{ lineHeight: 13.75 }}>
            {category.name}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { data: all, isLoading, error, refetch } = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 5 * 60_000 })
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: getHome, staleTime: 120_000 })
  const categories = withDetails(all ?? [], home?.data.mainCategories as Record<string, any>[] | undefined)
  const category = categories.find(c => c.slug === slug)
  const subcategories = category
    ? categories.filter(c => c.parent_category_id === category.id).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    : []

  if (isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <Spinner />
      </View>
    )
  }

  if (error && !all) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="p-4">
          <InfiniteFooter
            shown={0}
            control={{ hasMore: false, loadingMore: false, error: error.message || 'Failed to load', loadMore: refetch, retry: refetch }}
          />
        </View>
      </View>
    )
  }

  if (!category) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="p-4">
          <EmptyCard title="Category not found" body="This category doesn't exist or is no longer available." />
        </View>
      </View>
    )
  }

  const header = (total: number | null) => (
    <>
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <View className="mb-4">
          <Breadcrumb
            items={[
              { label: 'Home', onPress: () => router.navigate('/(tabs)') },
              { label: 'Categories', onPress: () => router.push('/categories') },
              { label: category.name },
            ]}
          />
        </View>
        <Text className="mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground">{category.name}</Text>
        {category.description ? <Text className="text-foreground-secondary">{category.description}</Text> : null}
      </View>

      <View className="px-4 pt-4">
        {subcategories.length > 0 ? (
          <View className="mb-8">
            <Text className="mb-4 text-xl font-bold text-foreground">Subcategories</Text>
            <Grid cols={4} gap={8}>
              {subcategories.map(sub => (
                <SubcategoryTile key={sub.id} category={sub} />
              ))}
            </Grid>
          </View>
        ) : null}
        <View className="mb-6 flex-row items-center justify-between">
          <Text className="text-xl font-bold text-foreground">Products ({total ?? 0})</Text>
        </View>
      </View>
    </>
  )

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <PagedProductGrid
        base={{ category: category.slug }}
        pageSize={PAGE_SIZE}
        cols={2}
        gap={12}
        header={header}
        bottomInset={insets.bottom}
        empty={
          <EmptyCard title="No Products Yet" body="We're working on adding products to this category. Check back soon!" />
        }
      />
      <CompareBar />
    </View>
  )
}
