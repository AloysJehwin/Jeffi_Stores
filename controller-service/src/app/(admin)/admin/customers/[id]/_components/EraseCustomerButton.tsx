'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { usePrompt } from '@/contexts/ConfirmContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'

// Erases the account on the customer's emailed request (/legal/account-deletion). Same as self-service.
export default function EraseCustomerButton({
  customerId,
  customerName,
}: {
  customerId: string
  customerName: string
}) {
  const { showToast } = useToast()
  const prompt = usePrompt()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function erase() {
    setBusy(true)
    try {
      const check = await fetch(`/api/admin/customers/${customerId}/erase`).then(r => r.json())
      if (check.blockers?.length) {
        showToast(check.blockers.map((b: { message: string }) => b.message).join(' '), 'error')
        return
      }
      const typed = await prompt({
        title: `Erase ${customerName}?`,
        message: `Deletes this customer's profile, addresses, cart, wishlist, reviews, points, referrals, notes and logs, and signs them out. ${check.retainedOrders || 0} order(s) stay for GST without email or phone. Type DELETE to confirm.`,
        placeholder: 'DELETE',
        confirmLabel: 'Erase customer',
      })
      if (typed !== 'DELETE') return
      const res = await fetch(`/api/admin/customers/${customerId}/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE', reason: 'Customer request' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Could not erase this customer', 'error')
        return
      }
      showToast('Customer data erased', 'success')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <RequireWrite scope="customers:write">
      <button
        onClick={erase}
        disabled={busy}
        className="mt-3 px-4 h-control rounded-lg border border-red-500/40 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
      >
        {busy ? 'Checking…' : 'Erase customer data'}
      </button>
    </RequireWrite>
  )
}
