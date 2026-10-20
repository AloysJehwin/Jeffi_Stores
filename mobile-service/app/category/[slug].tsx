import { View, Text, FlatList, TouchableOpacity } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listProducts } from '../../src/api/products'
import { listCategories } from '../../src/api/categories'
import TopNav from '../../src/components/layout/TopNav'
import ProductCard from '../../src/components/product/ProductCard'
import Spinner from '../../src/components/ui/Spinner'

const PAGE_SIZE = 21

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  })
  const category = categoriesData?.find((c) => c.slug === slug)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['products', 'category', slug],
    queryFn: ({ pageParam = 1 }) => listProducts({ category: slug, page: pageParam as number }),
    getNextPageParam: (lastPage, pages) => {
      if (pages.length * PAGE_SIZE < lastPage.total) return pages.length + 1
      return undefined
    },
    initialPageParam: 1,
  })

  const products = data?.pages.flatMap((p) => p.products) || []
  const total = data?.pages[0]?.total ?? 0

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />

      {/* Category header */}
      <View className="bg-white dark:bg-[#24252f] border-b border-gray-100 dark:border-[#3f4150] px-4 py-3">
        <TouchableOpacity
          onPress={() => router.back()}
          className="flex-row items-center gap-1 mb-2"
        >
          <Ionicons name="arrow-back" size={16} color="#9CA3AF" />
          <Text className="text-sm text-gray-400">Categories</Text>
        </TouchableOpacity>
        <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100" style={{ fontStyle: 'italic' }}>
          {category?.name || slug}
        </Text>
        {total > 0 && (
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total} product{total !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {isLoading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="cube-outline" size={64} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">No products found</Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1 text-center">
            No products in this category yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
          renderItem={({ item }) => (
            <View style={{ width: '47.5%' }}>
              <ProductCard product={item} />
            </View>
          )}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}
