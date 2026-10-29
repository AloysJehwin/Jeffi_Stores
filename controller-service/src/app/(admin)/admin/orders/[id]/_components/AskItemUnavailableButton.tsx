'use client'

import { useState } from 'react'
import { Check, Loader2, PackageX } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useActionToast } from '@/components/admin/kit/toast'

/** Email the customer that one item is unavailable; their reply (refund, alternative, wait) comes back to the order. */
export default function AskItemUnavailableButton({ orderId, itemId, itemName }: { orderId: string; itemId: string; itemName: string }) {
  const confirm = useConfirm()
  const toast = useActionToast()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  async function ask() {
    const ok = await confirm({
      title: 'Item unavailable',
      message: `Email the customer that ${itemName} is out of stock and ask whether they want a refund, an alternative or to wait? Their reply will show under Customer replies.`,
      confirmLabel: 'Send',
    })
    if (!ok) return
    setState('sending')
    const res = await fetch(`/api/admin/orders/${orderId}/items/${itemId}/ask-unavailable`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (res?.ok) {
      setState('sent')
      toast.success('Asked the customer.')
    } else {
      setState('idle')
      toast.error(data?.error || 'Could not send the email.')
    }
  }

  const label = state === 'sent' ? 'Customer asked' : 'Item unavailable: ask the customer'
  return (
    <RequireWrite scope="orders:write">
      <button
        type="button"
        onClick={ask}
        disabled={state !== 'idle'}
        title={label}
        aria-label={label}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-secondary hover:text-foreground disabled:pointer-events-none"
      >
        {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'sent' ? <Check className="h-4 w-4 text-green-600" /> : <PackageX className="h-4 w-4" />}
      </button>
    </RequireWrite>
  )
}
