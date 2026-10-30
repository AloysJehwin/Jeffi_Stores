'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit/toast'

export default function RetryRefundButton({ orderId, refundId, amount }: { orderId: string; refundId: string; amount: number }) {
  const toast = useActionToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function retry() {
    if (!confirm(`Refund Rs. ${amount.toFixed(2)} to the customer again?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refunds/${refundId}/retry`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not retry the refund.')
      toast.success('Refund sent again.')
      router.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <RequireWrite scope="orders:write">
      <button
        onClick={retry}
        disabled={busy}
        className="control-sm border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {busy ? 'Retrying…' : 'Retry refund'}
      </button>
    </RequireWrite>
  )
}
