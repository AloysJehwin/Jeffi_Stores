import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, View, type ListRenderItem } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { LayoutGrid, Rows3, Shapes } from 'lucide-react-native'
import { getListing, type ListingCard, type ListingFacets } from '../../src/api/products'
import { listBrands } from '../../src/api/brands'
import TopNav from '../../src/components/layout/TopNav'
import ProductCard from '../../src/components/product/ProductCard'
import RecentlyViewed from '../../src/components/home/RecentlyViewed'
import { ListingFeedItem, listingFeed, useListingLayout, type ListingFeedEntry } from '../../src/components/home/ListingFeed'
import { useColumnWidth } from '../../src/components/home/layout'
import CompareBar, { CompareStrip } from '../../src/components/catalog/CompareBar'
import FilterSheet, { FiltersButton } from '../../src/components/catalog/FilterSheet'
import ListingPromoBanner from '../../src/components/catalog/ListingPromoBanner'
import ProductTable from '../../src/components/catalog/ProductTable'
import { EmptyCard, InfiniteFooter, type InfiniteControl } from '../../src/components/catalog/Paged'
import { listingKey, readListingParams, toRouteParams, type ListingParams } from '../../src/components/catalog/listing'
import { useCompareStore } from '../../src/stores/compareStore'
import { Chip, IconButton, ProductGridSkeleton, Screen, Skeleton, Text, Title, useBottomInset } from '../../src/ui'
import { useTokens } from '../../src/theme'
import type { HomeSection } from '../../src/types/home'

// Mirror of controller-service app/(storefront)/products/page.tsx at the mobile breakpoint: heading,
// CompareStrip, ProductGrid's control bar (MobileFilterSheet · Group by Category · grid/table), the
// infinite grid with the promo banner after the sixth card, and Recently viewed. Data: GET
// /api/products/listing (the page's own model: filters, sort, paging and facets server-side). The
// sections an admin placed between the products come from GET /api/home?page=products.

type Item =
  | { type: 'pair'; key: string; rows: ListingCard[] }
  | { type: 'promo'; key: string }
  | { type: 'feed'; key: string; entry: ListingFeedEntry }
  | { type: 'group'; key: string; name: string; slug: string; count: number; gap: boolean }
  | { type: 'table'; key: string }

const EMPTY_FACETS: ListingFacets = {
  colors: [],
  grades: [],
  materials: [],
  finishes: [],
  compliances: [],
  origins: [],
  inStockCount: 0,
  onSaleCount: 0,
  priceMin: 0,
  priceMax: 0,
  variantTypes: [],
  variantValues: [],
  specFacets: [],
}

const RECENT: HomeSection = {
  id: 'listing-recently-viewed',
  type: 'recently_viewed',
  title: null,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: { limit: 6, minItems: 2 },
  display_order: 0,
  layout: 'grid',
  copy: { title: 'Recently viewed' },
  items: null,
}

const pairs = (rows: ListingCard[], prefix: string): Item[] =>
  Array.from({ length: Math.ceil(rows.length / 2) }, (_, i) => ({ type: 'pair' as const, key: `${prefix}${rows[i * 2].id}`, rows: rows.slice(i * 2, i * 2 + 2) }))

// Memoized so the screen re-rendering (paging state, the compare bar) doesn't re-render mounted cards.
const Pair = memo(function Pair({ rows, width }: { rows: ListingCard[]; width: number }) {
  return (
    <View className="mb-3 flex-row gap-3 px-4">
      {rows.map(r => (
        <View key={r.id} style={{ width }}>
          <ProductCard product={r} handlingDays={r.handlingDays} />
        </View>
      ))}
    </View>
  )
}, (a, b) => a.width === b.width && a.rows.length === b.rows.length && a.rows.every((r, i) => r === b.rows[i]))

const keyOf = (it: Item) => it.key

