import { View } from 'react-native'
import { Calendar, Truck, Undo2 } from 'lucide-react-native'
import OrderTracking from '../account/OrderTracking'
import { useTokens } from '../../theme'
import { Card, Caption, cn, Divider, Heading, Text, type IconComponent } from '../../ui'
import { getEddDisplay, resolveOrderEdd, type Order } from './shared'

function IconTile({ icon: Icon }: { icon: IconComponent }) {
  const t = useTokens()
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent-50 dark:bg-accent-900/30">
      <Icon size={20} color={t.accent600} />
    </View>
  )
}

/** "Arriving Tomorrow", "Expected by …", "Delivered". */
export function DeliveryEstimate({ order }: { order: Order }) {
  if (['cancelled', 'returned'].includes(order.status) || order.isAllDigital) return null
  const edd = resolveOrderEdd(order)
  if (!edd) return null
  const { label, sub, color } = getEddDisplay(order, edd)
  return (
    <Card className="flex-row items-center gap-3">
      <IconTile icon={Calendar} />
      <View>
        <Text className={cn('text-[15px] font-semibold', color)}>{label}</Text>
        <Caption>{sub}</Caption>
      </View>
    </Card>
  )
}

/** The courier timeline for the order (or its return pickup). */
export function TrackingCard({ orderId, reverse }: { orderId: string; reverse?: boolean }) {
  return (
    <Card padded={false}>
      <View className="flex-row items-center gap-3 px-4 py-3">
        <IconTile icon={reverse ? Undo2 : Truck} />
        <Heading>{reverse ? 'Return Shipment Tracking' : 'Shipment Tracking'}</Heading>
      </View>
      <Divider />
      <View className="p-4">
        <OrderTracking orderId={orderId} trackPath={reverse ? 'track-rvp' : undefined} />
      </View>
    </Card>
  )
}
