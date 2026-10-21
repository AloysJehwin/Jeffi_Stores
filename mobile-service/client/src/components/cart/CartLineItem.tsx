import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Minus, Plus } from 'lucide-react-native'
import type { CartLine } from '../../api/cart'
import LineThumb from './LineThumb'
import WarningBadges from './WarningBadges'
import { BrandChip, SkuText, VariantChips } from './Chips'
import { accent, useTokens } from '../../theme'
import { inr } from '../../lib/format'
import { inclusiveUnit, isCustomQty, isDigitalLine, lineSku, money, primaryImage, qtyText, unitFactor, unitText } from './lines'

// One active line of the web's cart page (controller-service app/(storefront)/cart/page.tsx) at the mobile breakpoint.
export default function CartLineItem({
  item,
  updating,
  last,
  onQuantity,
  onSave,
  onRemove,
}: {
  item: CartLine
  updating: boolean
  last: boolean
  onQuantity: (qty: number) => void
  onSave: () => void
  onRemove: () => void
}) {
  const router = useRouter()
  const t = useTokens()
  const img = primaryImage(item)
  const custom = isCustomQty(item)
  const factor = unitFactor(item)
  const unitPrice = inclusiveUnit(item)
  const price = custom ? Number(item.price_at_addition) : unitPrice * factor
  const mrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
  const inactive = item.products?.is_active === false
  const qty = Number(item.quantity)
  const itemTotal = custom ? Number(item.price_at_addition) * qty : price * Math.round(qty)
  const showMrp = !custom && mrp !== null && Number(mrp) * factor > price
  const discountPct = showMrp ? Math.round(((Number(mrp) * factor - price) / (Number(mrp) * factor)) * 100) : 0
  const sku = lineSku(item)
  const unitLabel = (item.cart_item_unit?.display_label ?? item.buy_unit) || ''
  const showUnitLabel = !!item.buy_unit && item.buy_unit !== 'unit'
  const digital = isDigitalLine(item)
  const qtyMin = Number(custom ? (item.cart_item_unit?.min_qty ?? 0.001) : (item.cart_item_unit?.min_qty ?? 1))
  const qtyMax = digital ? 1 : item.cart_item_unit?.max_qty != null ? Number(item.cart_item_unit.max_qty) : undefined
  const qtyStep = Number(custom ? (item.cart_item_unit?.qty_step ?? 0.001) : (item.cart_item_unit?.qty_step ?? 1))
  const openProduct = () => router.push(`/product/${item.products.slug}`)

  // Clamp to min / max / step the way the web's onBlur handler does.
  const commit = (raw: string) => {
    const val = custom ? parseFloat(raw) : parseInt(raw, 10)
    let safe = !isNaN(val) ? val : qtyMin
    safe = Math.round(safe / qtyStep) * qtyStep
    if (safe < qtyMin) safe = qtyMin
    if (qtyMax !== undefined && safe > qtyMax) safe = qtyMax
    safe = parseFloat(safe.toFixed(6))
    if (safe !== (custom ? qty : Math.round(qty))) onQuantity(safe)
  }

  const hint: string[] = []
  if (qtyMin > (custom ? 0 : 1)) hint.push(`Min: ${qtyMin}`)
  if (qtyMax != null) hint.push(`Max: ${qtyMax}`)
  if (qtyStep !== (custom ? 0.001 : 1)) hint.push(`Step: ${qtyStep}`)

  return (
    <View className={`p-4 ${last ? '' : 'border-b border-border-default'}`}>
      <View className="flex-row gap-4">
        <Pressable onPress={openProduct}>
          <LineThumb uri={img?.thumbnail_url || img?.image_url} blurhash={img?.blurhash} size={96} iconSize={48} />
        </Pressable>

        <View className="flex-1">
          <Pressable onPress={openProduct}>
            <Text className="text-base font-semibold text-foreground">{item.products.name}</Text>
          </Pressable>
          <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
            {item.products.brand_name ? <BrandChip name={item.products.brand_name} /> : null}
            {sku ? <SkuText sku={sku} /> : null}
            {inactive ? (
              <View className="rounded-full bg-red-100 px-2 py-0.5 dark:bg-red-900/30">
                <Text className="text-xs font-semibold text-red-700 dark:text-red-300">Unavailable</Text>
              </View>
            ) : null}
            <WarningBadges
              fragile={item.products?.fragile}
              hazardous={item.products?.hazardous}
              flammable={item.products?.flammable}
              size="xs"
            />
          </View>
          <VariantChips variant={item.variant?.variant_name} subVariant={item.sub_variant?.sub_variant_name} />

          <View className="mt-2 flex-row flex-wrap items-center gap-3">
            <Text className="text-lg font-bold text-primary-600 dark:text-primary-400">
              {money(price)}
              {custom ? `/\u2009${unitText(unitLabel || item.buy_unit)}` : showUnitLabel ? `/\u2009${unitText(unitLabel)}` : ''}
            </Text>
            {!custom && factor > 1 ? <Text className="text-xs text-foreground-muted">{money(unitPrice)}/pc</Text> : null}
            {showMrp ? (
              <>
                <Text className="text-sm text-foreground-muted line-through">{money(Number(mrp) * factor)}</Text>
                <View className="rounded-full bg-accent-100 px-2 py-0.5 dark:bg-accent-900/30">
                  <Text className="text-xs font-semibold text-accent-700 dark:text-accent-400">{discountPct}% off</Text>
                </View>
              </>
            ) : null}
          </View>

          <View className="mt-4">
            <View className="flex-row flex-wrap items-center gap-3">
              {digital ? (
                <Text className="text-sm text-foreground-secondary">Qty 1 · Digital</Text>
              ) : custom ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <TextInput
                    key={`${item.id}:${qty}`}
                    defaultValue={qtyText(qty)}
                    keyboardType="decimal-pad"
                    editable={!updating}
                    onEndEditing={e => commit(e.nativeEvent.text)}
                    className="w-24 rounded-lg border border-border-secondary bg-surface px-3 py-2 text-center text-sm font-semibold text-foreground disabled:opacity-50"
                  />
                  <Text className="text-sm text-foreground-muted">{unitText(unitLabel || item.buy_unit)}</Text>
                  <Text className="text-xs text-foreground-muted">
                    @ ₹{inr(item.price_at_addition)}/{'\u2009'}{unitText(unitLabel || item.buy_unit)}
                  </Text>
                </View>
              ) : (
                <View className="flex-row items-center rounded-lg border border-border-secondary">
                  <Pressable
                    onPress={() => onQuantity(qty - qtyStep)}
                    disabled={updating || qty <= qtyMin}
                    accessibilityLabel={`Decrease quantity for ${item.products.name}`}
                    className="px-3 py-2 disabled:opacity-50"
                  >
                    <Minus size={16} color={t.foreground} strokeWidth={2} />
                  </Pressable>
                  {updating ? (
                    <View className="min-w-[60px] items-center justify-center border-x border-border-secondary px-4 py-2">
                      <ActivityIndicator size="small" color={accent[500]} />
                    </View>
                  ) : (
                    <TextInput
                      key={`${item.id}:${qty}`}
                      defaultValue={String(Math.round(qty))}
                      keyboardType="number-pad"
                      onEndEditing={e => commit(e.nativeEvent.text)}
                      className="w-16 border-x border-border-secondary bg-surface px-1 py-2 text-center font-semibold text-foreground"
                    />
                  )}
                  <Pressable
                    onPress={() => onQuantity(qty + qtyStep)}
                    disabled={updating || (qtyMax !== undefined && qty >= qtyMax)}
                    accessibilityLabel={`Increase quantity for ${item.products.name}`}
                    className="px-3 py-2 disabled:opacity-50"
                  >
                    <Plus size={16} color={t.foreground} strokeWidth={2} />
                  </Pressable>
                </View>
              )}

              {!custom && showUnitLabel ? <Text className="text-sm text-foreground-muted">{unitText(unitLabel)}</Text> : null}

              <Pressable onPress={onSave} accessibilityLabel={`Save ${item.products.name} for later`}>
                <Text className="text-sm font-medium text-foreground-secondary">Save for later</Text>
              </Pressable>
              <Pressable onPress={onRemove} accessibilityLabel={`Remove ${item.products.name} from cart`}>
                <Text className="text-sm font-medium text-red-600">Remove</Text>
              </Pressable>
            </View>
            {hint.length > 0 ? (
              <Text className="mt-1 text-xs text-foreground-muted">
                {hint.join(' · ')}
                {unitLabel ? ` ${unitLabel}` : ''}
              </Text>
            ) : null}
          </View>

          <Text className="mt-4">
            <Text className="text-sm text-foreground-secondary">Subtotal: </Text>
            <Text className="text-lg font-bold text-foreground">{money(itemTotal)}</Text>
          </Text>
        </View>
      </View>
    </View>
  )
}
