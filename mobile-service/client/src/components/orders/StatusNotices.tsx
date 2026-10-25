import { useRouter } from 'expo-router'
import { CircleCheck, CircleX, Clock, Info, PackageCheck } from 'lucide-react-native'
import { Notice, Text } from '../../ui'
import { inrPlain, type Order, type RefundBreakdown, type ReturnRequest } from './shared'

/** The cancellation and return status notes for the order's current status. */
export function StatusNotices({ order, returnRequest, refundBreakdown }: { order: Order; returnRequest: ReturnRequest | null; refundBreakdown: RefundBreakdown }) {
  const router = useRouter()
  switch (order.status) {
    case 'cancel_requested':
      return (
        <Notice tone="warning" icon={Clock}>
          Your cancellation request is pending review by our team. You will receive an email once it is approved or rejected.
        </Notice>
      )
    case 'return_requested':
      return (
        <Notice tone="warning" icon={Clock}>
          Return request submitted — awaiting admin review.
        </Notice>
      )
    case 'return_approved':
      return (
        <Notice icon={Info} title="Return Approved">
          Please ship the item back. A team member will contact you with return shipping instructions.
        </Notice>
      )
    case 'return_received':
      return (
        <Notice icon={PackageCheck}>{`Item received — processing your ${returnRequest?.type === 'replacement' ? 'replacement order' : 'refund'}.`}</Notice>
      )
    case 'return_rejected':
      return (
        <Notice tone="danger" icon={CircleX} title="Return Request Rejected">
          {returnRequest?.admin_notes || undefined}
        </Notice>
      )
    case 'returned':
      return (
        <Notice tone="success" icon={CircleCheck} title="Resolved">
          {returnRequest?.type === 'replacement' && returnRequest.replacement_order_id ? (
            <Text className="mt-0.5 text-sm leading-5 text-green-800 dark:text-green-300">
              Your replacement order{' '}
              <Text accessibilityRole="link" className="font-semibold underline" onPress={() => router.push(`/orders/${returnRequest.replacement_order_id}`)}>
                #{returnRequest.replacement_order_number || returnRequest.replacement_order_id.slice(0, 8)}
              </Text>{' '}
              has been created and confirmed.
            </Text>
          ) : refundBreakdown && refundBreakdown.netRefund <= 0 && refundBreakdown.charge > 0 ? (
            `Your return has been accepted. A ₹${inrPlain(refundBreakdown.charge)} return handling charge applied to the ₹${inrPlain(refundBreakdown.grossRefund)} returnable amount, so no amount was refunded for this return.`
          ) : refundBreakdown && refundBreakdown.charge > 0 ? (
            `Your refund of ₹${inrPlain(refundBreakdown.netRefund)} has been processed (₹${inrPlain(refundBreakdown.grossRefund)} less a ₹${inrPlain(refundBreakdown.charge)} return handling charge). It may take 5–7 business days to reflect in your account.`
          ) : (
            'Your refund has been processed. It may take 5–7 business days to reflect in your account.'
          )}
        </Notice>
      )
    default:
      return null
  }
}
