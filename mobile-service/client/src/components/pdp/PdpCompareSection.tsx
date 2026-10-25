import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Check, Columns3, ImageIcon } from 'lucide-react-native'
import { Badge, Button, Card, ListRow, ModalSheet, Text, TextButton } from '../../ui'
import { inr } from '../../lib/format'
import { useTokens } from '../../theme'

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
  const t = useTokens()
  return (
    <View
      className={`overflow-hidden rounded-xl bg-surface-secondary ${current ? 'border-2 border-accent-400' : 'border border-border-default'}`}
      style={{ width: size, height: size }}
    >
      {p.image ? (
        <Image recyclingKey={p.image} source={{ uri: p.image }} style={{ flex: 1, margin: 4 }} contentFit="contain" accessibilityLabel={p.name} />
      ) : (
        <View className="h-full w-full items-center justify-center">
          <ImageIcon size={size / 2.7} strokeWidth={1} color={t.foregroundMuted} />
        </View>
      )}
    </View>
  )
}

export default function PdpCompareSection({ currentProduct, relatedProducts }: { currentProduct: CompareItem; relatedProducts: CompareItem[] }) {
  const router = useRouter()
  const [slots, setSlots] = useState<CompareItem[]>([currentProduct, ...relatedProducts.slice(0, 2)])
  const [swapSlot, setSwapSlot] = useState<number | null>(null)
  // The sheet keeps the last slot's options while it slides away.
  const [shownSlot, setShownSlot] = useState<number | null>(null)
  if (swapSlot != null && swapSlot !== shownSlot) setShownSlot(swapSlot)
  const [width, setWidth] = useState(0)

  const openCompare = () => router.push({ pathname: '/compare', params: { ids: slots.map(p => p.id).join(',') } })
  const specRows = EXTRA_SPEC_ROWS.filter(row => slots.some(p => row.key(p) != null))
  const allOptions = [currentProduct, ...relatedProducts]
  const tableW = Math.max(MIN_TABLE_W, width)
  const colW = (tableW * Math.floor(80 / slots.length)) / 100
  const swapOptions = shownSlot == null ? [] : allOptions.filter(o => !slots.some((s, si) => si !== shownSlot && s.id === o.id))

  const row = (label: string, values: (string | null)[], bold = false) => (
    <View key={label} className="flex-row border-t border-border-default">
      <View style={{ width: LABEL_W }} className="justify-center py-2.5 pr-3">
        <Text className="text-[11px] font-extrabold uppercase tracking-wider text-foreground-muted">{label}</Text>
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
    <Card className="mb-6 p-5" padded={false}>
      <View className="mb-5 flex-row items-center justify-between gap-2">
        <Text accessibilityRole="header" className="flex-1 font-display text-xl font-extrabold text-foreground">
          Compare Similar Products
        </Text>
        <TextButton label="Full Comparison" onPress={openCompare} />
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
                      <Pressable accessibilityRole="link" hitSlop={4} onPress={() => router.push(`/product/${p.slug}`)}>
                        <Text numberOfLines={2} className="mb-1 text-center text-xs font-semibold leading-snug text-foreground">
                          {p.name}
                        </Text>
                      </Pressable>
                    )}
                    <View className="mb-1 flex-row flex-wrap items-baseline justify-center">
                      <Text className="text-sm font-bold text-primary-600 dark:text-primary-400">₹{inr(p.price)}</Text>
                      {discount > 0 ? <Text className="ml-1 text-[11px] font-semibold text-green-600 dark:text-green-400">{discount}% off</Text> : null}
                    </View>
                    {isCurrent ? (
                      <Badge label="Viewing" tone="accent" size="sm" />
                    ) : (
                      <TextButton label="Change" accessibilityLabel={`Change ${p.name}`} onPress={() => setSwapSlot(i)} className="self-center" />
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
        <Button label="View Full Comparison" icon={Columns3} size="md" block={false} onPress={openCompare} />
      </View>

      <ModalSheet open={swapSlot != null} onClose={() => setSwapSlot(null)} title="Compare with">
        <View className="-mx-5">
          {swapOptions.map(o => {
            const current = o.id === slots[shownSlot ?? 0]?.id
            return (
              <ListRow
                key={o.id}
                title={o.name}
                subtitle={`₹${inr(o.price)}`}
                leading={<Thumb p={o} size={40} />}
                trailing={current ? <CurrentTick /> : null}
                chevron={false}
                onPress={() => {
                  setSlots(prev => prev.map((p, i) => (i === shownSlot ? o : p)))
                  setSwapSlot(null)
                }}
                className={current ? 'bg-accent-50 dark:bg-accent-900/20' : undefined}
              />
            )
          })}
        </View>
      </ModalSheet>
    </Card>
  )
}

function CurrentTick() {
  const t = useTokens()
  return <Check size={18} strokeWidth={2.5} color={t.accent500} />
}
