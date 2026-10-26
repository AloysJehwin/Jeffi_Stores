import { useCallback, useMemo, useRef, type ReactElement } from 'react'
import { FlatList, View, type ListRenderItem } from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { InfiniteFooter } from './Paged'
import { ProductGridSkeleton } from '../../ui'
import { listProducts, type ProductQuery } from '../../api/products'
import ProductCard from '../product/ProductCard'
import { useColumnWidth } from '../home/layout'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { toCard } from '../../lib/card'
import type { CardProduct } from '../../types/home'

interface Row {
  card: CardProduct
  handlingDays: number
}

// A ServerPagedItems product grid (category and brand pages): newest first, pages appended on scroll.

const keyOf = (row: Row) => row.card.id

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

  // Each product's card is built once and kept across page loads: a fresh object would re-render every
  // mounted card whenever the list re-renders.
  const built = useRef({ gst: gstEnabled, cards: new WeakMap<object, Row>() })
  const rows = useMemo<Row[]>(() => {
    if (built.current.gst !== gstEnabled) built.current = { gst: gstEnabled, cards: new WeakMap() }
    const { cards } = built.current
    return (q.data?.pages.flatMap(p => p.products) ?? []).map(item => {
      let row = cards.get(item)
      if (!row) cards.set(item, (row = { card: toCard(item, gstEnabled), handlingDays: Number(item.handling_days ?? 2) }))
      return row
    })
  }, [q.data, gstEnabled])
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

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => (
      <View style={cols > 1 ? { width: w } : { paddingHorizontal: 16, marginBottom: gap }}>
        <ProductCard product={item.card} handlingDays={item.handlingDays} />
      </View>
    ),
    [cols, w, gap]
  )
  const listHeader = useMemo(() => header(total), [header, total])

  return (
    <FlatList
      key={cols}
      data={loading || total === 0 ? [] : rows}
      keyExtractor={keyOf}
      numColumns={cols}
      columnWrapperStyle={cols > 1 ? { gap, paddingHorizontal: 16, marginBottom: gap } : undefined}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        loading ? (
          <View className="px-4">
            <ProductGridSkeleton cols={cols} gap={gap} count={cols === 1 ? 3 : 6} />
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
      // Counted in rows: small batches keep each mount commit short while scrolling.
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      windowSize={9}
      showsVerticalScrollIndicator={false}
    />
  )
}
