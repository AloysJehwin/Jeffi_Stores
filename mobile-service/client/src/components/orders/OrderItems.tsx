import { Linking, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ImageOff } from 'lucide-react-native'
import WarningBadges from '../cart/WarningBadges'
import { useTokens } from '../../theme'
import { Badge, Card, Caption, cn, Divider, Heading, Text } from '../../ui'
import { inrCur, thumbOf, unitText, type Order, type OrderItem } from './shared'

function Item({ item }: { item: OrderItem }) {
  const router = useRouter()
  const t = useTokens()
  const thumb = thumbOf(item)
  const isFractional = (item.buyMode && item.buyMode !== 'unit') || (item.buyUnit && item.buyUnit !== 'unit')
  const unitLabel = item.buyUnit && item.buyUnit !== 'unit' ? item.buyUnit : item.buyMode && item.buyMode !== 'unit' ? item.buyMode : null
  const qtyDisplay = isFractional ? Number(Number(item.quantity).toFixed(6)).toString() : String(Math.round(Number(item.quantity)))
  const u = unitText(unitLabel)
  return (
    <View className="flex-row gap-4">
      <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-surface">
        {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <ImageOff size={28} color={t.foregroundMuted} />}
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-foreground" onPress={item.products?.slug ? () => router.push(`/product/${item.products!.slug}`) : undefined}>
          {item.productName}
        </Text>
        {(!!item.variantName || !!item.subVariantName) && (
          <View className="mt-1 flex-row flex-wrap gap-1">
            {!!item.variantName && <Badge label={item.variantName} tone="accent" size="sm" />}
            {!!item.subVariantName && <Badge label={item.subVariantName} size="sm" />}
          </View>
        )}
        <WarningBadges fragile={item.products?.fragile} hazardous={item.products?.hazardous} flammable={item.products?.flammable} size="xs" />
        {item.isDigital && (
          <Text className="mt-1 text-xs">
            {item.accessGranted ? (
              <Text className="font-medium text-green-700 dark:text-green-400">
                Access granted
                {!!item.vaultUrl && (
                  <>
                    {' · '}
                    <Text className="underline" onPress={() => Linking.openURL(item.vaultUrl!)}>
                      Open in vault
                    </Text>
                  </>
                )}
              </Text>
            ) : item.accessRevoked ? (
              <Text className="font-medium text-red-600 dark:text-red-400">Access revoked</Text>
            ) : (
              <Text className="text-foreground-muted">Digital item · access on payment</Text>
            )}
          </Text>
        )}
        <Text className="mt-1 text-sm text-foreground-secondary">
          Quantity: {qtyDisplay}
          {u ? ` ${u}` : ''}
        </Text>
        <Text className="mt-1 text-sm font-semibold text-foreground">
          {inrCur(item.unitPrice)}
          {u ? ` / ${u}` : ''} x {qtyDisplay}
          {u ? ` ${u}` : ''} = {inrCur(item.totalPrice)}
        </Text>
      </View>
    </View>
  )
}

function Line({ label, value, tone = 'secondary' }: { label: string; value: string; tone?: 'secondary' | 'muted' | 'success' }) {
  const colour = tone === 'success' ? 'font-medium text-green-600 dark:text-green-400' : tone === 'muted' ? 'text-foreground-muted' : 'text-foreground-secondary'
  return (
    <View className="flex-row justify-between">
      <Text className={cn('text-sm', colour)}>{label}</Text>
      <Text className={cn('text-sm', colour)}>{value}</Text>
    </View>
  )
}

/** The order's line items and its totals. */
export default function OrderItems({ order }: { order: Order }) {
  return (
    <Card>
      <Heading className="mb-4">
        Order Items ({order.items.length} {order.items.length === 1 ? 'item' : 'items'})
      </Heading>
      <View className="gap-4">
        {order.items.map((item, idx) => (
          <View key={item.id} className="gap-4">
            {idx > 0 ? <Divider /> : null}
            <Item item={item} />
          </View>
        ))}
      </View>
      <Divider className="mb-4 mt-5" />
      <View className="gap-2">
        <Line label="Subtotal" value={inrCur(order.subtotal)} />
        {order.taxAmount > 0 && <Line label="Incl. GST" value={inrCur(order.taxAmount)} tone="muted" />}
        {order.discountAmount > 0 && <Line label="Discount" value={`−${inrCur(order.discountAmount)}`} tone="success" />}
        {order.shippingAmount > 0 && <Line label="Delivery" value={inrCur(order.shippingAmount)} />}
        {(order.codFeeAmount ?? 0) > 0 && <Line label="COD handling fee" value={inrCur(order.codFeeAmount ?? 0)} />}
        <View className="flex-row items-center justify-between pt-2">
          <Text className="text-lg font-bold text-foreground">Total</Text>
          <Text className="font-display text-2xl font-extrabold text-primary-600 dark:text-primary-400">{inrCur(order.totalAmount)}</Text>
        </View>
        {order.taxAmount > 0 && <Caption>Price inclusive of all taxes</Caption>}
      </View>
    </Card>
  )
}
