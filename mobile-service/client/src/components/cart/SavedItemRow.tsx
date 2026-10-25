import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { useRouter } from 'expo-router'
import type { CartLine } from '../../api/cart'
import LineThumb from './LineThumb'
import { BrandChip, SkuText, VariantChips } from './Chips'
import { isCustomQty, lineSku, money, primaryImage, unitText } from './lines'

// A "Saved for later" row of the web's cart page.
export default function SavedItemRow({
  item,
  updating,
  last,
  onMove,
  onRemove,
}: {
  item: CartLine
  updating: boolean
  last: boolean
  onMove: () => void
  onRemove: () => void
}) {
  const router = useRouter()
  const img = primaryImage(item)
  const custom = isCustomQty(item)
  const price = custom ? item.price_at_addition : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
  const sku = lineSku(item)
  const openProduct = () => router.push(`/product/${item.products.slug}`)

  return (
    <View className={`flex-row gap-4 p-4 ${last ? '' : 'border-b border-border-default'}`}>
      <Pressable onPress={openProduct}>
        <LineThumb uri={img?.thumbnail_url || img?.image_url} blurhash={img?.blurhash} size={80} iconSize={32} />
      </Pressable>
      <View className="min-w-0 flex-1">
        <Pressable onPress={openProduct}>
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {item.products.name}
          </Text>
        </Pressable>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
          {item.products.brand_name ? <BrandChip name={item.products.brand_name} small /> : null}
          {sku ? <SkuText sku={sku} small /> : null}
        </View>
        <VariantChips variant={item.variant?.variant_name} subVariant={item.sub_variant?.sub_variant_name} />
        <Text className="mt-1 text-sm font-bold text-primary-600 dark:text-primary-400">
          {money(price)}
          {custom ? `/\u2009${unitText(item.cart_item_unit?.display_label ?? item.buy_unit ?? '')}` : ''}
        </Text>
        <View className="mt-2 flex-row items-center gap-3">
          <Pressable onPress={onMove} disabled={updating} className="disabled:opacity-50">
            <Text className="text-sm font-medium text-accent-600 dark:text-accent-400">Move to cart</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            disabled={updating}
            accessibilityLabel={`Remove ${item.products.name} from cart`}
            className="disabled:opacity-50"
          >
            <Text className="text-sm font-medium text-red-600">Remove</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
