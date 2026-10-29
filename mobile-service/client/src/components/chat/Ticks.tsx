import { View } from 'react-native'
import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react-native'
import type { MessageStatus } from '../../types/support'

const LABEL: Record<MessageStatus, string> = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Seen', failed: 'Not sent' }
const READ = '#1d4ed8'
const FAILED = '#dc2626'

/** WhatsApp-style receipt: clock while sending, ✓ sent, ✓✓ delivered, blue ✓✓ seen, ! failed. */
export default function Ticks({ status, color }: { status: MessageStatus; color: string }) {
  const Icon = status === 'sending' ? Clock : status === 'sent' ? Check : status === 'failed' ? CircleAlert : CheckCheck
  const c = status === 'read' ? READ : status === 'failed' ? FAILED : color
  return (
    <View accessible accessibilityLabel={LABEL[status]}>
      <Icon size={14} color={c} strokeWidth={status === 'read' ? 2.6 : 2.2} />
    </View>
  )
}
