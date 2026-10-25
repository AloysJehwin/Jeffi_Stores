import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ChevronRightIcon, CubeIcon } from './icons'
import type { ListingCard } from '../../api/products'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { useTokens } from '../../theme'

// ProductGrid's table view (TableRow + StockBadge).

function StockBadge({ effectiveStock, stockStatus }: { effectiveStock: number; stockStatus: string }) {
  const [box, txt, label] =
    effectiveStock === 0 || stockStatus === 'Out of Stock'
      ? ['bg-red-100 dark:bg-red-900/30', 'text-red-700 dark:text-red-400', 'Out of Stock']
      : stockStatus === 'Low Stock'
        ? ['bg-amber-100 dark:bg-amber-900/30', 'text-amber-700 dark:text-amber-300', 'Low Stock']
        : ['bg-green-100 dark:bg-green-900/30', 'text-green-700 dark:text-green-400', 'In Stock']
  return (
    <View className={`rounded-full px-2 py-0.5 ${box}`}>
      <Text className={`text-[11px] font-semibold ${txt}`}>{label}</Text>
    </View>
  )
}

function TableRow({ product: c, stripe, last }: { product: ListingCard; stripe: boolean; last: boolean }) {
  const router = useRouter()
  const t = useTokens()
  const src = absUrl(c.primaryImage?.thumbnail_url || c.primaryImage?.image_url)
  const specs = [c.grade, c.material, c.finish].filter(Boolean) as string[]
  const mrp = c.mrp
  const off = c.mrpDiscount

  return (
    <Pressable
      onPress={() => router.push(`/product/${c.slug}`)}
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-accent-50 dark:active:bg-accent-900/10 ${last ? '' : 'border-b border-border-default'} ${stripe ? 'bg-surface-secondary/30' : ''}`}
    >
      <View className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
        {src ? (
          <Image source={{ uri: src }} contentFit="contain" style={{ flex: 1, margin: 4 }} accessibilityLabel={c.name} />
        ) : (
          <View className="flex-1 items-center justify-center opacity-30">
            <CubeIcon strokeWidth={1.5} color={t.foregroundMuted} />
          </View>
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-medium text-foreground">
          {c.name}
        </Text>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          {c.brandName ? <Text className="text-[10px] text-foreground-muted">{c.brandName}</Text> : null}
          {specs.map(s => (
            <View key={s} className="rounded border border-border-default bg-surface-secondary px-1.5 py-0.5">
              <Text className="text-[10px] text-foreground-muted">{s}</Text>
            </View>
          ))}
        </View>
      </View>
      <View className="min-w-[80px] shrink-0 items-end">
        <Text className="text-sm font-bold text-foreground">₹{inr(c.displayPrice)}</Text>
        {mrp && mrp > c.displayPrice ? <Text className="text-[10px] text-foreground-muted line-through">₹{inr(mrp)}</Text> : null}
      </View>
      <View className="w-10 shrink-0 items-center">
        {off > 0 ? <Text className="text-xs font-semibold text-accent-600 dark:text-accent-400">-{off}%</Text> : null}
      </View>
      <View className="shrink-0">
        <StockBadge effectiveStock={c.effectiveStock} stockStatus={c.stockStatus ?? ''} />
      </View>
      <ChevronRightIcon size={14} color={t.foregroundMuted} />
    </Pressable>
  )
}

export default function ProductTable({ products }: { products: ListingCard[] }) {
  const head = 'text-[10px] font-semibold uppercase text-foreground-muted'
  return (
    <View className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
      <View className="flex-row items-center gap-3 border-b border-border-default bg-surface-secondary px-4 py-2.5">
        <View className="w-10 shrink-0" />
        <Text className={`flex-1 ${head}`} style={{ letterSpacing: 0.5 }}>
          Product
        </Text>
        <Text className={`min-w-[80px] shrink-0 text-right ${head}`} style={{ letterSpacing: 0.5 }}>
          Price
        </Text>
        <Text className={`w-10 shrink-0 text-center ${head}`} style={{ letterSpacing: 0.5 }}>
          Off
        </Text>
        <Text className={`shrink-0 ${head}`} style={{ letterSpacing: 0.5 }}>
          Stock
        </Text>
        <View className="w-3.5 shrink-0" />
      </View>
      {products.map((p, i) => (
        <TableRow key={p.id} product={p} stripe={i % 2 !== 0} last={i === products.length - 1} />
      ))}
    </View>
  )
}
