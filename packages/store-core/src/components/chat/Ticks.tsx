import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react'
import type { MessageStatus } from '@/lib/support/types'

const LABEL: Record<MessageStatus, string> = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Seen', failed: 'Not sent' }

/** WhatsApp-style receipt: clock while sending, ✓ sent, ✓✓ delivered, blue ✓✓ seen, ! failed. */
export default function Ticks({ status, className = '' }: { status: MessageStatus; className?: string }) {
  const c = `w-3.5 h-3.5 shrink-0 ${className}`
  const icon =
    status === 'sending' ? (
      <Clock className={c} />
    ) : status === 'sent' ? (
      <Check className={c} />
    ) : status === 'delivered' ? (
      <CheckCheck className={c} />
    ) : status === 'read' ? (
      <CheckCheck className={`${c} !text-sky-400`} />
    ) : (
      <CircleAlert className={`${c} !text-red-500`} />
    )
  return (
    <span title={LABEL[status]} aria-label={LABEL[status]} className="inline-flex">
      {icon}
    </span>
  )
}