export default function ProductsScreen() {
  const router = useRouter()
  const t = useTokens()
  const raw = useLocalSearchParams()
  const key = listingKey(readListingParams(raw))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => readListingParams(raw), [key])
  const listRef = useRef<FlatList<Item>>(null)
  const cardW = useColumnWidth(2, 12)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const grouped = params.sort === 'category'
  const compareCount = useCompareStore(s => s.compareList.length)
  const bottomInset = useBottomInset(compareCount >= 2 ? 96 : 24)

  // Grouped by category the web shows one page and no pager.
  const query = useInfiniteQuery({
    queryKey: ['products', 'listing', key],
    queryFn: ({ pageParam }) => getListing(params, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (!grouped && pages.length * last.pageSize < last.total ? pages.length + 1 : undefined),
    staleTime: 60_000,
  })
  // Brand slugs (links pass ?brand=<slug>) so the sheet can show them selected.
  const brandSlugs = useQuery({ queryKey: ['brands'], queryFn: listBrands, staleTime: 5 * 60_000 })
  const layout = useListingLayout('products')

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [key])

  const first = query.data?.pages[0]
  const rows = useMemo(() => query.data?.pages.flatMap(p => p.products) ?? [], [query.data])
  const loading = query.isLoading
  const total = first?.total ?? 0
  const control: InfiniteControl = {
    total,
    hasMore: !!query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    error: query.isError ? (query.error as Error)?.message || 'Failed to load' : null,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    },
    retry: () => (rows.length ? query.fetchNextPage() : query.refetch()),
  }
  const failed = !!control.error && rows.length === 0
  const promo = first?.promoOffer ?? null
  const sheetBrands = useMemo(
    () => (first?.brands ?? []).map(b => ({ ...b, slug: brandSlugs.data?.find(x => x.id === b.id)?.slug })),
    [first?.brands, brandSlugs.data]
  )

  const items = useMemo<Item[]>(() => {
    if (loading || rows.length === 0) return []
    if (view === 'table') return [{ type: 'table', key: 'table' }]
    if (grouped) {
      const groups = new Map<string, { slug: string; rows: ListingCard[] }>()
      for (const r of rows) {
        const name = r.categoryName ?? 'Other'
        if (!groups.has(name)) groups.set(name, { slug: r.categorySlug ?? '', rows: [] })
        groups.get(name)!.rows.push(r)
      }
      return [...groups.entries()].flatMap(([name, g], gi) => [
        { type: 'group' as const, key: `g:${name}`, name, slug: g.slug, count: g.rows.length, gap: gi > 0 },
        ...pairs(g.rows, `g:${name}:`),
      ])
    }
    const feed = listingFeed(layout, rows.length, total, 2)
    const out: Item[] = []
    for (let i = 0, f = 0; i < rows.length; i += 2) {
      // ProductGrid PROMO_AFTER = 6 cards (3 rows of two), page 1 only.
      if (i === 6 && promo) out.push({ type: 'promo', key: 'promo' })
      for (; f < feed.length && feed[f].at <= i; f++) out.push({ type: 'feed', key: feed[f].key, entry: feed[f] })
      out.push({ type: 'pair', key: rows[i].id, rows: rows.slice(i, i + 2) })
    }
    return out
  }, [loading, rows, view, grouped, promo, layout, total])

  const apply = useCallback((next: ListingParams) => router.setParams(toRouteParams(next)), [router])
  const toggleGrouped = () => apply({ ...params, sort: grouped ? undefined : 'category', dir: undefined, order: undefined })

  // Stable, so a screen re-render doesn't re-render every mounted row.
  const renderItem = useCallback<ListRenderItem<Item>>(
    ({ item }) => {
      if (item.type === 'feed') return layout ? <ListingFeedItem entry={item.entry} data={layout.data} gap={12} /> : null
      if (item.type === 'promo') {
        return promo ? (
          <View className="mb-3 px-4">
            <ListingPromoBanner offer={promo} />
          </View>
        ) : null
      }
      if (item.type === 'table') {
        return (
          <View className="px-4">
            <ProductTable
              products={rows}
              sort={{ sort: params.sort, dir: params.dir ?? params.order }}
              onSort={next => apply({ ...params, sort: next.sort, dir: next.dir, order: undefined })}
            />
          </View>
        )
      }
      if (item.type === 'group') {
        return (
          <View className={`mb-4 flex-row items-center gap-3 px-4 ${item.gap ? 'mt-5' : ''}`}>
            <Pressable accessibilityRole="link" onPress={() => (item.slug ? router.push(`/category/${item.slug}`) : apply({}))} hitSlop={8}>
              <Text className="font-display text-base font-extrabold text-foreground">{item.name}</Text>
            </Pressable>
            <View className="h-px flex-1 bg-border-default" />
            <Text className="text-xs text-foreground-muted">{item.count} products</Text>
          </View>
        )
      }
      return <Pair rows={item.rows} width={cardW} />
    },
    [promo, rows, router, apply, cardW, layout, params]
  )

  const header = (
    <View className="px-4 pt-6">
      <Title className="mb-4">All Products</Title>
      <CompareStrip />
      {!loading && rows.length > 0 ? (
        <View className="mb-6 flex-row flex-wrap items-center gap-2">
          <FiltersButton params={params} onPress={() => setSheetOpen(true)} />
          <Chip label="Group by Category" icon={Shapes} selected={grouped} onPress={toggleGrouped} />
          <View className="flex-row rounded-full bg-surface-secondary p-0.5">
            <IconButton
              icon={LayoutGrid}
              label="Grid view"
              size="sm"
              variant={view === 'grid' ? 'solid' : 'plain'}
              color={view === 'grid' ? undefined : t.foregroundMuted}
              accessibilityState={{ selected: view === 'grid' }}
              onPress={() => setView('grid')}
            />
            <IconButton
              icon={Rows3}
              label="Table view"
              size="sm"
              variant={view === 'table' ? 'solid' : 'plain'}
              color={view === 'table' ? undefined : t.foregroundMuted}
              accessibilityState={{ selected: view === 'table' }}
              onPress={() => setView('table')}
            />
          </View>
        </View>
      ) : null}
    </View>
  )

  const empty = loading ? (
    <View className="px-4">
      <View className="mb-6 flex-row gap-2">
        <Skeleton width={104} height={38} rounded="rounded-full" />
        <Skeleton width={186} height={38} rounded="rounded-full" />
        <Skeleton width={76} height={40} rounded="rounded-full" />
      </View>
      <ProductGridSkeleton />
    </View>
  ) : failed ? (
    <View className="px-4">
      <InfiniteFooter shown={0} control={control} />
    </View>
  ) : (
    <View className="px-4">
      <EmptyCard
        title="No Products Found"
        body="We couldn't find any products matching your filters. Try adjusting your search criteria."
        cta="View All Products"
        onPress={() => apply({})}
      />
    </View>
  )

  const footer = (
    <View>
      {!loading && rows.length > 0 && !grouped ? (
        <View className="px-4">
          <InfiniteFooter shown={rows.length} control={control} />
        </View>
      ) : null}
      <RecentlyViewed section={RECENT} data={undefined as never} />
      <View style={{ height: bottomInset }} />
    </View>
  )

  return (
    <Screen header={<TopNav />} mode="none">
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (!grouped && control.hasMore && !control.loadingMore && !control.error) control.loadMore()
        }}
        onEndReachedThreshold={0.6}
        // Rows of two cards: small batches keep each mount commit short while scrolling.
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        windowSize={9}
        showsVerticalScrollIndicator={false}
      />
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        params={params}
        categories={first?.categories ?? []}
        brands={sheetBrands}
        facets={first?.facets ?? EMPTY_FACETS}
        offers={first?.offers ?? []}
        onApply={apply}
        sortable={view === 'grid'}
      />
      <CompareBar />
    </Screen>
  )
}
