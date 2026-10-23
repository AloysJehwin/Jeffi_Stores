'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { usePrompt } from '@/contexts/ConfirmContext'

// Self-service account deletion (Google Play requires it in-app and on the web). lib/account/delete-account.ts.
export default function DeleteAccountCard() {
  const { logout } = useAuth()
  const { showToast } = useToast()
  const prompt = usePrompt()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<string[]>([])

  async function start() {
    setBusy(true)
    try {
      const check = await fetch('/api/account/delete').then(r => r.json())
      const reasons: string[] = (check.blockers || []).map((b: { message: string }) => b.message)
      setBlocked(reasons)
      if (reasons.length) return
      const kept = check.retainedOrders
        ? ` Your ${check.retainedOrders} order${check.retainedOrders > 1 ? 's' : ''} and invoices stay on record for tax law, without your email or phone.`
        : ''
      const typed = await prompt({
        title: 'Delete your account?',
        message: `This permanently deletes your profile, saved addresses, cart, wishlist, reviews, loyalty points and referrals, and signs you out everywhere.${kept} Type DELETE to confirm.`,
        placeholder: 'DELETE',
        confirmLabel: 'Delete account',
      })
      if (typed !== 'DELETE') {
        if (typed) showToast('Type DELETE in capitals to confirm', 'error')
        return
      }
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.blockers) setBlocked(data.blockers.map((b: { message: string }) => b.message))
        showToast(data.error || 'Could not delete your account', 'error')
        return
      }
      showToast('Your account has been deleted', 'success')
      await logout()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground">Delete account</h2>
      <p className="mt-1 text-xs text-foreground-muted">
        Permanently remove your account and personal data.{' '}
        <Link href="/legal/account-deletion" className="text-accent-600 hover:text-accent-700 dark:text-accent-400">
          What gets deleted
        </Link>
      </p>
      {blocked.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {blocked.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <button
        onClick={start}
        disabled={busy}
        className="mt-3 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20"
      >
        {busy ? 'Checking…' : 'Delete my account'}
      </button>
    </div>
  )
}
