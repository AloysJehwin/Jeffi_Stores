'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Mail } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { Badge } from '@/components/admin/kit/core'

export default function RetryPaymentEmailButton({ orderId }: { orderId: string }) {
  const toast = useActionToast()
  const [state, setState] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

  async function handleClick() {
    setState('loading')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/retry-email`, { method: 'POST' })
      setState(res.ok ? 'sent' : 'error')
      if (res.ok) toast.success('Re-order email sent.')
      else toast.error('Could not send the re-order email.')
    } catch {
      setState('error')
      toast.error('Could not send the re-order email.')
    }
  }

  if (state === 'sent') {
    return (
      <Badge tone="green">Email sent</Badge>
    )
  }

  return (
    <RequireWrite scope="orders:write">
      <button
        onClick={handleClick}
        disabled={state === 'loading'}
        className="control-md border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
      >
        <Mail className="h-4 w-4" />
        {state === 'loading' ? 'Sending…' : state === 'error' ? 'Retry failed — try again' : 'Send re-order email'}
      </button>
    </RequireWrite>
  )
}
