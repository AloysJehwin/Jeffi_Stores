import { useEffect, useMemo, useRef } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { keepPreviousData, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getListing, getProductBySlug, listProducts, type ProductRow } from '../src/api/products'
import CompareBar from '../src/components/catalog/CompareBar'
import { CompareAddButton, CompareChangeButton } from '../src/components/catalog/CompareSearch'
import { PhotoIcon } from '../src/components/catalog/icons'
import { useStoreConfig } from '../src/hooks/useStoreConfig'
import { absUrl } from '../src/lib/links'
import { inr } from '../src/lib/format'
import { useCompareStore } from '../src/stores/compareStore'
import { useTokens } from '../src/theme'
import { Screen, ScreenHeader, Skeleton, Text } from '../src/ui'

// Mirror of controller-service app/(storefront)/compare/page.tsx at the mobile breakpoint (the table
// scrolls sideways inside its card, min-w-[640px]).

type Entry = { id: string; slug: string }

const round2 = (n: number) => Math.round(n * 100) / 100

const SPEC_ROWS: { label: string; key: (p: any) => string | null }[] = [
  { label: 'Brand', key: p => p.brands?.name ?? null },
  { label: 'Category', key: p => p.categories?.name ?? null },
  { label: 'Material', key: p => p.material ?? null },
  { label: 'Finish', key: p => p.finish ?? null },
  { label: 'Variant Type', key: p => p.variant_type ?? null },
  { label: 'Sub-Variant', key: p => p.sub_variant_type ?? null },
  { label: 'Condition', key: p => p.condition ?? null },
  { label: 'Color', key: p => p.color ?? null },
  { label: 'Weight', key: p => (p.weight != null ? `${p.weight} ${p.weight_unit ?? 'kg'}` : null) },
  { label: 'Net Weight', key: p => (p.net_weight_grams != null ? `${p.net_weight_grams} g` : null) },
  { label: 'Volume', key: p => (p.volume_ml != null ? `${p.volume_ml} ml` : null) },
  {
    label: 'Package Dims',
    key: p => {
      const parts = [p.length_cm, p.breadth_cm, p.height_cm].filter((v: any) => v != null)
      if (!parts.length) return null
      return parts.join(' × ') + ` ${p.length_unit ?? 'cm'}`
    },
  },
  { label: 'Package Type', key: p => p.package_type ?? null },
  { label: 'Origin', key: p => p.country_of_origin ?? null },
  {
    label: 'Warranty',
    key: p =>
      p.warranty_months != null
        ? `${p.warranty_months} month${p.warranty_months !== 1 ? 's' : ''}${p.warranty_type ? ` (${p.warranty_type})` : ''}`
        : null,
  },
  { label: 'Compliance', key: p => p.compliance_standard ?? null },
  { label: 'Safety Rating', key: p => p.safety_rating ?? null },
  { label: 'Certifications', key: p => (p.certifications as string[] | null)?.join(', ') || null },
  {
    label: 'Hazards',
    key: p => [p.fragile && 'Fragile', p.hazardous && 'Hazardous', p.flammable && 'Flammable'].filter(Boolean).join(', ') || null,
  },
  { label: 'HSN Code', key: p => p.hsn_code ?? null },
  { label: 'GST', key: p => (p.gst_percentage != null ? `${parseFloat(String(p.gst_percentage))}%` : null) },
  { label: 'MPN', key: p => p.mpn ?? null },
  { label: 'GTIN / EAN', key: p => p.gtin ?? null },
  { label: 'SKU', key: p => p.sku ?? null },
  { label: 'Barcode', key: p => p.barcode ?? null },
  { label: 'ISBN', key: p => p.isbn ?? null },
  { label: 'ASIN', key: p => p.asin ?? null },
]

