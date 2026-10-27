import { Pressable, View } from 'react-native'
import { Badge, Stepper, Text, TextButton } from '../../ui'
import { useRouter } from 'expo-router'
import type { CartLine } from '../../api/cart'
import LineThumb from './LineThumb'
import WarningBadges from './WarningBadges'
import { BrandChip, SkuText, VariantChips } from './Chips'
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
  businessPct = 0,
}: {
  item: CartLine
  /** A business account's discount for this line's category, in percent. */
  businessPct?: number
  updating: boolean
  last: boolean
  onQuantity: (qty: number) => void
  onSave: () => void
  onRemove: () => void
}) {
  const router = useRouter()
  const img = primaryImage(item)
  const custom = isCustomQty(item)
  const factor = unitFactor(item)
  const unitPrice = inclusiveUnit(item)
  const biz = custom ? 0 : businessPct
  const listPrice = custom ? Number(item.price_at_addition) : unitPrice * factor
  const price = biz > 0 ? listPrice * (1 - biz / 100) : listPrice
  const rawMrp = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
  // The business price strikes through the regular one when there's no higher MRP.
  const mrp = biz > 0 && !(rawMrp != null && Number(rawMrp) * factor > listPrice) ? unitPrice : rawMrp
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
        <Pressable onPress={openProduct} accessible={false} importantForAccessibility="no-hide-descendants">
          <LineThumb uri={img?.thumbnail_url || img?.image_url} blurhash={img?.blurhash} size={96} iconSize={48} />
        </Pressable>

        <View className="flex-1">
          <Pressable onPress={openProduct} accessibilityRole="link">
            <Text className="text-base font-semibold text-foreground">{item.products.name}</Text>
          </Pressable>
          <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
            {item.products.brand_name ? <BrandChip name={item.products.brand_name} /> : null}
            {sku ? <SkuText sku={sku} /> : null}
            {inactive ? <Badge label="Unavailable" tone="danger" /> : null}
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
            {!custom && factor > 1 ? <Text className="text-xs text-foreground-muted">{money(price / factor)}/pc</Text> : null}
            {biz > 0 ? <Badge label="Business price" tone="brand" /> : null}
            {showMrp ? (
              <>
                <Text className="text-sm text-foreground-muted line-through">{money(Number(mrp) * factor)}</Text>
                <Badge label={`${discountPct}% off`} tone="accent" />
              </>
            ) : null}
          </View>

          <View className="mt-4">
            <View className="flex-row flex-wrap items-center gap-3">
              {digital ? (
                <Text className="text-sm text-foreground-secondary">Qty 1 · Digital</Text>
              ) : custom ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Stepper
                    inputKey={`${item.id}:${qty}`}
                    defaultValue={qtyText(qty)}
                    decimal
                    disabled={updating}
                    itemName={item.products.name}
                    width={72}
                    onEndEditing={e => commit(e.nativeEvent.text)}
                  />
                  <Text className="text-sm text-foreground-muted">{unitText(unitLabel || item.buy_unit)}</Text>
                  <Text className="text-xs text-foreground-muted">
                    @ ₹{inr(item.price_at_addition)}/{'\u2009'}{unitText(unitLabel || item.buy_unit)}
                  </Text>
                </View>
              ) : (
                <Stepper
                  inputKey={`${item.id}:${qty}`}
                  defaultValue={String(Math.round(qty))}
                  busy={updating}
                  itemName={item.products.name}
                  onEndEditing={e => commit(e.nativeEvent.text)}
                  onDecrement={() => onQuantity(qty - qtyStep)}
                  onIncrement={() => onQuantity(qty + qtyStep)}
                  canDecrement={qty > qtyMin}
                  canIncrement={!(qtyMax !== undefined && qty >= qtyMax)}
                />
              )}

              {!custom && showUnitLabel ? <Text className="text-sm text-foreground-muted">{unitText(unitLabel)}</Text> : null}

              <TextButton label="Save for later" tone="muted" accessibilityLabel={`Save ${item.products.name} for later`} onPress={onSave} className="self-center" />
              <TextButton label="Remove" tone="danger" accessibilityLabel={`Remove ${item.products.name} from cart`} onPress={onRemove} className="self-center" />
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
