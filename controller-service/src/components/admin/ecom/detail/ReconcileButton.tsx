'use client'

import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'

/** Settles captured transactions whose Route transfer already went through at Razorpay. */
export default function ReconcileButton({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const toast = useActionToast()

  async function run() {
    const res = await fetch(`/api/admin/ecom/${tenantId}/reconcile-settlements`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Reconcile failed')
    toast.success(`Settled ${data.settled} of ${data.scanned}`)
    router.refresh()
  }

  return <ActionButton action={{ label: 'Reconcile now', icon: RefreshCw, onClick: run }} />
}