/** getDefaultCompareIds: the seed and up to 3 newest from its category, else the 4 newest products. */
async function defaultEntries(seed: string | undefined, known: Entry[]): Promise<Entry[]> {
  if (seed) {
    try {
      const seedSlug = known.find(e => e.id === seed)?.slug ?? seed
      const p = (await getProductBySlug(seedSlug)) as ProductRow
      if (p.category_id && p.categories?.slug) {
        const res = await listProducts({ category: p.categories.slug, sort: 'created_at', order: 'desc', limit: 20 })
        const related = res.products.filter(r => r.category_id === p.category_id && r.id !== p.id).slice(0, 3)
        const out = [{ id: p.id, slug: p.slug }, ...related.map(r => ({ id: r.id, slug: r.slug }))]
        if (out.length >= 2) return out.slice(0, 4)
      }
    } catch {}
  }
  const recent = await listProducts({ sort: 'created_at', order: 'desc', limit: 4 })
  return recent.products.map(r => ({ id: r.id, slug: r.slug }))
}

/** Product rows anywhere in the query cache (PDP related products, listings) that carry one of the ids. */
function scanCache(qc: QueryClient, want: Set<string>, found: Map<string, string>) {
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v) || found.size >= want.size) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    const o = v as Record<string, unknown>
    if (typeof o.id === 'string' && typeof o.slug === 'string' && want.has(o.id) && !found.has(o.id)) found.set(o.id, o.slug)
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1)
  }
  for (const q of qc.getQueryCache().getAll()) walk(q.state.data, 0)
}

/**
 * The web compare page loads its ?ids straight from the DB; /api has no by-id product read, so ids
 * resolve to slugs from what the app already knows, then the query cache, then the listing's card pages.
 */
async function resolveIds(ids: string[], known: Map<string, string>, qc: QueryClient): Promise<Entry[]> {
  const want = new Set(ids)
  const found = new Map<string, string>()
  for (const id of ids) if (known.has(id)) found.set(id, known.get(id)!)
  if (found.size < want.size) scanCache(qc, want, found)
  // Last resort (an id nothing on the device has shown): walk the listing's slim card pages, stopping once all are found.
  for (let page = 1; found.size < want.size; page++) {
    const res = await getListing({}, page, true)
    for (const p of res.products) if (want.has(p.id) && !found.has(p.id)) found.set(p.id, p.slug)
    if (page * res.pageSize >= res.total) break
  }
  for (const [id, slug] of found) known.set(id, slug)
  return ids.filter(id => found.has(id)).map(id => ({ id, slug: found.get(id)! }))
}

