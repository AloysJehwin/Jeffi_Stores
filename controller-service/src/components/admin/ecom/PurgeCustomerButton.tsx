'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { usePrompt } from '@/contexts/ConfirmContext'

// Hard-delete a dead store (terminated, rejected, or suspended with nothing left running). Irreversible.

export interface PurgeTarget {
  id: string
  slug: string
}

export interface PurgeResult extends PurgeTarget {
  ok: boolean
  error?: string
}

export const PURGE_WARNING =
  'This deletes the store for good: its servers, its database snapshot and stored database password, its S3 backups and every control-plane record. There is no restore. The owner account, their bank / Razorpay linked account and onboarding answers are kept, so they can apply again.'

/** POST /api/admin/ecom/customers/<id>/purge for each store in turn; a failure doesn't stop the rest. */
export async function purgeCustomers(stores: PurgeTarget[]): Promise<PurgeResult[]> {
  const out: PurgeResult[] = []
  for (const s of stores) {
    try {
      const res = await fetch(`/api/admin/ecom/customers/${s.id}/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const data = await res.json().catch(() => ({}))
      out.push(res.ok ? { ...s, ok: true } : { ...s, ok: false, error: data.error || `HTTP ${res.status}` })
    } catch {
      out.push({ ...s, ok: false, error: 'Network error' })
    }
  }
  return out
}

/** Asks for the slug to be typed, then deletes. Resolves true once deleted. */
export function usePurgeCustomer() {
  const prompt = usePrompt()
  const toast = useActionToast()
  const router = useRouter()
  return useCallback(
    async (t: PurgeTarget, onConfirmed?: () => void, after?: string) => {
      const typed = await prompt({
        title: `Delete "${t.slug}" permanently?`,
        message: `${PURGE_WARNING}\n\nType ${t.slug} to confirm.`,
        placeholder: t.slug,
        confirmLabel: 'Delete everything',
      })
      if (typed == null) return false
      if (typed !== t.slug) {
        toast.error(`That doesn't match ${t.slug}; nothing was deleted.`)
        return false
      }
      onConfirmed?.()
      const [r] = await purgeCustomers([t])
      if (!r.ok) {
        toast.error(`${t.slug}: ${r.error}`)
        return false
      }
      toast.success(`Deleted ${t.slug}`)
      if (after) router.push(after)
      else router.refresh()
      return true
    },
    [prompt, toast, router]
  )
}

// afterHref: where to go once deleted (a detail page would 404 on refresh).
export default function PurgeCustomerButton({ tenantId, slug, variant = 'button', afterHref }: { tenantId: string; slug: string; variant?: 'button' | 'menu'; afterHref?: string }) {
  const purge = usePurgeCustomer()
  const [busy, setBusy] = useState(false)
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await purge({ id: tenantId, slug }, () => setBusy(true), afterHref)
    } finally {
      setBusy(false)
    }
  }
  const cls =
    variant === 'menu'
      ? 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50'
      : 'inline-flex items-center gap-1.5 px-3 h-control-sm rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium transition-colors'
  return (
    <button type="button" onClick={run} disabled={busy} className={cls} title="Permanently delete this store, its servers and its backups">
      <Trash2 className="w-3.5 h-3.5" />
      {busy ? 'Deleting…' : 'Delete'}
    </button>
  )
}
