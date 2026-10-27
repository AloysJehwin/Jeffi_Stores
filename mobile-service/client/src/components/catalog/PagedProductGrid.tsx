import { memo, useCallback, useMemo, useRef, type ReactElement } from 'react'
import { FlatList, View, type ListRenderItem } from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { InfiniteFooter } from './Paged'
import { ProductGridSkeleton } from '../../ui'
import { listProducts, type ProductQuery } from '../../api/products'
import ProductCard from '../product/ProductCard'
import { useColumnWidth } from '../home/layout'
import { ListingFeedItem, listingFeed, useListingLayout, type ListingFeedEntry } from '../home/ListingFeed'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { toCard } from '../../lib/card'
import { PRODUCT_SORTS, type ProductSortId } from './listing'
import type { CardProduct } from '../../types/home'

interface Row {
  card: CardProduct
  handlingDays: number
}

// A ServerPagedItems product grid (category and brand pages): in the chosen PRODUCT_SORTS order, pages appended on scroll.
// Rows are packed here rather than with numColumns, so the sections placed between the products
// (GET /api/home?page=category|brand) can span the full width.

type Item = { type: 'row'; key: string; rows: Row[] } | { type: 'feed'; key: string; entry: ListingFeedEntry }

const keyOf = (it: Item) => it.key

// Memoized so a page load doesn't re-render the mounted rows.
const ProductRow = memo(
  function ProductRow({ rows, cols, width, gap }: { rows: Row[]; cols: 1 | 2; width: number; gap: number }) {
    if (cols === 1) {
      return (
        <View style={{ paddingHorizontal: 16, marginBottom: gap }}>
          <ProductCard product={rows[0].card} handlingDays={rows[0].handlingDays} />
        </View>
      )
    }
    return (
      <View style={{ flexDirection: 'row', gap, paddingHorizontal: 16, marginBottom: gap }}>
        {rows.map(r => (
          <View key={r.card.id} style={{ width }}>
            <ProductCard product={r.card} handlingDays={r.handlingDays} />
          </View>
        ))}
      </View>
    )
  },
  (a, b) => a.cols === b.cols && a.width === b.width && a.gap === b.gap && a.rows.length === b.rows.length && a.rows.every((r, i) => r === b.rows[i])
)

export default function PagedProductGrid({
  page,
  base,
  sort = 'featured',
  pageSize,
  cols,
  gap,
  enabled = true,
  header,
  empty,
  bottomInset = 0,
}: {
  /** Whose placed sections go between the products. */
  page: 'category' | 'brand'
  base: Pick<ProductQuery, 'category' | 'brand'>
  sort?: ProductSortId
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
  const layout = useListingLayout(page)
  const opt = PRODUCT_SORTS.find(o => o.id === sort)
  const q = useInfiniteQuery({
    queryKey: ['products', 'paged', base, sort, pageSize],
    queryFn: ({ pageParam }) => listProducts({ ...base, sort: opt?.sort, dir: opt?.dir, page: pageParam, limit: pageSize }),
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

  const items = useMemo<Item[]>(() => {
    const feed = listingFeed(layout, rows.length, total ?? undefined, cols)
    const out: Item[] = []
    for (let i = 0, f = 0; i < rows.length; i += cols) {
      for (; f < feed.length && feed[f].at <= i; f++) out.push({ type: 'feed', key: feed[f].key, entry: feed[f] })
      out.push({ type: 'row', key: rows[i].card.id, rows: rows.slice(i, i + cols) })
    }
    return out
  }, [rows, total, cols, layout])

  const renderItem = useCallback<ListRenderItem<Item>>(
    ({ item }) =>
      item.type === 'feed' ? (
        layout ? <ListingFeedItem entry={item.entry} data={layout.data} gap={gap} /> : null
      ) : (
        <ProductRow rows={item.rows} cols={cols} width={w} gap={gap} />
      ),
    [cols, w, gap, layout]
  )
  const listHeader = useMemo(() => header(total), [header, total])

  return (
    <FlatList
      data={loading || total === 0 ? [] : items}
      keyExtractor={keyOf}
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