function ProductHead({ p, gstEnabled, ids, onChange }: { p: ProductRow; gstEnabled: boolean; ids: string[]; onChange: (e: Entry) => void }) {
  const router = useRouter()
  const t = useTokens()
  const img = p.product_images?.find((x: any) => x.is_primary) || p.product_images?.[0]
  const src = absUrl(img?.thumbnail_url || img?.image_url)
  const incl = Number(p.base_price ?? 0)
  const ex = p.price_ex_gst != null ? Number(p.price_ex_gst) : null
  const unit = gstEnabled ? incl : ex != null && ex > 0 ? ex : incl
  const price = p.has_variants && p.variant_min_price ? Number(p.variant_min_price) : unit
  const rawMrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
  const gstRate = Number(p.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  const inStock = p.has_variants ? Number(p.variant_stock_total ?? 0) > 0 : p.stock_status !== 'Out of Stock'

  return (
    <View className="gap-2">
      <View className="w-full items-center">
        <View className="aspect-square w-full overflow-hidden rounded-lg border border-border-default bg-surface-secondary" style={{ maxWidth: 120 }}>
          {src ? (
            <Image source={{ uri: src }} contentFit="contain" style={{ flex: 1, margin: 8 }} accessibilityLabel={p.name} />
          ) : (
            <View className="flex-1 items-center justify-center">
              <PhotoIcon size={40} strokeWidth={1} color={t.foregroundMuted} />
            </View>
          )}
        </View>
      </View>
      <Pressable onPress={() => router.push(`/product/${p.slug}`)}>
        <Text numberOfLines={2} className="text-sm font-semibold text-foreground" style={{ lineHeight: 18 }}>
          {p.name}
        </Text>
      </Pressable>
      <Text>
        <Text className="text-base font-bold text-primary-600 dark:text-primary-400">
          {p.has_variants ? 'From ' : ''}₹{inr(price)}
        </Text>
        {mrp && mrp > price ? <Text className="text-xs text-foreground-muted line-through">{`  ₹${inr(mrp)}`}</Text> : null}
      </Text>
      <View
        className={`flex-row items-center gap-1 self-start rounded-full px-2 py-0.5 ${inStock ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
      >
        <View className={`h-1.5 w-1.5 rounded-full ${inStock ? 'bg-green-500' : 'bg-red-500'}`} />
        <Text className={`text-xs font-medium ${inStock ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
          {inStock ? 'In Stock' : 'Out of Stock'}
        </Text>
      </View>
      <CompareChangeButton productId={p.id} currentIds={ids} categoryId={p.category_id ?? null} onChange={r => onChange({ id: r.id, slug: r.slug })} />
    </View>
  )
}

/** The comparison table while it loads: a product head per column, then striped spec rows. Clipped, not scrolled. */
function CompareTableSkeleton({ cols, tableW, labelW }: { cols: number; tableW: number; labelW: number }) {
  const colW = (tableW - labelW) / cols
  const cells = Array.from({ length: cols })
  return (
    <View className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated shadow-sm">
      <View style={{ width: tableW }}>
        <View className="flex-row border-b border-border-default">
          <View className="bg-surface-secondary p-4" style={{ width: labelW }} />
          {cells.map((_, i) => (
            <View key={i} className="gap-2 p-4" style={{ width: colW }}>
              <View className="items-center">
                <Skeleton width={Math.min(120, colW - 32)} aspectRatio={1} />
              </View>
              <Skeleton height={13} />
              <Skeleton height={13} width="65%" />
              <Skeleton height={16} width="45%" />
              <Skeleton height={20} width={76} rounded="rounded-full" />
              <Skeleton height={12} width={56} rounded="rounded" />
            </View>
          ))}
        </View>
        {Array.from({ length: 6 }).map((_, r) => (
          <View key={r} className={`flex-row ${r < 5 ? 'border-b border-border-default' : ''} ${r % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}>
            <View className="bg-surface-secondary p-4" style={{ width: labelW }}>
              <Skeleton height={10} width="65%" rounded="rounded" />
            </View>
            {cells.map((_, i) => (
              <View key={i} className="p-4" style={{ width: colW }}>
                <Skeleton height={12} width="55%" rounded="rounded" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

export default function CompareScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { gstEnabled } = useStoreConfig().flags
  const { ids: idsParam, seed } = useLocalSearchParams<{ ids?: string; seed?: string }>()
  const compareList = useCompareStore(s => s.compareList)
  const qc = useQueryClient()
  const idList = useMemo(
    () =>
      (idsParam ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 4),
    [idsParam]
  )
  // Every id → slug this screen has seen (compare list, picks, fallbacks), so re-resolving after a change is instant.
  const known = useRef(new Map<string, string>())
  for (const p of compareList) known.current.set(p.id, p.slug)

  const resolved = useQuery({
    queryKey: ['compare-resolve', idList.join(',')],
    queryFn: () => resolveIds(idList, known.current, qc),
    enabled: idList.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })
  // Fewer than 2 usable ids falls back to defaults, like the web's redirect.
  const fallbackMode =
    idList.length < 2 || resolved.isError || (resolved.isSuccess && !resolved.isPlaceholderData && resolved.data.length < 2)
  const fallback = useQuery({
    queryKey: ['compare-default', seed ?? ''],
    queryFn: () => defaultEntries(seed, [...known.current].map(([id, slug]) => ({ id, slug }))),
    enabled: fallbackMode,
  })
  useEffect(() => {
    if (fallbackMode && fallback.data && fallback.data.length >= 2) {
      for (const e of fallback.data) known.current.set(e.id, e.slug)
      router.setParams({ ids: fallback.data.map(e => e.id).join(',') })
    }
  }, [fallbackMode, fallback.data, router])
  const entries: Entry[] | null = !fallbackMode && resolved.data && resolved.data.length >= 2 ? resolved.data : null

  const results = useQueries({
    queries: (entries ?? []).map(e => ({
      queryKey: ['compare-product', e.slug],
      queryFn: () => getProductBySlug(e.slug),
      staleTime: 60_000,
    })),
  })
  const loading =
    entries === null
      ? fallbackMode
        ? fallback.isLoading || (fallback.data?.length ?? 0) >= 2
        : resolved.isLoading
      : results.some(r => r.isLoading)
  const products = useMemo(
    () => (entries ?? []).map((e, i) => results[i]?.data as ProductRow | undefined).filter((p): p is ProductRow => !!p),
    [entries, results]
  )
  const ids = (entries ?? []).map(e => e.id)

  const update = (next: Entry[]) => {
    for (const e of next) known.current.set(e.id, e.slug)
    router.setParams({ ids: next.map(e => e.id).join(',') })
  }

  const noneToCompare = !loading && (entries === null ? fallbackMode && (fallback.data?.length ?? 0) < 2 : products.length < 2)

  // Rows where every product is empty are dropped; stripes follow the full SPEC_ROWS index like the web.
  const visibleRows = SPEC_ROWS.map(({ label, key }, rowIdx) => ({ label, rowIdx, values: products.map(p => key(p)) })).filter(r =>
    r.values.some(v => v != null)
  )
  const tableW = Math.max(640, width - 32)
  const labelW = 144
  const colW = products.length ? (tableW - labelW) / products.length : 0

  return (
    <View className="flex-1">
      <Screen
        header={<ScreenHeader title="Product Comparison" />}
        empty={
          noneToCompare ? (
            <View className="flex-1 items-center justify-center gap-3">
              <Text className="text-foreground-muted">No products available to compare.</Text>
              <Pressable onPress={() => router.navigate('/(tabs)/products')}>
                <Text className="text-sm text-accent-500">Browse Products</Text>
              </Pressable>
            </View>
          ) : (
            false
          )
        }
        scrollProps={{ showsVerticalScrollIndicator: false }}
      >
        {!loading && products.length < 4 ? (
          <View className="mb-4 flex-row justify-end">
            <CompareAddButton
              currentIds={ids}
              categoryId={products[0]?.category_id ?? null}
              onAdd={r => update([...(entries ?? []), { id: r.id, slug: r.slug }].slice(0, 4))}
            />
          </View>
        ) : null}

        {loading ? (
          <CompareTableSkeleton key="skeleton" cols={Math.min(4, Math.max(2, (entries ?? idList).length))} tableW={tableW} labelW={labelW} />
        ) : (
          // Own key: reusing the skeleton's View would add shadow-sm's CSS variables after mount (a css-interop remount).
          <View key="table" className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated shadow-sm">
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ width: tableW }}>
                <View className="flex-row border-b border-border-default">
                  <View className="bg-surface-secondary p-4" style={{ width: labelW }} />
                  {products.map(p => (
                    <View key={p.id} className="p-4" style={{ width: colW }}>
                      <ProductHead
                        p={p}
                        gstEnabled={gstEnabled}
                        ids={ids}
                        onChange={e => update((entries ?? []).map(x => (x.id === p.id ? e : x)))}
                      />
                    </View>
                  ))}
                </View>

                {visibleRows.map(({ label, values, rowIdx }, i) => {
                  const base = values[0]
                  const hasDiff = values.some(v => v !== base)
                  return (
                    <View
                      key={label}
                      className={`flex-row ${i < visibleRows.length - 1 ? 'border-b border-border-default' : ''} ${rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}
                    >
                      <View className="bg-surface-secondary p-4" style={{ width: labelW }}>
                        <Text className="text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
                          {label}
                        </Text>
                      </View>
                      {products.map((p, colIdx) => {
                        const val = values[colIdx]
                        const isDiff = hasDiff && colIdx > 0 && val !== base
                        return (
                          <View key={p.id} className={`p-4 ${isDiff ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`} style={{ width: colW }}>
                            {val != null ? (
                              <Text selectable className="text-sm text-foreground">
                                {val}
                              </Text>
                            ) : (
                              <Text className="text-sm text-foreground-muted">—</Text>
                            )}
                          </View>
                        )
                      })}
                    </View>
                  )
                })}
              </View>
            </ScrollView>
          </View>
        )}

        <View className="mt-6 items-center">
          <Pressable onPress={() => router.navigate('/(tabs)/products')}>
            <Text className="text-sm text-accent-500">← Back to Products</Text>
          </Pressable>
        </View>
      </Screen>
      <CompareBar />
    </View>
  )
}
