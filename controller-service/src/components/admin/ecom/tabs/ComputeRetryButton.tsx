'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'

// Restarts a failed compute change from the step it stopped at.
export default function ComputeRetryButton({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const toast = useActionToast()
  const [busy, setBusy] = useState(false)
  const canWrite = useCanWrite('ecom_customers')

  const retry = async () => {
    setBusy(true)
    const res = await fetch(`/api/admin/ecom/${tenantId}/compute`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry' }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(false)
    toast.result(res?.ok ? { ok: true, text: 'Retrying on the next worker tick.' } : { ok: false, text: data?.error || 'Could not retry' })
    if (res?.ok) router.refresh()
  }

  if (!canWrite) return null
  return (
    <button
      type="button"
      onClick={retry}
      disabled={busy}
      className="ml-2 px-3 h-control rounded-lg border border-border-default text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50 transition-colors"
    >
      {busy ? 'Retrying…' : 'Retry'}
    </button>
  )
}
