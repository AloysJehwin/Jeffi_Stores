'use client'

import { useState } from 'react'
import { Check, Loader2, PackageX } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useActionToast } from '@/components/admin/kit/toast'

const CHANNELS: Record<string, string> = { email: 'email', whatsapp: 'WhatsApp' }

/** Ask the customer, by email and WhatsApp, what to do about one unavailable item; their reply (refund, alternative, wait) comes back to the order. */
export default function AskItemUnavailableButton({ orderId, itemId, itemName }: { orderId: string; itemId: string; itemName: string }) {
  const confirm = useConfirm()
  const toast = useActionToast()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  async function ask() {
    const ok = await confirm({
      title: 'Item unavailable',
      message: `Tell the customer by email and WhatsApp that ${itemName} is out of stock, and ask whether they want a refund, an alternative or to wait? Their reply will show under Customer replies.`,
      confirmLabel: 'Send',
    })
    if (!ok) return
    setState('sending')
    const res = await fetch(`/api/admin/orders/${orderId}/items/${itemId}/ask-unavailable`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (res?.ok) {
      setState('sent')
      const by = (data?.channels as string[] | undefined)?.map(c => CHANNELS[c] ?? c).join(' and ')
      toast.success(by ? `Asked the customer by ${by}.` : 'Asked the customer.')
    } else {
      setState('idle')
      toast.error(data?.error || 'Could not ask the customer.')
    }
  }

  const label = state === 'sent' ? 'Customer asked' : 'Unavailable: ask the customer'
  const icon = state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'sent' ? <Check className="h-4 w-4 text-green-600" /> : <PackageX className="h-4 w-4" />
  return (
    <RequireWrite scope="orders:write">
      <button
        type="button"
        onClick={ask}
        disabled={state !== 'idle'}
        className="inline-flex h-control-sm items-center gap-1.5 rounded-md border border-border-default px-2.5 text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:pointer-events-none disabled:opacity-70"
      >
        {icon}
        {label}
      </button>
    </RequireWrite>
  )
}
