'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { usePrompt } from '@/contexts/ConfirmContext'

// Web self-service deletion (Google Play wants it in the app and on the web). It lives only at the bottom of
// /legal/account-deletion, an unlisted page, so it isn't a click away on My Account. lib/account/delete-account.ts.
export default function AccountDeletionPanel() {
  const { user, isLoading, logout } = useAuth()
  const { showToast } = useToast()
  const prompt = usePrompt()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<string[]>([])

  if (isLoading) return null

  if (!user) {
    return (
      <p className="px-1 text-xs text-foreground-muted">
        To delete your account on the website,{' '}
        <Link
          href="/login?redirect=%2Flegal%2Faccount-deletion"
          className="text-accent-600 hover:text-accent-700 dark:text-accent-400"
        >
          sign in
        </Link>{' '}
        and come back to this page.
      </p>
    )
  }

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
      router.replace('/')
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-1 text-xs text-foreground-muted">
      {blocked.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-amber-700 dark:text-amber-400">
          {blocked.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      Signed in as {user.email}.{' '}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        {busy ? 'Checking…' : 'Delete my account'}
      </button>
    </div>
  )
}
