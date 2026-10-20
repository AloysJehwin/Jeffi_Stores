import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Glyph, P } from './Glyph'
import { inr } from '../../lib/format'

// Mirror of controller-service components/visitor/PdpCompareSection.tsx (scrollable table at the mobile breakpoint).

export interface CompareItem {
  id: string
  name: string
  slug: string
  price: number
  mrp: number | null
  image: string | null
  brandName: string | null
  categoryId: string | null
  [key: string]: any
}

const EXTRA_SPEC_ROWS: { label: string; key: (p: CompareItem) => string | null }[] = [
  { label: 'Material', key: p => p.material ?? null },
  { label: 'Finish', key: p => p.finish ?? null },
  { label: 'Variant', key: p => p.variant_type ?? null },
  { label: 'Condition', key: p => p.condition ?? null },
  { label: 'Color', key: p => p.color ?? null },
  { label: 'Weight', key: p => (p.weight != null ? `${p.weight} ${p.weight_unit ?? 'kg'}` : null) },
  { label: 'Net Weight', key: p => (p.net_weight_grams != null ? `${p.net_weight_grams} g` : null) },
  { label: 'Volume', key: p => (p.volume_ml != null ? `${p.volume_ml} ml` : null) },
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
]

const LABEL_W = 96
const MIN_TABLE_W = 480

function Thumb({ p, size, current = false }: { p: CompareItem; size: number; current?: boolean }) {
  return (
    <View
      className={`overflow-hidden rounded-lg bg-surface-secondary ${current ? 'border-2 border-accent-400' : 'border border-border-default'}`}
      style={{ width: size, height: size }}
    >
      {p.image ? (
        <Image source={{ uri: p.image }} style={{ flex: 1, margin: 4 }} contentFit="contain" accessibilityLabel={p.name} />
      ) : (
        <View className="h-full w-full items-center justify-center">
          <Glyph d={P.photo} size={size / 2.7} strokeWidth={1} className="text-foreground-muted" />
        </View>
      )}
    </View>
  )
}

export default function PdpCompareSection({ currentProduct, relatedProducts }: { currentProduct: CompareItem; relatedProducts: CompareItem[] }) {
  const router = useRouter()
  const [slots, setSlots] = useState<CompareItem[]>([currentProduct, ...relatedProducts.slice(0, 2)])
  const [swapSlot, setSwapSlot] = useState<number | null>(null)
  const [width, setWidth] = useState(0)

  const openCompare = () => router.push({ pathname: '/compare', params: { ids: slots.map(p => p.id).join(',') } })
  const specRows = EXTRA_SPEC_ROWS.filter(row => slots.some(p => row.key(p) != null))
  const allOptions = [currentProduct, ...relatedProducts]
  const tableW = Math.max(MIN_TABLE_W, width)
  const colW = (tableW * Math.floor(80 / slots.length)) / 100
  const swapOptions = swapSlot == null ? [] : allOptions.filter(o => !slots.some((s, si) => si !== swapSlot && s.id === o.id))

  const row = (label: string, values: (string | null)[], bold = false) => (
    <View key={label} className="flex-row border-t border-border-default">
      <View style={{ width: LABEL_W }} className="justify-center py-2.5 pr-3">
        <Text className="text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
          {label}
        </Text>
      </View>
      {values.map((val, i) => {
        const isDiff = i > 0 && val !== values[0]
        return (
          <View key={slots[i].id} style={{ width: colW }} className="justify-center px-2 py-2.5">
            {val == null ? (
              <Text className="text-center text-xs text-foreground-muted">—</Text>
            ) : (
              <Text
                className={`text-center text-xs ${isDiff ? 'font-medium text-amber-600 dark:text-amber-400' : `text-foreground ${bold ? 'font-medium' : ''}`}`}
              >
                {val}
              </Text>
            )}
          </View>
        )
      })}
    </View>
  )

  return (
    <View className="mb-8 rounded-lg border border-border-default bg-surface-elevated p-6 shadow-sm">
      <View className="mb-5 flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-xl font-bold text-foreground">Compare Similar Products</Text>
        <Pressable onPress={openCompare} className="flex-row items-center gap-1.5">
          <Text className="text-sm font-medium text-accent-500">Full Comparison</Text>
          <Glyph d={P.chevronRight} size={16} className="text-accent-500" />
        </Pressable>
      </View>

      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ marginHorizontal: -8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8 }}>
          <View style={{ width: tableW }}>
            <View className="flex-row">
              <View style={{ width: LABEL_W }} />
              {slots.map((p, i) => {
                const isCurrent = i === 0
                const discount = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0
                return (
                  <View key={p.id} style={{ width: colW }} className="items-center px-2 pb-4">
                    <View className="mb-2">
                      <Thumb p={p} size={64} current={isCurrent} />
                    </View>
                    {isCurrent ? (
                      <Text numberOfLines={2} className="mb-1 text-center text-xs font-semibold leading-snug text-foreground">
                        {p.name}
                      </Text>
                    ) : (
                      <Pressable onPress={() => router.push(`/product/${p.slug}`)}>
                        <Text numberOfLines={2} className="mb-1 text-center text-xs font-semibold leading-snug text-foreground">
                          {p.name}
                        </Text>
                      </Pressable>
                    )}
                    <View className="mb-1 flex-row flex-wrap items-baseline justify-center">
                      <Text className="text-sm font-bold text-primary-600 dark:text-primary-400">₹{inr(p.price)}</Text>
                      {discount > 0 ? <Text className="ml-1 text-[10px] font-semibold text-green-600">{discount}% off</Text> : null}
                    </View>
                    {isCurrent ? (
                      <View className="rounded-full bg-accent-50 px-2 py-0.5 dark:bg-accent-900/20">
                        <Text className="text-[10px] font-semibold text-accent-600">Viewing</Text>
                      </View>
                    ) : (
                      <Pressable onPress={() => setSwapSlot(i)}>
                        <Text className="text-xs font-medium text-accent-500">Change</Text>
                      </Pressable>
                    )}
                  </View>
                )
              })}
            </View>
            {row('Brand', slots.map(p => p.brandName), true)}
            {specRows.map(r => row(r.label, slots.map(p => r.key(p))))}
          </View>
        </ScrollView>
      </View>

      <View className="mt-4 items-center">
        <Pressable onPress={openCompare} className="flex-row items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5">
          <Glyph d={P.columns} size={16} className="text-white" />
          <Text className="text-sm font-semibold text-white">View Full Comparison</Text>
        </Pressable>
      </View>

      <Modal visible={swapSlot != null} transparent animationType="fade" onRequestClose={() => setSwapSlot(null)}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setSwapSlot(null)} />
          {swapSlot != null ? (
            <View className="w-64 overflow-hidden rounded-xl border border-border-default bg-surface-elevated shadow-2xl">
              {swapOptions.map(o => {
                const current = o.id === slots[swapSlot]?.id
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      setSlots(prev => prev.map((p, i) => (i === swapSlot ? o : p)))
                      setSwapSlot(null)
                    }}
                    className={`flex-row items-center gap-2.5 px-3 py-2 ${current ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
                  >
                    <Thumb p={o} size={28} />
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={2} className="text-xs font-medium leading-snug text-foreground">
                        {o.name}
                      </Text>
                      <Text className="text-[10px] text-foreground-muted">₹{inr(o.price)}</Text>
                    </View>
                    {current ? <Glyph d={P.check} size={14} strokeWidth={2.5} className="text-accent-500" /> : null}
                  </Pressable>
                )
              })}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  )
}
