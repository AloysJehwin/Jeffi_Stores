'use client'

import { RefreshCw } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'

/** Re-applies the store's DNS host set to its current plan (adds hosts the plan now includes, removes ones it doesn't). */
export default function DnsResyncButton({ tenantId, disabled }: { tenantId: string; disabled?: boolean }) {
  const toast = useActionToast()

  async function resync() {
    const res = await fetch(`/api/admin/ecom/${tenantId}/dns/resync`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'DNS re-sync failed')
    const added: string[] = data.added ?? []
    const removed: string[] = data.removed ?? []
    toast.success(added.length === 0 && removed.length === 0 ? 'Already in sync.' : `Added ${added.length}, removed ${removed.length}.`)
  }

  return <ActionButton action={{ label: 'Re-sync DNS', icon: RefreshCw, onClick: resync, disabled }} />
}
