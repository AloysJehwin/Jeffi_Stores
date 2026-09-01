'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'

// Hard-delete a deprovisioned tenant from the customers list: removes every control-plane row and
// both S3 backup copies. Irreversible. The owner's bank + Razorpay linked account are kept for
// re-onboarding. Only rendered for deprovisioned/terminated rows.
export default function PurgeCustomerButton({
  tenantId,
  slug,
}: {
  tenantId: string
  slug: string
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={async (e) => {
          e.stopPropagation()
          const ok = await confirm({
            title: `Delete "${slug}" permanently?`,
            message:
              'This erases all control-plane data for this store AND its S3 database backup — there is no restore. The owner’s bank account and Razorpay linked account are kept so they can re-onboard.',
            variant: 'danger',
            confirmLabel: 'Delete everything',
          })
          if (!ok) return
          setBusy(true); setMsg(null)
          try {
            const res = await fetch(`/api/admin/ecom/customers/${tenantId}/purge`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ confirm: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) setMsg({ ok: false, text: data.error || 'Failed' })
            else { setMsg({ ok: true, text: 'Deleted' }); router.refresh() }
          } catch {
            setMsg({ ok: false, text: 'Network error' })
          } finally { setBusy(false) }
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        title="Permanently delete this deprovisioned store and its backup"
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</span>
      )}
    </div>
  )
}
