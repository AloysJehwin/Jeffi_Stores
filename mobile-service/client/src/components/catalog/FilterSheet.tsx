import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Text } from '../../ui'
import Animated, { Easing, SlideInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { CheckCircleIcon, ChevronDownIcon, CloseIcon, FunnelIcon, TickIcon } from './icons'
import { SORT_OPTIONS, activeFilterCount, humanizeLabel, splitList, type ListingParams } from './listing'
import type { ListingFacetValue as FacetValue, ListingFacets as FilterFacets } from '../../api/products'
import { accent, status, useTokens } from '../../theme'

type Category = { id: string; name: string; slug?: string; parent_category_id: string | null }
type Brand = { id: string; name: string; slug?: string }

// Mirror of controller-service components/visitor/MobileFilterSheet.tsx: the Filters button and its sheet.

const ROW = 'w-full flex-row items-center gap-3 rounded-xl border px-4 py-3'
const ROW_ON = 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
const ROW_OFF = 'border-border-default bg-surface'
const TXT_ON = 'text-accent-700 dark:text-accent-400'
const CHIP = 'rounded-full border px-3 py-1.5'
const CHIP_OFF = 'border-border-default bg-surface'

function Box({ on }: { on: boolean }) {
  return (
    <View className={`h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${on ? 'border-accent-500 bg-accent-500' : 'border-border-secondary'}`}>
      {on ? <TickIcon color={status.white} /> : null}
    </View>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <Text className="mb-3 text-sm font-semibold text-foreground">{children}</Text>
}

function CheckRow({ on, label, count, onPress }: { on: boolean; label: string; count?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`${ROW} ${on ? ROW_ON : ROW_OFF}`}>
      <Box on={on} />
      <Text className={`flex-1 text-sm font-medium ${on ? TXT_ON : 'text-foreground'}`}>{label}</Text>
      {count != null ? <Text className="text-xs text-foreground-muted">({count})</Text> : null}
    </Pressable>
  )
}

function RadioRow({ on, label, onPress, sub = false }: { on: boolean; label: string; onPress: () => void; sub?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className={`w-full flex-row items-center justify-between rounded-xl border px-4 ${sub ? 'py-2.5' : 'py-3'} ${on ? ROW_ON : ROW_OFF}`}
    >
      <Text className={`text-sm ${on ? `${TXT_ON} font-medium` : sub ? 'text-foreground-secondary' : 'font-medium text-foreground'}`}>{label}</Text>
      {on ? <CheckCircleIcon color={accent[500]} /> : null}
    </Pressable>
  )
}

function Chip({ on, onPress, children, className = CHIP }: { on: boolean; onPress: () => void; children: ReactNode; className?: string }) {
  return (
    <Pressable onPress={onPress} className={`flex-row items-center gap-1.5 ${className} ${on ? ROW_ON : CHIP_OFF}`}>
      {children}
    </Pressable>
  )
}

const chipText = (on: boolean) => `text-xs font-medium ${on ? TXT_ON : 'text-foreground-secondary'}`

function CheckboxSection({ title, items, selected, onToggle }: { title: string; items: FacetValue[]; selected: string[]; onToggle: (v: string) => void }) {
  const [showAll, setShowAll] = useState(false)
  if (items.length === 0) return null
  const visible = showAll ? items : items.slice(0, 6)
  return (
    <View>
      <Heading>{title}</Heading>
      <View className="gap-2">
        {visible.map(item => (
          <CheckRow key={item.value} on={selected.includes(item.value)} label={item.value} count={item.count} onPress={() => onToggle(item.value)} />
        ))}
        {items.length > 6 ? (
          <Pressable onPress={() => setShowAll(v => !v)} className="px-4">
            <Text className="text-sm font-medium text-accent-500">{showAll ? 'Show less' : `+${items.length - 6} more`}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/** The control bar's Filters button with its active-filter count. */
export function FiltersButton({ params, onPress }: { params: ListingParams; onPress: () => void }) {
  const t = useTokens()
  const count = activeFilterCount(params)
  return (
    <Pressable onPress={onPress} className="h-9 flex-row items-center gap-1.5 rounded-lg border border-border-default px-3">
      <FunnelIcon size={14} color={t.foregroundSecondary} />
      <Text className="text-xs font-medium text-foreground-secondary">Filters</Text>
      {count > 0 ? (
        <View className="h-4 w-4 items-center justify-center rounded-full bg-accent-500">
          <Text className="text-[10px] font-bold text-white">{count}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const PRICE_PRESETS = [
  { label: 'Under ₹500', min: '', max: '500' },
  { label: '₹500–₹2k', min: '500', max: '2000' },
  { label: '₹2k–₹10k', min: '2000', max: '10000' },
  { label: '₹10k+', min: '10000', max: '' },
]

type Pending = {
  categories: string[]
  brands: string[]
  sort: string
  order: string
  minPrice: string
  maxPrice: string
  inStock: boolean
  onSale: boolean
  offer: string
  minRating: string
  colors: string[]
  grades: string[]
  materials: string[]
  finishes: string[]
  compliances: string[]
  origins: string[]
  variantType: string
  variantValue: string
  specKey: string
  specValue: string
}

function fromParams(p: ListingParams): Pending {
  return {
    categories: splitList(p.category),
    brands: splitList(p.brand),
    sort: p.sort ?? '',
    order: p.order ?? '',
    minPrice: p.minPrice ?? '',
    maxPrice: p.maxPrice ?? '',
    inStock: p.inStock === '1',
    onSale: p.onSale === '1',
    offer: p.offer ?? '',
    minRating: p.minRating ?? '',
    colors: splitList(p.color),
    grades: splitList(p.grade),
    materials: splitList(p.material),
    finishes: splitList(p.finish),
    compliances: splitList(p.compliance),
    origins: splitList(p.origin),
    variantType: p.variantType ?? '',
    variantValue: p.variantValue ?? '',
    specKey: p.specKey ?? '',
    specValue: p.specValue ?? '',
  }
}

function toParams(s: Pending, search?: string): ListingParams {
  const out: ListingParams = {}
  const join = (v: string[]) => (v.length ? v.join(',') : undefined)
  out.category = join(s.categories)
  out.brand = join(s.brands)
  out.sort = s.sort || undefined
  out.order = s.order || undefined
  out.minPrice = s.minPrice || undefined
  out.maxPrice = s.maxPrice || undefined
  out.inStock = s.inStock ? '1' : undefined
  out.onSale = s.onSale ? '1' : undefined
  out.offer = s.offer || undefined
  out.minRating = s.minRating || undefined
  out.color = join(s.colors)
  out.grade = join(s.grades)
  out.material = join(s.materials)
  out.finish = join(s.finishes)
  out.compliance = join(s.compliances)
  out.origin = join(s.origins)
  out.variantType = s.variantType || undefined
  out.variantValue = s.variantValue || undefined
  if (s.specKey && s.specValue) {
    out.specKey = s.specKey
    out.specValue = s.specValue
  }
  if (search) out.search = search
  return out
}

const EMPTY: Pending = fromParams({})

export default function FilterSheet({
  open,
  onClose,
  params,
  categories,
  brands,
  facets,
  offers,
  onApply,
}: {
  open: boolean
  onClose: () => void
  params: ListingParams
  categories: Category[]
  brands: Brand[]
  facets: FilterFacets
  offers: { slug: string; title: string }[]
  onApply: (next: ListingParams) => void
}) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'filters' | 'sort'>('filters')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [s, setS] = useState<Pending>(() => fromParams(params))
  const set = <K extends keyof Pending>(k: K, v: Pending[K]) => setS(prev => ({ ...prev, [k]: v }))
  const toggle = (k: 'categories' | 'brands' | 'colors' | 'grades' | 'materials' | 'finishes' | 'compliances' | 'origins', v: string) =>
    setS(prev => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter(x => x !== v) : [...prev[k], v] }))

  // Reset the pending state to the URL each time the sheet opens.
  useEffect(() => {
    if (open) {
      setTab('filters')
      setS(fromParams(params))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const count = activeFilterCount(params)
  const mainCats = categories.filter(c => !c.parent_category_id)
  const subCats = categories.filter(c => c.parent_category_id)
  const catSelected = (c: Category) => s.categories.includes(c.id) || (!!c.slug && s.categories.includes(c.slug))
  const toggleCat = (c: Category) =>
    setS(prev => {
      const on = prev.categories.includes(c.id) || (!!c.slug && prev.categories.includes(c.slug))
      return { ...prev, categories: on ? prev.categories.filter(x => x !== c.id && x !== c.slug) : [...prev.categories, c.id] }
    })
  const brandSelected = (b: Brand) => s.brands.includes(b.id) || (!!b.slug && s.brands.includes(b.slug))
  const toggleBrand = (b: Brand) =>
    setS(prev => {
      const on = prev.brands.includes(b.id) || (!!b.slug && prev.brands.includes(b.slug))
      return { ...prev, brands: on ? prev.brands.filter(x => x !== b.id && x !== b.slug) : [...prev.brands, b.id] }
    })

  const hasAnyPending =
    s.categories.length > 0 ||
    s.brands.length > 0 ||
    !!s.sort ||
    !!s.minPrice ||
    !!s.maxPrice ||
    s.inStock ||
    s.onSale ||
    !!s.minRating ||
    s.grades.length > 0 ||
    s.materials.length > 0 ||
    s.finishes.length > 0 ||
    s.compliances.length > 0 ||
    s.origins.length > 0 ||
    !!s.variantType ||
    !!s.specKey

  const apply = () => {
    onApply(toParams(s, params.search))
    onClose()
  }

  const offerList = s.offer && !offers.some(o => o.slug === s.offer) ? [...offers, { slug: s.offer, title: s.offer }] : offers

  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable className="absolute inset-0 bg-black/50" onPress={onClose} accessibilityLabel="Close filters" />
        <Animated.View
          entering={SlideInDown.duration(280).easing(Easing.bezier(0.32, 0.72, 0, 1))}
          className="rounded-t-2xl bg-surface-elevated shadow-2xl"
          style={{ maxHeight: '90%' }}
        >
          <View className="flex-row items-center justify-between border-b border-border-default px-5 py-4">
            <Text className="text-base font-semibold text-foreground">{tab === 'sort' ? 'Sort By' : 'Filters'}</Text>
            <View className="flex-row items-center gap-3">
              {hasAnyPending ? (
                <Pressable onPress={() => setS(EMPTY)}>
                  <Text className="text-sm font-medium text-accent-500">Clear all</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full" accessibilityLabel="Close">
                <CloseIcon color={t.foregroundMuted} />
              </Pressable>
            </View>
          </View>

          <View className="flex-row items-center border-b border-border-default px-5 pt-2">
            {(['filters', 'sort'] as const).map(k => (
              <Pressable key={k} onPress={() => setTab(k)} className={`-mb-px flex-1 border-b-2 py-3 ${tab === k ? 'border-accent-500' : 'border-transparent'}`}>
                <Text className={`text-center text-sm font-semibold ${tab === k ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>
                  {k === 'sort' ? 'Sort' : `Filters${count > 0 ? ` (${count})` : ''}`}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'filters' ? (
            <ScrollView className="shrink" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 24 }} keyboardShouldPersistTaps="handled">
              <View>
                <Heading>Price Range</Heading>
                <View className="mb-3 flex-row flex-wrap gap-2">
                  {PRICE_PRESETS.map(p => {
                    const on = s.minPrice === p.min && s.maxPrice === p.max && (p.min !== '' || p.max !== '')
                    return (
                      <Chip
                        key={p.label}
                        on={on}
                        onPress={() => setS(prev => ({ ...prev, minPrice: on ? '' : p.min, maxPrice: on ? '' : p.max }))}
                      >
                        <Text className={chipText(on)}>{p.label}</Text>
                      </Chip>
                    )
                  })}
                </View>
                <View className="flex-row items-center gap-2">
                  {(['minPrice', 'maxPrice'] as const).map((k, i) => (
                    <View key={k} className="flex-1 flex-row items-center gap-2">
                      {i === 1 ? <Text className="text-sm text-foreground-muted">–</Text> : null}
                      <TextInput
                        value={s[k]}
                        onChangeText={v => set(k, v.replace(/[^0-9.]/g, ''))}
                        placeholder={i === 0 ? 'Min ₹' : 'Max ₹'}
                        placeholderTextColor={t.foregroundMuted}
                        keyboardType="numeric"
                        className="min-w-0 flex-1 rounded-xl border border-border-default bg-surface px-3 py-2 text-sm text-foreground"
                      />
                    </View>
                  ))}
                </View>
              </View>

              <View>
                <Heading>Availability</Heading>
                <View className="gap-2">
                  <CheckRow on={s.inStock} label="In Stock only" count={facets.inStockCount} onPress={() => set('inStock', !s.inStock)} />
                  <CheckRow on={s.onSale} label="On Sale" count={facets.onSaleCount} onPress={() => set('onSale', !s.onSale)} />
                </View>
              </View>

              {offerList.length > 0 ? (
                <View>
                  <Heading>Offers</Heading>
                  <View className="gap-2">
                    {offerList.map(o => (
                      <CheckRow key={o.slug} on={s.offer === o.slug} label={o.title} onPress={() => set('offer', s.offer === o.slug ? '' : o.slug)} />
                    ))}
                  </View>
                </View>
              ) : null}

              {facets.hasRatings ? (
                <View>
                  <Heading>Rating</Heading>
                  <View className="gap-2">
                    {(['4', '3'] as const).map(r => (
                      <RadioRow
                        key={r}
                        on={s.minRating === r}
                        label={`${'★'.repeat(Number(r))}${'☆'.repeat(5 - Number(r))} & above`}
                        onPress={() => set('minRating', s.minRating === r ? '' : r)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {facets.colors.length > 0 ? (
                <View>
                  <Heading>Color</Heading>
                  <View className="flex-row flex-wrap gap-2">
                    {facets.colors.map(c => {
                      const on = s.colors.includes(c.value)
                      return (
                        <Chip key={c.value} on={on} onPress={() => toggle('colors', c.value)} className="rounded-full border px-2.5 py-1.5">
                          {c.hex ? <View className="h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: c.hex }} /> : null}
                          <Text className={chipText(on)}>{c.value}</Text>
                        </Chip>
                      )
                    })}
                  </View>
                </View>
              ) : null}

              <CheckboxSection title="Grade" items={facets.grades} selected={s.grades} onToggle={v => toggle('grades', v)} />
              <CheckboxSection title="Material" items={facets.materials} selected={s.materials} onToggle={v => toggle('materials', v)} />
              <CheckboxSection title="Finish" items={facets.finishes} selected={s.finishes} onToggle={v => toggle('finishes', v)} />
              <CheckboxSection title="Compliance Standard" items={facets.compliances} selected={s.compliances} onToggle={v => toggle('compliances', v)} />
              <CheckboxSection title="Country of Origin" items={facets.origins} selected={s.origins} onToggle={v => toggle('origins', v)} />

              {facets.variantTypes.length > 0 ? (
                <View>
                  <Heading>Variant Type</Heading>
                  <View className="flex-row flex-wrap gap-2">
                    {facets.variantTypes.map(vt => {
                      const on = s.variantType === vt.value
                      return (
                        <Chip key={vt.value} on={on} onPress={() => setS(prev => ({ ...prev, variantType: on ? '' : vt.value, variantValue: on ? '' : prev.variantValue }))}>
                          <Text className={chipText(on)}>
                            {humanizeLabel(vt.value)} <Text className="text-foreground-muted">({vt.count})</Text>
                          </Text>
                        </Chip>
                      )
                    })}
                  </View>
                  {s.variantType && facets.variantValues.length > 0 ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {facets.variantValues.map(vv => {
                        const on = s.variantValue === vv.value
                        return (
                          <Chip key={vv.value} on={on} onPress={() => set('variantValue', on ? '' : vv.value)}>
                            <Text className={chipText(on)}>{humanizeLabel(vv.value)}</Text>
                          </Chip>
                        )
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {facets.specFacets.length > 0 ? (
                <View>
                  <Heading>Specifications</Heading>
                  {facets.specFacets.slice(0, 4).map(spec => (
                    <View key={spec.key} className="mb-4">
                      <Text className="mb-2 text-xs font-medium text-foreground-muted">{humanizeLabel(spec.key)}</Text>
                      <View className="flex-row flex-wrap gap-1.5">
                        {spec.values.slice(0, 8).map(sv => {
                          const on = s.specKey === spec.key && s.specValue === sv.value
                          return (
                            <Chip
                              key={sv.value}
                              on={on}
                              className="rounded-lg border px-2.5 py-1"
                              onPress={() => setS(prev => ({ ...prev, specKey: on ? '' : spec.key, specValue: on ? '' : sv.value }))}
                            >
                              <Text className={chipText(on)}>
                                {humanizeLabel(sv.value)} <Text className="text-foreground-muted">({sv.count})</Text>
                              </Text>
                            </Chip>
                          )
                        })}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View>
                <Heading>Categories</Heading>
                <View className="gap-2">
                  <RadioRow on={s.categories.length === 0} label="All Categories" onPress={() => set('categories', [])} />
                  {mainCats.map(cat => {
                    const subs = subCats.filter(sc => sc.parent_category_id === cat.id)
                    const on = catSelected(cat)
                    const childOn = subs.some(catSelected)
                    const isOpen = !!expanded[cat.id]
                    return (
                      <View key={cat.id}>
                        <View
                          className={`flex-row items-center rounded-xl border ${on ? ROW_ON : childOn ? 'border-accent-300 bg-accent-50/50 dark:border-accent-700 dark:bg-accent-900/10' : ROW_OFF}`}
                        >
                          <Pressable onPress={() => toggleCat(cat)} className="flex-1 px-4 py-3">
                            <Text className={`text-sm font-medium ${on ? TXT_ON : 'text-foreground'}`}>{cat.name}</Text>
                          </Pressable>
                          <View className="flex-row items-center gap-1 pr-3">
                            {on ? <CheckCircleIcon color={accent[500]} /> : null}
                            {subs.length > 0 ? (
                              <Pressable onPress={() => setExpanded(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))} className="p-1" hitSlop={6}>
                                <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
                                  <ChevronDownIcon color={t.foregroundMuted} />
                                </View>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                        {subs.length > 0 && isOpen ? (
                          <View className="ml-4 mt-1 gap-1">
                            {subs.map(sub => (
                              <RadioRow key={sub.id} sub on={catSelected(sub)} label={sub.name} onPress={() => toggleCat(sub)} />
                            ))}
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </View>
              </View>

              <View>
                <Heading>Brands</Heading>
                <View className="gap-2">
                  <RadioRow on={s.brands.length === 0} label="All Brands" onPress={() => set('brands', [])} />
                  {brands.map(brand => (
                    <RadioRow key={brand.id} on={brandSelected(brand)} label={brand.name} onPress={() => toggleBrand(brand)} />
                  ))}
                </View>
              </View>
            </ScrollView>
          ) : (
            <ScrollView className="shrink" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 8 }}>
              {SORT_OPTIONS.map(opt => (
                <RadioRow
                  key={opt.label}
                  on={s.sort === opt.sort && s.order === opt.order}
                  label={opt.label}
                  onPress={() => setS(prev => ({ ...prev, sort: opt.sort, order: opt.order }))}
                />
              ))}
            </ScrollView>
          )}

          <View className="border-t border-border-default px-5 pt-4" style={{ paddingBottom: 16 + insets.bottom }}>
            <Pressable onPress={apply} className="w-full rounded-xl bg-accent-500 py-3 active:bg-accent-600">
              <Text className="text-center text-sm font-semibold text-white">Apply Filters</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
