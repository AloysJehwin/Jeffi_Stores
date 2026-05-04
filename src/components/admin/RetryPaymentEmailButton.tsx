'use client'

import { useState } from 'react'

export default function RetryPaymentEmailButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

  async function handleClick() {
    setState('loading')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/retry-email`, { method: 'POST' })
      setState(res.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <span className="px-4 py-2 text-sm font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
        Email sent
      </span>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === 'loading'}
      className="px-4 py-2 text-sm font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {state === 'loading' ? 'Sending…' : state === 'error' ? 'Retry failed — try again' : 'Send re-order email'}
    </button>
  )
}
