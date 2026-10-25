import { View } from 'react-native'
import { Text } from '../../ui'
import type { BuyNowIntent, CartLine } from '../../api/cart'
import LineThumb from '../cart/LineThumb'
import WarningBadges from '../cart/WarningBadges'
import { BrandChip, SkuText, VariantChips } from '../cart/Chips'
import { exGstUnit, inclusiveUnit, lineSku, money, pickUnitPrice, primaryImage, qtyText, unitText } from '../cart/lines'

// The "Order Items" rows of the web's CheckoutReviewPage (components/shared/CheckoutReviewPage.tsx).

const offPct = (mrp: number, price: number) => (mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0)

function PriceLine({ price, perUnit, qty, mrp }: { price: number; perUnit: string; qty: string; mrp: number | null }) {
  const showMrp = mrp !== null && mrp > price
  return (
    <Text className="text-sm text-foreground-secondary">
      {money(price)}
      {perUnit ? ` / ${perUnit}` : ''} × {qty}
      {showMrp ? (
        <>
          {' '}
          <Text className="text-foreground-muted line-through">{money(mrp)}</Text>{' '}
          <Text className="font-semibold text-accent-600 dark:text-accent-400">{offPct(mrp!, price)}% off</Text>
        </>
      ) : null}
    </Text>
  )
}

export function CartReviewRow({ item, gstEnabled, last }: { item: CartLine; gstEnabled: boolean; last: boolean }) {
  const img = primaryImage(item)
  const custom = !!item.buy_mode && item.buy_mode !== 'unit'
  const price = !gstEnabled
    ? pickUnitPrice(inclusiveUnit(item), exGstUnit(item), false)
    : custom
      ? Number(item.price_at_addition)
      : inclusiveUnit(item)
  const qty = Number(item.quantity)
  const effectiveQty = custom ? qty : Math.round(qty)
  const itemTotal = price * effectiveQty
  const mrpRaw = item.sub_variant?.mrp ?? item.variant?.mrp ?? item.products.mrp ?? null
  const mrp = mrpRaw == null ? null : Number(mrpRaw)
  const sku = lineSku(item)
  const gstRate = Number(item.products.gst_percentage || 0)
  const itemGst = gstRate > 0 ? itemTotal - itemTotal / (1 + gstRate / 100) : 0
  const unitLabel = item.cart_item_unit?.display_label ?? item.cart_item_unit?.unit ?? item.buy_unit ?? null
  const showUnitLabel = !!item.buy_unit && item.buy_unit !== 'unit'
  const perUnit = custom ? unitText(unitLabel ?? item.buy_unit) : showUnitLabel ? unitText(unitLabel) : ''
  const qtyLabel = custom
    ? `${qtyText(qty)}${unitLabel || item.buy_unit ? ` ${unitText(unitLabel ?? item.buy_unit)}` : ''}`
    : `${effectiveQty}${showUnitLabel ? ` ${unitText(unitLabel)}` : ''}`

  return (
    <View className={`flex-row gap-4 pb-4 ${last ? '' : 'border-b border-border-default'}`}>
      <LineThumb uri={img?.thumbnail_url || img?.image_url} blurhash={img?.blurhash} size={80} iconSize={40} />
      <View className="flex-1">
        <Text className="font-semibold text-foreground">{item.products.name}</Text>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
          {item.products.brand_name ? <BrandChip name={item.products.brand_name} small /> : null}
          {sku ? <SkuText sku={sku} small /> : null}
          <WarningBadges fragile={item.products?.fragile} hazardous={item.products?.hazardous} flammable={item.products?.flammable} size="xs" />
        </View>
        <VariantChips variant={item.variant?.variant_name} subVariant={item.sub_variant?.sub_variant_name} />
        <View className="mt-2">
          <PriceLine price={price} perUnit={perUnit} qty={qtyLabel} mrp={mrp} />
          <Text className="mt-0.5 text-sm font-semibold text-foreground">{money(itemTotal)}</Text>
        </View>
        {gstRate > 0 ? (
          <Text className="mt-0.5 text-[11px] text-foreground-muted">
            incl. {money(itemGst)} GST @ {gstRate}%
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export function BuyNowReviewRow({ item, imageUrl, gstEnabled }: { item: BuyNowIntent; imageUrl: string | null; gstEnabled: boolean }) {
  const fractional = (!!item.buyMode && item.buyMode !== 'unit') || (!!item.buyUnit && item.buyUnit !== 'unit')
  const effectiveQty = fractional ? item.qty : Math.round(item.qty)
  const lineTotal = item.price * effectiveQty
  const displayUnit = item.buyUnit && item.buyUnit !== 'unit' ? item.buyUnit : item.buyMode !== 'unit' ? item.buyMode : null
  const qtyLabel = fractional ? `${qtyText(item.qty)}${displayUnit ? ` ${unitText(displayUnit)}` : ''}` : String(effectiveQty)
  const gst =
    gstEnabled && item.gstPercentage != null && item.gstPercentage > 0
      ? lineTotal - lineTotal / (1 + item.gstPercentage / 100)
      : null

  return (
    <View className="flex-row gap-4 pb-4">
      <LineThumb uri={imageUrl} size={80} iconSize={40} />
      <View className="flex-1">
        <Text className="font-semibold text-foreground">{item.productName}</Text>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
          {item.brandName ? <BrandChip name={item.brandName} small /> : null}
          {item.sku ? <SkuText sku={item.sku} small /> : null}
        </View>
        <VariantChips variant={item.variantName} subVariant={item.subVariantName} />
        <View className="mt-2">
          <PriceLine price={item.price} perUnit="" qty={qtyLabel} mrp={item.mrp} />
          <Text className="mt-0.5 text-sm font-semibold text-foreground">{money(lineTotal)}</Text>
        </View>
        {gst != null ? (
          <Text className="mt-0.5 text-[11px] text-foreground-muted">
            incl. ₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 3 })} GST @ {item.gstPercentage}%
          </Text>
        ) : null}
      </View>
    </View>
  )
}

