import { View } from 'react-native'
import { Image } from 'expo-image'
import { CircleAlert, CircleCheck, Info, QrCode } from 'lucide-react-native'
import { Button, Notice, Text } from '../../ui'
import type { Order } from './shared'

/** Paid, waiting for payment (with the pay-by countdown) or failed, with the pay / retry button. */
export function PaymentNotices({
  order,
  razorpay,
  countdown,
  autoCancelling,
  paying,
  onPay,
  store,
}: {
  order: Order
  razorpay: boolean
  countdown: string | null
  autoCancelling: boolean
  paying: boolean
  onPay: () => void
  store: { phone?: string | null; email?: string | null }
}) {
  const notCancelled = order.status !== 'cancelled' && order.status !== 'cancel_requested'
  if (order.paymentStatus === 'paid') {
    return (
      <Notice tone="success" icon={CircleCheck}>
        Payment received. Thank you for your purchase!
      </Notice>
    )
  }
  if (!notCancelled) return null
  const expired = 'Time expired. Cancelling order and restoring items to your cart...'
  if (order.paymentStatus !== 'paid' && order.paymentMode === 'upi_qr' && order.razorpayQrImageUrl) {
    return (
      <Notice icon={QrCode}>
        <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">
          Scan this QR with any UPI app to pay ₹{order.totalAmount.toLocaleString('en-IN')}. This page updates once the payment arrives.
        </Text>
        <View className="mt-3 self-center rounded-xl bg-white p-2">
          <Image source={{ uri: order.razorpayQrImageUrl }} style={{ width: 220, height: 220 }} contentFit="contain" accessibilityLabel="UPI payment QR code" />
        </View>
      </Notice>
    )
  }
  if (order.paymentStatus === 'unpaid' && order.paymentMode !== 'cod' && razorpay) {
    // A business order placed for manual payment: the team follows up, or it can be paid online now.
    const manual = order.paymentMode === 'manual'
    return (
      <Notice icon={Info}>
        <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">
          {manual
            ? 'Our team will contact you with payment details for this order. You can also pay online now.'
            : 'Payment is pending for this order. Pay online to confirm your order instantly.'}
        </Text>
        {countdown && <Text className="mt-2 text-sm font-bold text-accent-900 dark:text-accent-100">Time remaining to pay: {countdown}</Text>}
        {autoCancelling ? (
          <Text className="mt-2 text-sm text-accent-800 dark:text-accent-200">{expired}</Text>
        ) : (
          <View className="mt-3">
            <Button label={`Pay ₹${order.totalAmount.toLocaleString('en-IN')}`} loadingLabel="Processing..." loading={paying} size="md" block={false} onPress={onPay} />
          </View>
        )}
      </Notice>
    )
  }
  if (order.paymentStatus === 'unpaid' && !razorpay) {
    const { phone, email } = store
    return (
      <Notice icon={Info}>
        {`Our team will contact you to confirm your order and provide payment details.${phone || email ? ' For queries, ' : ''}${phone ? `call ${phone}` : ''}${
          phone && email ? ' or ' : ''
        }${email ? `email ${email}` : ''}${phone || email ? '.' : ''}`}
      </Notice>
    )
  }
  if (order.paymentStatus === 'failed' && razorpay) {
    return (
      <Notice tone="danger" icon={CircleAlert}>
        <Text className="text-sm leading-5 text-red-700 dark:text-red-300">Payment failed for this order. Please retry to complete your purchase.</Text>
        {countdown && <Text className="mt-2 text-sm font-bold text-red-800 dark:text-red-200">Time remaining to pay: {countdown}</Text>}
        {autoCancelling ? (
          <Text className="mt-2 text-sm text-red-700 dark:text-red-300">{expired}</Text>
        ) : (
          <View className="mt-3">
            <Button label="Retry Payment" loadingLabel="Processing..." loading={paying} variant="destructive" size="md" block={false} onPress={onPay} />
          </View>
        )}
      </Notice>
    )
  }
  return null
}
