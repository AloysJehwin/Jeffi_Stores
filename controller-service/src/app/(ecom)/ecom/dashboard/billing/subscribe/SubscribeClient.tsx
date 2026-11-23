'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

export default function SubscribeClient({ tenantSlug }: { tenantSlug: string }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      const res = await fetch(`/api/ecom/billing/subscribe?tenant=${encodeURIComponent(tenantSlug)}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.checkoutUrl) {
        showToast(data.error || 'Could not start the subscription. Please try again.', 'error')
        setBusy(false)
        return
      }
      showToast('Opening Razorpay to approve your subscription…', 'info')
      window.location.href = data.checkoutUrl
    } catch {
      showToast('Network error', 'error')
      setBusy(false)
    }
  }

  return (
    <button
      onClick={start}
      disabled={busy}
      className="px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? 'Opening Razorpay…' : 'Continue to Razorpay'}
    </button>
  )
}
