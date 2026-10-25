import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react-native'
import { Button, Caption, Checkbox, Chip, ChipGroup, IconButton, ModalSheet, Radio, Subheading, Text, TextButton, TextField, cn, type IconComponent } from '../../ui'
import { SORT_OPTIONS, activeFilterCount, humanizeLabel, splitList, type ListingParams } from './listing'
import type { ListingFacetValue as FacetValue, ListingFacets as FilterFacets } from '../../api/products'

type Category = { id: string; name: string; slug?: string; parent_category_id: string | null }
type Brand = { id: string; name: string; slug?: string }

// Mirror of controller-service components/visitor/MobileFilterSheet.tsx: the Filters button and its sheet.

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Subheading className="mb-2">{title}</Subheading>
      {children}
    </View>
  )
}

// A colour facet's dot as a Chip icon; one component per colour so it isn't remounted each render.
const swatches = new Map<string, IconComponent>()
function swatch(hex: string): IconComponent {
  let icon = swatches.get(hex)
  if (!icon) {
    icon = function Swatch({ size = 16 }) {
      return <View style={{ width: size - 4, height: size - 4, borderRadius: size, backgroundColor: hex }} className="border border-black/10 dark:border-white/20" />
    }
    swatches.set(hex, icon)
  }
  return icon
}

function CheckboxSection({ title, items, selected, onToggle }: { title: string; items: FacetValue[]; selected: string[]; onToggle: (v: string) => void }) {
  const [showAll, setShowAll] = useState(false)
  if (items.length === 0) return null
  const visible = showAll ? items : items.slice(0, 6)
  return (
    <Group title={title}>
      {visible.map(item => (
        <Checkbox
          key={item.value}
          checked={selected.includes(item.value)}
          onChange={() => onToggle(item.value)}
          label={item.count != null ? `${item.value} (${item.count})` : item.value}
        />
      ))}
      {items.length > 6 ? <TextButton label={showAll ? 'Show less' : `+${items.length - 6} more`} onPress={() => setShowAll(v => !v)} /> : null}
    </Group>
  )
}

