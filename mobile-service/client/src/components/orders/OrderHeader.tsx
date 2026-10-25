import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Clock, Eye, KeyRound, Undo2, X } from 'lucide-react-native'
import { orderStatusLabel } from '../account/ui'
import { Badge, BodySmall, Button, Card, statusTone, Text, Title } from '../../ui'
import { CANCELLABLE_STATUSES, type Order } from './shared'

const capitalWords = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase())

/** Order number, placed date, status and payment badges, and the order's actions. */
export default function OrderHeader({
  order,
  unpaidPending,
  returnLabel,
  showReturn,
  returnWindowExpired,
  limitReached,
  invoiceUrl,
  onCancel,
  onReturn,
}: {
  order: Order
  unpaidPending: boolean
  returnLabel: string
  showReturn: boolean
  returnWindowExpired: boolean
  limitReached: boolean
  invoiceUrl: string | null
  onCancel: () => void
  onReturn: () => void
}) {
  const router = useRouter()
  const cancellable = CANCELLABLE_STATUSES.includes(order.status) && !order.hasDigital
  const vault = order.hasDigital && !!order.vaultUrl
  const hasActions = cancellable || showReturn || vault || !!invoiceUrl
  return (
    <Card>
      <Title>Order #{order.orderNumber}</Title>
      {!!order.originalOrderId && !!order.originalOrderNumber && (
        <Text className="mt-0.5 text-sm text-foreground-secondary">
          Replacement for{' '}
          <Text accessibilityRole="link" className="font-semibold text-accent-600 underline dark:text-accent-400" onPress={() => router.push(`/orders/${order.originalOrderId}`)}>
            #{order.originalOrderNumber}
          </Text>
        </Text>
      )}
      <BodySmall className="mt-1">
        Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} at{' '}
        {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
      </BodySmall>

      <View className="mt-4 flex-row flex-wrap gap-2">
        <Badge label={order.status === 'returned' ? 'Returned' : orderStatusLabel(order.status)} tone={statusTone(order.status)} />
        <Badge label={`Payment: ${capitalWords(order.paymentStatus)}`} tone={statusTone(order.paymentStatus)} />
        {returnWindowExpired && <Badge label="Return window closed" icon={Clock} />}
        {limitReached && <Badge label="Monthly return limit reached" icon={Clock} tone="progress" />}
      </View>

      {hasActions && (
        <View className="mt-4 flex-row flex-wrap gap-2">
          {showReturn && <Button label={returnLabel} icon={Undo2} variant="outline" size="sm" block={false} onPress={onReturn} />}
          {!!invoiceUrl && <Button label="View Invoice" icon={Eye} variant="secondary" size="sm" block={false} onPress={() => Linking.openURL(invoiceUrl)} />}
          {vault && <Button label="Open my vault" icon={KeyRound} variant="secondary" size="sm" block={false} onPress={() => Linking.openURL(order.vaultUrl!)} />}
          {cancellable && <Button label={unpaidPending ? 'Cancel Order' : 'Request Cancellation'} icon={X} variant="destructive" size="sm" block={false} onPress={onCancel} />}
        </View>
      )}
    </Card>
  )
}
