'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'

interface QuoteItem {
  productId?: string
  variantId?: string
  description: string
  quantity: number
  unit?: string
}

interface Props {
  items: QuoteItem[]
  className?: string
  label?: string
}

export default function RequestQuoteButton({ items, className, label = 'Request Quote' }: Props) {
  const { user } = useAuth()
  const { showToast, showConfirm } = useToast()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (!user?.isBusiness || user.approvalStatus !== 'approved') return null

  async function handleRequestQuote() {
    if (items.length === 0) {
      showToast('No items to quote', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/business/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to submit quote request', 'error')
        return
      }
      showToast(`Quote request ${data.rfq?.rfq_number} submitted! Our team will get back to you.`, 'success')
      router.push('/account/quotes')
    } catch {
      showToast('Failed to submit quote request', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleRequestQuote}
      disabled={loading}
      className={className || 'w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg border-2 border-accent-500 text-accent-600 dark:text-accent-400 font-semibold text-sm hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors disabled:opacity-60'}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
      </svg>
      {loading ? 'Submitting…' : label}
    </button>
  )
}