/** The control bar's Filters button with its active-filter count. */
export function FiltersButton({ params, onPress }: { params: ListingParams; onPress: () => void }) {
  const count = activeFilterCount(params)
  return <Chip label="Filters" icon={SlidersHorizontal} selected={count > 0} meta={count > 0 ? count : undefined} onPress={onPress} />
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
    <ModalSheet
      open={open}
      onClose={onClose}
      title={tab === 'sort' ? 'Sort By' : 'Filters'}
      footer={
        <View className="flex-row gap-3">
          {hasAnyPending ? <Button label="Clear all" variant="secondary" onPress={() => setS(EMPTY)} className="flex-1" /> : null}
          <Button label="Apply Filters" onPress={apply} className="flex-1" />
        </View>
      }
    >
      <ChipGroup className="mb-5">
        <Chip label={`Filters${count > 0 ? ` (${count})` : ''}`} selected={tab === 'filters'} onPress={() => setTab('filters')} />
        <Chip label="Sort" selected={tab === 'sort'} onPress={() => setTab('sort')} />
      </ChipGroup>

      {tab === 'filters' ? (
        <View className="gap-6">
          <Group title="Price Range">
            <ChipGroup className="mb-3">
              {PRICE_PRESETS.map(p => {
                const on = s.minPrice === p.min && s.maxPrice === p.max && (p.min !== '' || p.max !== '')
                return (
                  <Chip
                    key={p.label}
                    label={p.label}
                    selected={on}
                    onPress={() => setS(prev => ({ ...prev, minPrice: on ? '' : p.min, maxPrice: on ? '' : p.max }))}
                  />
                )
              })}
            </ChipGroup>
            <View className="flex-row items-center gap-2">
              {(['minPrice', 'maxPrice'] as const).map((k, i) => (
                <View key={k} className="flex-1 flex-row items-center gap-2">
                  {i === 1 ? <Text className="text-sm text-foreground-muted">–</Text> : null}
                  <TextField
                    value={s[k]}
                    onChangeText={v => set(k, v.replace(/[^0-9.]/g, ''))}
                    placeholder={i === 0 ? 'Min' : 'Max'}
                    accessibilityLabel={i === 0 ? 'Minimum price' : 'Maximum price'}
                    prefix="₹"
                    keyboardType="numeric"
                    containerClassName="min-w-0 flex-1"
                  />
                </View>
              ))}
            </View>
          </Group>

          <Group title="Availability">
            <Checkbox checked={s.inStock} onChange={() => set('inStock', !s.inStock)} label={`In Stock only (${facets.inStockCount})`} />
            <Checkbox checked={s.onSale} onChange={() => set('onSale', !s.onSale)} label={`On Sale (${facets.onSaleCount})`} />
          </Group>

          {offerList.length > 0 ? (
            <Group title="Offers">
              {offerList.map(o => (
                <Checkbox key={o.slug} checked={s.offer === o.slug} onChange={() => set('offer', s.offer === o.slug ? '' : o.slug)} label={o.title} />
              ))}
            </Group>
          ) : null}

          {facets.hasRatings ? (
            <Group title="Rating">
              {(['4', '3'] as const).map(r => (
                <Radio
                  key={r}
                  selected={s.minRating === r}
                  label={`${'★'.repeat(Number(r))}${'☆'.repeat(5 - Number(r))} & above`}
                  onSelect={() => set('minRating', s.minRating === r ? '' : r)}
                />
              ))}
            </Group>
          ) : null}

          {facets.colors.length > 0 ? (
            <Group title="Color">
              <ChipGroup>
                {facets.colors.map(c => (
                  <Chip
                    key={c.value}
                    label={c.value}
                    icon={c.hex ? swatch(c.hex) : undefined}
                    selected={s.colors.includes(c.value)}
                    onPress={() => toggle('colors', c.value)}
                  />
                ))}
              </ChipGroup>
            </Group>
          ) : null}

          <CheckboxSection title="Grade" items={facets.grades} selected={s.grades} onToggle={v => toggle('grades', v)} />
          <CheckboxSection title="Material" items={facets.materials} selected={s.materials} onToggle={v => toggle('materials', v)} />
          <CheckboxSection title="Finish" items={facets.finishes} selected={s.finishes} onToggle={v => toggle('finishes', v)} />
          <CheckboxSection title="Compliance Standard" items={facets.compliances} selected={s.compliances} onToggle={v => toggle('compliances', v)} />
          <CheckboxSection title="Country of Origin" items={facets.origins} selected={s.origins} onToggle={v => toggle('origins', v)} />

          {facets.variantTypes.length > 0 ? (
            <Group title="Variant Type">
              <ChipGroup>
                {facets.variantTypes.map(vt => {
                  const on = s.variantType === vt.value
                  return (
                    <Chip
                      key={vt.value}
                      label={humanizeLabel(vt.value)}
                      meta={`(${vt.count})`}
                      selected={on}
                      onPress={() => setS(prev => ({ ...prev, variantType: on ? '' : vt.value, variantValue: on ? '' : prev.variantValue }))}
                    />
                  )
                })}
              </ChipGroup>
              {s.variantType && facets.variantValues.length > 0 ? (
                <ChipGroup className="mt-3">
                  {facets.variantValues.map(vv => {
                    const on = s.variantValue === vv.value
                    return <Chip key={vv.value} label={humanizeLabel(vv.value)} selected={on} onPress={() => set('variantValue', on ? '' : vv.value)} />
                  })}
                </ChipGroup>
              ) : null}
            </Group>
          ) : null}

          {facets.specFacets.length > 0 ? (
            <Group title="Specifications">
              {facets.specFacets.slice(0, 4).map(spec => (
                <View key={spec.key} className="mb-4">
                  <Caption className="mb-2">{humanizeLabel(spec.key)}</Caption>
                  <ChipGroup>
                    {spec.values.slice(0, 8).map(sv => {
                      const on = s.specKey === spec.key && s.specValue === sv.value
                      return (
                        <Chip
                          key={sv.value}
                          size="sm"
                          label={humanizeLabel(sv.value)}
                          meta={`(${sv.count})`}
                          selected={on}
                          onPress={() => setS(prev => ({ ...prev, specKey: on ? '' : spec.key, specValue: on ? '' : sv.value }))}
                        />
                      )
                    })}
                  </ChipGroup>
                </View>
              ))}
            </Group>
          ) : null}

          <Group title="Categories">
            <Checkbox checked={s.categories.length === 0} onChange={() => set('categories', [])} label="All Categories" />
            {mainCats.map(cat => {
              const subs = subCats.filter(sc => sc.parent_category_id === cat.id)
              const on = catSelected(cat)
              const childOn = subs.some(catSelected)
              const isOpen = !!expanded[cat.id]
              return (
                <View key={cat.id}>
                  <View className="flex-row items-center">
                    <Checkbox checked={on} onChange={() => toggleCat(cat)} className="flex-1">
                      <Text
                        className={cn(
                          'text-[15px] leading-[22px]',
                          childOn && !on ? 'font-semibold text-accent-700 dark:text-accent-300' : 'text-foreground',
                        )}
                      >
                        {cat.name}
                      </Text>
                    </Checkbox>
                    {subs.length > 0 ? (
                      <IconButton
                        icon={isOpen ? ChevronUp : ChevronDown}
                        label={`${isOpen ? 'Hide' : 'Show'} ${cat.name} subcategories`}
                        size="sm"
                        onPress={() => setExpanded(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                      />
                    ) : null}
                  </View>
                  {subs.length > 0 && isOpen ? (
                    <View className="ml-8">
                      {subs.map(sub => (
                        <Checkbox key={sub.id} checked={catSelected(sub)} onChange={() => toggleCat(sub)} label={sub.name} />
                      ))}
                    </View>
                  ) : null}
                </View>
              )
            })}
          </Group>

          <Group title="Brands">
            <Checkbox checked={s.brands.length === 0} onChange={() => set('brands', [])} label="All Brands" />
            {brands.map(brand => (
              <Checkbox key={brand.id} checked={brandSelected(brand)} onChange={() => toggleBrand(brand)} label={brand.name} />
            ))}
          </Group>
        </View>
      ) : (
        <View>
          {SORT_OPTIONS.map(opt => (
            <Radio
              key={opt.label}
              selected={s.sort === opt.sort && s.order === opt.order}
              label={opt.label}
              onSelect={() => setS(prev => ({ ...prev, sort: opt.sort, order: opt.order }))}
            />
          ))}
        </View>
      )}
    </ModalSheet>
  )
}
