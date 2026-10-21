import type { ReactElement } from 'react'
import { FlatList, View } from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { InfiniteFooter, ProductGridSkeleton } from './Paged'
import { listProducts, type ProductQuery } from '../../api/products'
import ProductCard from '../product/ProductCard'
import { useColumnWidth } from '../home/layout'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { toCard } from '../../lib/card'

// A ServerPagedItems product grid (category and brand pages): newest first, pages appended on scroll.

export default function PagedProductGrid({
  base,
  pageSize,
  cols,
  gap,
  enabled = true,
  header,
  empty,
  bottomInset = 0,
}: {
  base: Pick<ProductQuery, 'category' | 'brand'>
  pageSize: number
  cols: 1 | 2
  gap: number
  enabled?: boolean
  header: (total: number | null) => ReactElement
  empty: ReactElement
  bottomInset?: number
}) {
  const { gstEnabled } = useStoreConfig().flags
  const w = useColumnWidth(cols, gap)
  const q = useInfiniteQuery({
    queryKey: ['products', 'paged', base, pageSize],
    queryFn: ({ pageParam }) => listProducts({ ...base, sort: 'created_at', order: 'desc', page: pageParam, limit: pageSize }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length * pageSize < last.total ? pages.length + 1 : undefined),
    enabled,
  })

  const rows = q.data?.pages.flatMap(p => p.products) ?? []
  const total = q.data?.pages[0]?.total ?? null
  const loading = q.isLoading || !enabled
  const control = {
    total,
    hasMore: !!q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    error: q.isError ? (q.error as Error)?.message || 'Failed to load' : null,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
    },
    retry: () => (rows.length ? q.fetchNextPage() : q.refetch()),
  }

  return (
    <FlatList
      key={cols}
      data={loading || total === 0 ? [] : rows}
      keyExtractor={item => item.id}
      numColumns={cols}
      columnWrapperStyle={cols > 1 ? { gap, paddingHorizontal: 16, marginBottom: gap } : undefined}
      renderItem={({ item }) => (
        <View style={cols > 1 ? { width: w } : { paddingHorizontal: 16, marginBottom: gap }}>
          <ProductCard product={toCard(item, gstEnabled)} handlingDays={Number(item.handling_days ?? 2)} />
        </View>
      )}
      ListHeaderComponent={header(total)}
      ListEmptyComponent={
        loading ? (
          <View className="px-4">
            <ProductGridSkeleton cols={cols} />
          </View>
        ) : total === 0 ? (
          <View className="px-4">{empty}</View>
        ) : q.isError ? (
          <View className="px-4">
            <InfiniteFooter shown={0} control={control} />
          </View>
        ) : null
      }
      ListFooterComponent={
        <View className="px-4" style={{ paddingBottom: 32 + bottomInset }}>
          {!loading && rows.length > 0 ? <InfiniteFooter shown={rows.length} control={control} /> : null}
        </View>
      }
      onEndReached={control.loadMore}
      onEndReachedThreshold={0.6}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={11}
      showsVerticalScrollIndicator={false}
    />
  )
}
