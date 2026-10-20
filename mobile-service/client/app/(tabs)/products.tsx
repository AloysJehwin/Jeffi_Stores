import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useColorScheme } from 'nativewind'
import { getListing, type ListingCard, type ListingFacets } from '../../src/api/products'
import { listBrands } from '../../src/api/brands'
import TopNav from '../../src/components/layout/TopNav'
import ProductCard from '../../src/components/product/ProductCard'
import RecentlyViewed from '../../src/components/home/RecentlyViewed'
import { useColumnWidth } from '../../src/components/home/layout'
import CompareBar, { CompareStrip } from '../../src/components/catalog/CompareBar'
import FilterSheet, { FiltersButton } from '../../src/components/catalog/FilterSheet'
import ListingPromoBanner from '../../src/components/catalog/ListingPromoBanner'
import ProductTable from '../../src/components/catalog/ProductTable'
import { EmptyCard, InfiniteFooter, ProductGridSkeleton, type InfiniteControl } from '../../src/components/catalog/Paged'
import { SquaresIcon, TableIcon } from '../../src/components/catalog/icons'
import { listingKey, readListingParams, toRouteParams, type ListingParams } from '../../src/components/catalog/listing'
import { useCompareStore } from '../../src/stores/compareStore'
import { accent, useTokens } from '../../src/theme'
import type { HomeSection } from '../../src/types/home'

// Mirror of controller-service app/(storefront)/products/page.tsx at the mobile breakpoint: heading,
// CompareStrip, ProductGrid's control bar (MobileFilterSheet · Group by Category · grid/table), the
// infinite grid with the promo banner after the sixth card, and Recently viewed. Data: GET
// /api/products/listing (the page's own model: filters, sort, paging and facets server-side).

type Item =
  | { type: 'pair'; key: string; rows: ListingCard[] }
  | { type: 'promo'; key: string }
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

export default function ProductsScreen() {
  const router = useRouter()
  const t = useTokens()
  const dark = useColorScheme().colorScheme === 'dark'
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
    const out = pairs(rows, '')
    // ProductGrid PROMO_AFTER = 6 cards (3 rows of two), page 1 only.
    if (promo && rows.length > 6) out.splice(3, 0, { type: 'promo', key: 'promo' })
    return out
  }, [loading, rows, view, grouped, promo])

  const apply = (next: ListingParams) => router.setParams(toRouteParams(next))
  const toggleGrouped = () => apply({ ...params, sort: grouped ? undefined : 'category', order: undefined })

  const header = (
    <View className="px-4 pt-6">
      <Text className="mb-4 text-2xl font-bold text-secondary-500 dark:text-foreground">All Products</Text>
      <CompareStrip />
      {!loading && rows.length > 0 ? (
        <View className="mb-6 flex-row flex-wrap items-center gap-2">
          <FiltersButton params={params} onPress={() => setSheetOpen(true)} />
          <Pressable
            onPress={toggleGrouped}
            className={`h-9 flex-row items-center gap-1.5 rounded-lg border px-3 ${grouped ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'}`}
          >
            <SquaresIcon size={14} color={grouped ? (dark ? accent[400] : accent[700]) : t.foregroundSecondary} />
            <Text className={`text-xs font-medium ${grouped ? 'text-accent-700 dark:text-accent-400' : 'text-foreground-secondary'}`}>Group by Category</Text>
          </Pressable>
          <View className="h-9 flex-row overflow-hidden rounded-lg border border-border-default">
            <Pressable
              onPress={() => setView('grid')}
              accessibilityLabel="Grid view"
              className={`h-full justify-center px-2.5 ${view === 'grid' ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
            >
              <SquaresIcon filled size={16} color={view === 'grid' ? accent[500] : t.foregroundMuted} />
            </Pressable>
            <Pressable
              onPress={() => setView('table')}
              accessibilityLabel="Table view"
              className={`h-full justify-center border-l border-border-default px-2.5 ${view === 'table' ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
            >
              <TableIcon color={view === 'table' ? accent[500] : t.foregroundMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )

  const empty = loading ? (
    <View className="px-4">
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
      <View style={{ height: compareCount >= 2 ? 96 : 24 }} />
    </View>
  )

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={it => it.key}
        renderItem={({ item }) => {
          if (item.type === 'promo') {
            return (
              <View className="mb-3 px-4">
                <ListingPromoBanner offer={promo!} />
              </View>
            )
          }
          if (item.type === 'table') {
            return (
              <View className="px-4">
                <ProductTable products={rows} />
              </View>
            )
          }
          if (item.type === 'group') {
            return (
              <View className={`mb-4 flex-row items-center gap-3 px-4 ${item.gap ? 'mt-5' : ''}`}>
                <Pressable onPress={() => (item.slug ? router.push(`/category/${item.slug}`) : apply({}))}>
                  <Text className="text-sm font-bold text-foreground">{item.name}</Text>
                </Pressable>
                <View className="h-px flex-1 bg-border-default" />
                <Text className="text-xs text-foreground-muted">{item.count} products</Text>
              </View>
            )
          }
          return (
            <View className="mb-3 flex-row gap-3 px-4">
              {item.rows.map(r => (
                <View key={r.id} style={{ width: cardW }}>
                  <ProductCard product={r} handlingDays={r.handlingDays} />
                </View>
              ))}
            </View>
          )
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (!grouped && control.hasMore && !control.loadingMore && !control.error) control.loadMore()
        }}
        onEndReachedThreshold={0.6}
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
      />
      <CompareBar inTabs />
    </View>
  )
}
